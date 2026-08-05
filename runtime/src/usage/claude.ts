import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { UsageStore } from "../usage.js";
import { estimateClaudeCost } from "./pricing.js";
import { hasConsent, providerDetected, providerEnabled } from "./detect.js";
import { num, isUsageObject, type AdapterOutput, type LimitObservation, type ProviderName, type ProviderStatus, type UsageObservation } from "./types.js";

const SESSION_EXT = ".jsonl";
const CREDENTIALS_LIMITS_FILE = "claude.json";
const CLAUDE_ADAPTER_VERSION = 1;

interface Cursor {
  size: number;
  mtimeMs: number;
  offset: number;
}

function walkJsonl(dir: string, out: string[], deadlineMs: number, startedAt: number, limit: number): boolean {
  if (!existsSync(dir)) return true;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    if (out.length >= limit) return false;
    if (Date.now() - startedAt > deadlineMs) return false;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!walkJsonl(p, out, deadlineMs, startedAt, limit)) return false;
    } else if (entry.isFile() && entry.name.endsWith(SESSION_EXT)) {
      out.push(p);
    }
  }
  return true;
}

function readCursor(store: UsageStore, source: string): Cursor | null {
  const row = store.getSourceCursor(source);
  return row ? { size: Number(row.size), mtimeMs: Number(row.mtimeMs), offset: Number(row.offset) } : null;
}

export function collectClaude(store: UsageStore, deadlineMs: number, settings: (key: string) => string | null): AdapterOutput {
  const startedAt = Date.now();
  const usage: UsageObservation[] = [];
  const limits: LimitObservation[] = [];
  const provider: ProviderName = "claude";
  const detected = providerDetected(provider);
  let status: ProviderStatus = detected ? "ok" : "missing";
  let scanned = 0;
  let ingested = 0;
  let skipped = 0;
  let message = detected ? `adapter v${CLAUDE_ADAPTER_VERSION}` : undefined;

  try {
    if (providerEnabled(settings, provider)) {
      const { dataDir } = resolveRoots();
      const files: string[] = [];
      if (dataDir) walkJsonl(dataDir, files, deadlineMs, startedAt, 10_000);
      for (const file of files) {
        if (Date.now() - startedAt > deadlineMs) {
          status = "timeboxed";
          break;
        }
        const parsed = parseSessionFile(store, file, startedAt, deadlineMs);
        scanned++;
        usage.push(...parsed.usage);
        ingested += parsed.ingested;
        skipped += parsed.skippedLines;
        if (parsed.cutShort && status === "ok") status = "timeboxed";
      }
      const limitsObs = collectLocalLimits(store, settings);
      limits.push(...limitsObs);
      if (status === "ok" && files.length === 0 && !providerDetected(provider)) status = "missing";
    } else {
      status = "disabled";
      message = "integration disabled";
    }
  } catch (err) {
    status = "error";
    message = err instanceof Error ? err.message : String(err);
  }

  return {
    usage,
    limits,
    result: {
      provider,
      detected,
      status,
      sourcesScanned: scanned,
      eventsIngested: ingested,
      eventsSkipped: skipped,
      timeMs: Date.now() - startedAt,
      message,
    },
  };
}

function resolveRoots(): { dataDir: string | null; configFile: string | null } {
  const root = process.env.OPENAGENTHUB_CLAUDE_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".claude");
  if (!existsSync(root)) return { dataDir: null, configFile: null };
  const dataDir = join(root, "projects");
  const configFile = join(root, CREDENTIALS_LIMITS_FILE);
  return { dataDir: existsSync(dataDir) ? dataDir : null, configFile: existsSync(configFile) ? configFile : null };
}

