import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UsageStore } from "../usage.js";
import { providerDetected, providerEnabled } from "./detect.js";
import { num, type AdapterOutput, type ProviderName, type ProviderStatus, type UsageObservation } from "./types.js";

const OPENCODE_ADAPTER_VERSION = 1;
const MAX_DBS = 500;

interface DbSchema {
  hasMessages: boolean;
  timeCol: string | null;
  hasTokens: boolean;
  hasCost: boolean;
  hasModel: boolean;
}

function walkSqlite(dir: string, out: string[], deadlineMs: number, startedAt: number): boolean {
  if (!existsSync(dir)) return true;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    if (out.length >= MAX_DBS) return false;
    if (Date.now() - startedAt > deadlineMs) return false;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!walkSqlite(p, out, deadlineMs, startedAt)) return false;
    } else if (entry.isFile() && entry.name.endsWith(".sqlite")) {
      out.push(p);
    }
  }
  return true;
}

function schemaOf(db: DatabaseSync): DbSchema | null {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const messages = tables.some((t) => t.name === "messages");
  if (!messages) return null;
  const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  return {
    hasMessages: true,
    timeCol: (["time", "created_at", "timestamp"] as const).find((c) => names.has(c)) ?? null,
    hasTokens: names.has("tokens") || names.has("input_tokens") || names.has("tokens_in"),
    hasCost: names.has("cost"),
    hasModel: names.has("modelID") || names.has("model") || names.has("model_id"),
  };
}

function tokensOf(row: Record<string, unknown>): { input?: number; output?: number; cache?: number } {
  const t = row.tokens;
  if (typeof t === "string") {
    const trimmed = t.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        return { input: num(obj.input) ?? num(obj.input_tokens), output: num(obj.output) ?? num(obj.output_tokens), cache: num(obj.cache) };
      } catch {
        return {};
      }
    }
    if (trimmed.startsWith('"')) {
      try {
        const inner = JSON.parse(trimmed);
        if (typeof inner === "string") return tokensOf({ tokens: inner });
      } catch {
        return {};
      }
      return {};
    }
    if (trimmed.includes(",")) {
      const [a, b] = trimmed.split(",").map((s) => Number(s.trim()));
      return Number.isFinite(a) && Number.isFinite(b) ? { input: a, output: b } : {};
    }
    const n = Number(trimmed);
    return Number.isFinite(n) ? { output: n } : {};
  }
  if (typeof t === "number" && Number.isFinite(t)) return { output: t };
  const input = num(row.input_tokens) ?? num(row.tokens_in);
  const output = num(row.output_tokens) ?? num(row.tokens_out);
  return { input, output };
}

function modelOf(row: Record<string, unknown>): string | undefined {
  const v = row.modelID ?? row.model ?? row.model_id;
  return typeof v === "string" ? v : undefined;
}

export function collectOpencode(store: UsageStore, deadlineMs: number, settings: (key: string) => string | null): AdapterOutput {
  const startedAt = Date.now();
  const usage: UsageObservation[] = [];
  const provider: ProviderName = "opencode";
  const detected = providerDetected(provider);
  let status: ProviderStatus = detected ? "ok" : "missing";
  let scanned = 0;
  let ingested = 0;
  let skipped = 0;
  let message = detected ? `adapter v${OPENCODE_ADAPTER_VERSION}` : undefined;

  try {
    if (providerEnabled(settings, provider)) {
      const root =
        process.env.OPENAGENTHUB_OPENCODE_DIR ?? process.env.OPENCODE_DATA ?? join(process.env.HOME ?? "", ".local", "share", "opencode");
      const storageDir = existsSync(root) ? join(root, "storage") : null;
      const dbs: string[] = [];
      if (storageDir) walkSqlite(storageDir, dbs, deadlineMs, startedAt);
      for (const dbPath of dbs) {
        if (Date.now() - startedAt > deadlineMs) {
          status = "timeboxed";
          break;
        }
        const out = parseDb(store, dbPath, startedAt, deadlineMs);
        scanned++;
        usage.push(...out.usage);
        ingested += out.ingested;
        skipped += out.skipped;
        if (out.cutShort && status === "ok") status = "timeboxed";
        if (out.status !== undefined && status === "ok") status = out.status;
      }
      if (status === "ok" && dbs.length === 0 && !detected) status = "missing";
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
    limits: [],
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

function parseDb(
  store: UsageStore,
  dbPath: string,
  startedAt: number,
  deadlineMs: number,
): { usage: UsageObservation[]; ingested: number; skipped: number; cutShort: boolean; status?: "unsupported" | "locked" | "error" } {
  let st;
  try {
    st = statSync(dbPath);
  } catch {
    return { usage: [], ingested: 0, skipped: 0, cutShort: false };
  }
  const cursor = store.getSourceCursor(dbPath);
  if (cursor && Number(cursor.size) === st.size && Number(cursor.mtimeMs) === st.mtimeMs) {
    return { usage: [], ingested: 0, skipped: 0, cutShort: false };
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return { usage: [], ingested: 0, skipped: 0, cutShort: false, status: "locked" };
  }

  try {
    const schema = schemaOf(db);
    if (!schema || !schema.hasTokens) {
      return { usage: [], ingested: 0, skipped: 0, cutShort: false, status: "unsupported" };
    }
    const cursorSeen = cursor ? Number(cursor.offset) : 0;
    const lastTime = cursorSeen;
    const timeCol = schema.timeCol;
    let rows: Record<string, unknown>[];
    try {
      rows = timeCol
        ? (db.prepare(`SELECT * FROM messages WHERE ${timeCol} > ? ORDER BY ${timeCol}`).all(lastTime) as Record<string, unknown>[])
        : (db.prepare("SELECT * FROM messages").all() as Record<string, unknown>[]);
    } catch {
      return { usage: [], ingested: 0, skipped: 0, cutShort: false, status: "unsupported" };
    }

      const usage: UsageObservation[] = [];
    let skippedCount = 0;
    let parsedCount = 0;
    let maxTime = lastTime;
    let cutShort = false;
    for (const row of rows) {
      if (Date.now() - startedAt > deadlineMs) {
        cutShort = true;
        break;
      }
      const tokens = tokensOf(row);
      if (tokens.input === undefined && tokens.output === undefined) {
        skippedCount++;
        continue;
      }
      parsedCount++;
      const rowTime = num(row.time) ?? num(row.created_at) ?? num(row.timestamp);
      if (rowTime !== undefined && rowTime > maxTime) maxTime = rowTime;
      const occurredAt = rowTime !== undefined ? new Date(rowTime).toISOString() : new Date().toISOString();
      const id = row.id;
      const eventKey = id !== undefined ? `messages#${String(id)}` : `${occurredAt}|${String(row.session_id ?? "")}|${parsedCount}`;
      usage.push({
        provider: "opencode",
        source: dbPath,
        sessionId: row.session_id !== undefined ? String(row.session_id) : undefined,
        model: modelOf(row),
        tokensIn: tokens.input ?? 0,
        tokensOut: tokens.output ?? 0,
        cacheRead: tokens.cache,
        costExact: schema.hasCost ? num(row.cost) : undefined,
        occurredAt,
        eventKey,
      });
    }
    store.setSourceCursor(dbPath, st.size, st.mtimeMs, timeCol ? maxTime : st.size);
    return { usage, ingested: usage.length, skipped: skippedCount, cutShort };
  } finally {
    db.close();
  }
}
