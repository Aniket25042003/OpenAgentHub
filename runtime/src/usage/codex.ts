import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { UsageStore } from "../usage.js";
import { providerDetected, providerEnabled } from "./detect.js";
import { num, isUsageObject, type AdapterOutput, type LimitObservation, type ProviderName, type ProviderStatus, type UsageObservation } from "./types.js";

const CODEX_ADAPTER_VERSION = 1;
const SESSION_EXT = ".jsonl";
const MAX_FILES = 10_000;

interface UsageRecord {
  tokensIn: number;
  tokensOut: number;
  cumulative: boolean;
  model?: string;
  sessionId?: string;
  timestamp?: string;
  id?: string;
}

function walkJsonl(dir: string, out: string[], deadlineMs: number, startedAt: number): boolean {
  if (!existsSync(dir)) return true;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return false;
    if (Date.now() - startedAt > deadlineMs) return false;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!walkJsonl(p, out, deadlineMs, startedAt)) return false;
    } else if (entry.isFile() && entry.name.endsWith(SESSION_EXT)) {
      out.push(p);
    }
  }
  return true;
}

function findUsageRecord(item: unknown): UsageRecord | null {
  if (!isUsageObject(item)) return null;
  const payload = item.payload;
  const usageSource = isUsageObject(payload) && isUsageObject(payload.usage) ? payload.usage : isUsageObject(item.usage) ? item.usage : null;
  if (!usageSource) return null;
  const tokensIn = num(usageSource.input_tokens);
  const tokensOut = num(usageSource.output_tokens);
  if (tokensIn === undefined && tokensOut === undefined) return null;
  const cumulative = usageSource.cumulative === true || item.type === "summary";
  const model =
    typeof usageSource.model === "string"
      ? usageSource.model
      : typeof item.model === "string"
        ? item.model
        : typeof payload === "object" && payload !== null && "model" in payload && typeof (payload as Record<string, unknown>).model === "string"
          ? String((payload as Record<string, unknown>).model)
          : undefined;
  const sessionId =
    typeof usageSource.session_id === "string"
      ? usageSource.session_id
      : typeof item.session_id === "string"
        ? item.session_id
        : undefined;
  const timestamp = typeof usageSource.observed_at === "string" ? usageSource.observed_at : typeof item.timestamp === "string" ? item.timestamp : undefined;
  const id = typeof usageSource.id === "string" ? usageSource.id : typeof item.id === "string" ? item.id : undefined;
  return { tokensIn: tokensIn ?? 0, tokensOut: tokensOut ?? 0, cumulative, model, sessionId, timestamp, id };
}

function findRateLimit(item: unknown): LimitObservation | null {
  if (!isUsageObject(item) || item.type !== "ratelimit") return null;
  const rl = isUsageObject(item.payload) ? item.payload : null;
  if (!rl) return null;
  const limit = num(rl.limit);
  const remaining = num(rl.remaining);
  const resetAfter = num(rl.reset_after);
  if (limit === undefined && remaining === undefined) return null;
  const obs: LimitObservation = {
    provider: "codex",
    window: "sliding",
    units: typeof rl.units === "string" ? rl.units : "requests",
    creditsTotal: limit,
    creditsUsed: limit !== undefined && remaining !== undefined ? Math.max(0, limit - remaining) : remaining,
    source: "local",
  };
  if (resetAfter !== undefined && resetAfter >= 0) obs.resetAt = new Date(Date.now() + resetAfter * 1000).toISOString();
  return obs;
}

function findCumulativeTotal(item: unknown): { model: string; tokensIn: number; tokensOut: number } | null {
  if (!isUsageObject(item)) return null;
  const payload = item.payload;
  const totals = isUsageObject(payload) && isUsageObject(payload.totals) ? payload.totals : null;
  if (!totals) return null;
  const input = num(totals.input_tokens);
  const output = num(totals.output_tokens);
  if (input === undefined && output === undefined) return null;
  const model = typeof totals.model === "string" ? totals.model : undefined;
  if (!model) return null;
  return { model, tokensIn: input ?? 0, tokensOut: output ?? 0 };
}