function parseSessionFile(
  store: UsageStore,
  file: string,
  startedAt: number,
  deadlineMs: number,
): { usage: UsageObservation[]; ingested: number; skippedLines: number; cutShort: boolean } {
  let st;
  try {
    st = statSync(file);
  } catch {
    return { usage: [], ingested: 0, skippedLines: 0, cutShort: false };
  }
  const cursor = readCursor(store, file);
  if (cursor && cursor.size === st.size && cursor.mtimeMs === st.mtimeMs) return { usage: [], ingested: 0, skippedLines: 0, cutShort: false };

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { usage: [], ingested: 0, skippedLines: 0, cutShort: false };
  }
  const next = raw.lastIndexOf("\n");
  const completeEnd = next === -1 ? 0 : next + 1;

  let offset = 0;
  if (cursor && cursor.offset <= st.size) {
    const boundary = cursor.offset === 0 || raw.charCodeAt(cursor.offset - 1) === 10;
    if (st.mtimeMs === cursor.mtimeMs || boundary) offset = cursor.offset;
  }
  if (completeEnd < offset) offset = 0;

  const usage: UsageObservation[] = [];
  let skippedLines = 0;
  let lineNo = 0;
  let cutShort = false;
  for (const line of raw.slice(offset, completeEnd).split("\n")) {
    lineNo++;
    if (Date.now() - startedAt > deadlineMs) {
      cutShort = true;
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      skippedLines++;
      continue;
    }
    const obs = eventToObservation(event, file, lineNo);
    if (obs) {
      if (!store.hasExternal(obs.provider, obs.source, obs.eventKey)) usage.push(obs);
      else skippedLines++;
    } else {
      skippedLines++;
    }
  }

  store.setSourceCursor(file, st.size, st.mtimeMs, completeEnd);
  return { usage, ingested: usage.length, skippedLines, cutShort };
}

function eventToObservation(event: unknown, source: string, lineNo: number): UsageObservation | null {
  if (!isUsageObject(event)) return null;
  if (event.type !== "assistant") return null;
  const message = event.message;
  if (!isUsageObject(message)) return null;
  const usage = message.usage;
  if (!isUsageObject(usage)) return null;

  const tokensIn = num(usage.input_tokens);
  const tokensOut = num(usage.output_tokens);
  if (tokensIn === undefined && tokensOut === undefined) return null;

  const cacheWrite = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const costExact = num(usage.cost_usd);
  const model = typeof message.model === "string" ? message.model : undefined;
  const occurredAt = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
  const uuid = typeof message.uuid === "string" ? message.uuid : undefined;
  const sessionId = typeof message.session_id === "string" ? message.session_id : undefined;

  const base = {
    provider: "claude" as const,
    source,
    sessionId,
    model,
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
    cacheRead,
    cacheWrite,
    occurredAt,
    eventKey: uuid ?? `${occurredAt}|${lineNo}`,
  };
  const estimated = estimateClaudeCost(base);
  return { ...base, costExact: costExact !== undefined ? costExact : undefined, costEstimated: costExact !== undefined ? undefined : estimated };
}

function collectLocalLimits(store: UsageStore, settings: (key: string) => string | null): LimitObservation[] {
  if (!hasConsent(settings, "claude", "credentials")) return [];
  const { configFile } = resolveRoots();
  if (!configFile) return [];
  let raw: string;
  try {
    raw = readFileSync(configFile, "utf8");
  } catch {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isUsageObject(data) || !isUsageObject(data.usage)) return [];
  const u = data.usage;
  const given = num(u.given);
  const used = num(u.used);
  const plan = typeof u.plan === "string" ? u.plan : undefined;
  if (given === undefined && used === undefined) return [];
  const periodEnd = typeof u.period_end === "string" ? u.period_end : undefined;
  const obs: LimitObservation = {
    provider: "claude",
    window: periodEnd ? "until-period-end" : "period",
    plan,
    units: "tokens",
    creditsTotal: given,
    creditsUsed: used,
    source: "local",
  };
  if (given !== undefined && given > 0 && used !== undefined) obs.usedPercent = Math.round((used / given) * 1000) / 10;
  if (periodEnd) obs.resetAt = periodEnd;
  return [obs];
}