export function collectCodex(store: UsageStore, deadlineMs: number, settings: (key: string) => string | null): AdapterOutput {
  const startedAt = Date.now();
  const usage: UsageObservation[] = [];
  const limits: LimitObservation[] = [];
  const provider: ProviderName = "codex";
  const detected = providerDetected(provider);
  let status: ProviderStatus = detected ? "ok" : "missing";
  let scanned = 0;
  let ingested = 0;
  let skipped = 0;
  let message = detected ? `adapter v${CODEX_ADAPTER_VERSION}` : undefined;

  try {
    if (providerEnabled(settings, provider)) {
      const root = process.env.OPENAGENTHUB_CODEX_DIR ?? process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
      const sessionsDir = existsSync(root) ? join(root, "sessions") : null;
      const files: string[] = [];
      if (sessionsDir) walkJsonl(sessionsDir, files, deadlineMs, startedAt);
      for (const file of files) {
        if (Date.now() - startedAt > deadlineMs) {
          status = "timeboxed";
          break;
        }
        const parsed = parseSessionFile(store, file, startedAt, deadlineMs);
        scanned++;
        usage.push(...parsed.usage);
        limits.push(...parsed.limits);
        ingested += parsed.ingested;
        skipped += parsed.skippedLines;
        if (parsed.cutShort && status === "ok") status = "timeboxed";
      }
      if (status === "ok" && files.length === 0 && !detected) status = "missing";
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

function parseSessionFile(
  store: UsageStore,
  file: string,
  startedAt: number,
  deadlineMs: number,
): { usage: UsageObservation[]; limits: LimitObservation[]; ingested: number; skippedLines: number; cutShort: boolean } {
  let st;
  try {
    st = statSync(file);
  } catch {
    return { usage: [], limits: [], ingested: 0, skippedLines: 0, cutShort: false };
  }
  const cursor = store.getSourceCursor(file);
  const cursorSize = cursor ? Number(cursor.size) : -1;
  const cursorMtime = cursor ? Number(cursor.mtimeMs) : -1;
  const cursorOffset = cursor ? Number(cursor.offset) : 0;
  if (cursor && cursorSize === st.size && cursorMtime === st.mtimeMs) return { usage: [], limits: [], ingested: 0, skippedLines: 0, cutShort: false };

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { usage: [], limits: [], ingested: 0, skippedLines: 0, cutShort: false };
  }
  const next = raw.lastIndexOf("\n");
  const completeEnd = next === -1 ? 0 : next + 1;

  let offset = 0;
  if (cursor && cursorOffset <= st.size) {
    const boundary = cursorOffset === 0 || raw.charCodeAt(cursorOffset - 1) === 10;
    if (st.mtimeMs === cursorMtime || boundary) offset = cursorOffset;
  }
  if (completeEnd < offset) offset = 0;

  const usage: UsageObservation[] = [];
  const limits: LimitObservation[] = [];
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
    let item: unknown;
    try {
      item = JSON.parse(trimmed);
    } catch {
      skippedLines++;
      continue;
    }
    const rl = findRateLimit(item);
    if (rl) limits.push(rl);
    const rec = findUsageRecord(item);
    const totals = findCumulativeTotal(item);
    if (totals) {
      const obs = totalsToObservation(store, totals, file, lineNo);
      if (obs) {
        if (!store.hasExternal(obs.provider, obs.source, obs.eventKey)) usage.push(obs);
        else skippedLines++;
      } else {
        skippedLines++;
      }
    } else if (rec) {
      const obs = recordToObservation(store, rec, file, lineNo);
      if (obs) {
        if (!store.hasExternal(obs.provider, obs.source, obs.eventKey)) usage.push(obs);
        else skippedLines++;
      } else {
        skippedLines++;
      }
    } else if (!rl) {
      skippedLines++;
    }
  }

  store.setSourceCursor(file, st.size, st.mtimeMs, completeEnd);
  return { usage, limits, ingested: usage.length, skippedLines, cutShort };
}

function totalsToObservation(
  store: UsageStore,
  totals: { model: string; tokensIn: number; tokensOut: number },
  source: string,
  lineNo: number,
): UsageObservation | null {
  const last = store.getCodexTotal(source, totals.model);
  const lastIn = last ? Number(last.lastInput) : 0;
  const lastOut = last ? Number(last.lastOutput) : 0;
  const deltaIn = totals.tokensIn - lastIn;
  const deltaOut = totals.tokensOut - lastOut;
  if (deltaIn <= 0 && deltaOut <= 0) return null;
  store.setCodexTotal(source, totals.model, totals.tokensIn, totals.tokensOut);
  return {
    provider: "codex",
    source,
    model: totals.model,
    tokensIn: deltaIn,
    tokensOut: deltaOut,
    occurredAt: new Date().toISOString(),
    eventKey: `cum|${totals.model}|${totals.tokensIn}|${totals.tokensOut}`,
  };
}

function recordToObservation(
  store: UsageStore,
  rec: UsageRecord,
  source: string,
  lineNo: number,
): UsageObservation | null {
  if (rec.cumulative) return null;
  return {
    provider: "codex",
    source,
    sessionId: rec.sessionId,
    model: rec.model ?? "unknown",
    tokensIn: rec.tokensIn,
    tokensOut: rec.tokensOut,
    occurredAt: rec.timestamp ?? new Date().toISOString(),
    eventKey: rec.id ?? `${rec.timestamp ?? lineNo}|${lineNo}`,
  };
}
