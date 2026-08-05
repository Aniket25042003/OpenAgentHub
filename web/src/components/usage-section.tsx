"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageStats } from "@openagenthub/runtime";

const POLL_MS = 10000;
const PRESETS = [
  { key: "all", label: "all time", from: undefined },
  { key: "today", label: "today", from: today() },
  { key: "7d", label: "7 days", from: daysAgo(7) },
  { key: "30d", label: "30 days", from: daysAgo(30) },
];

function today(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function UsageSection() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [updated, setUpdated] = useState<Date | null>(null);
  const [preset, setPreset] = useState("all");
  const [retentionDays, setRetentionDays] = useState("");
  const [retentionMax, setRetentionMax] = useState("");
  const [settingsMsg, setSettingsMsg] = useState<string | undefined>();

  const refresh = useCallback(async (from?: string) => {
    try {
      const q = from ? `?from=${from}` : "";
      const res = await fetch(`/api/local/v1/stats${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`stats API returned ${res.status}`);
      setStats((await res.json()) as UsageStats);
      setUpdated(new Date());
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/local/v1/settings", { cache: "no-store" });
      const s = (await res.json()) as Record<string, string>;
      setRetentionDays(s["retention.days"] ?? "");
      setRetentionMax(s["retention.max_runs"] ?? "");
    } catch {
      /* settings unavailable */
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const selected = PRESETS.find((p) => p.key === preset) ?? PRESETS[0];

  useEffect(() => {
    refresh(selected.from);
    const id = setInterval(() => refresh(selected.from), POLL_MS);
    return () => clearInterval(id);
  }, [refresh, preset, selected.from]);

  const saveSettings = async (): Promise<void> => {
    setSettingsMsg(undefined);
    try {
      const res = await fetch("/api/local/v1/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          "retention.days": retentionDays,
          "retention.max_runs": retentionMax,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `settings API returned ${res.status}`);
      setSettingsMsg("saved");
      setTimeout(() => setSettingsMsg(undefined), 3000);
    } catch (err) {
      setSettingsMsg((err as Error).message);
    }
  };

  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h2>
          Usage <span className="badge">{stats ? stats.runs.allTime : "…"}</span>
        </h2>
        <div className="row" style={{ gap: 8 }}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`pill ${preset === p.key ? "good" : ""}`}
              style={{ background: "none", border: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className={`pill ${error ? "bad" : "good"}`}>
          <span className={`dot ${error ? "warn" : ""}`} />
          {error
            ? error
            : updated
              ? `aggregated ${updated.toLocaleTimeString()}`
              : "collecting stats…"}
        </span>
        {stats?.lastEventAt && (
          <span className="pill">
            <span className="dot" />
            last recorded event {new Date(stats.lastEventAt).toLocaleString()}
          </span>
        )}
      </div>

      {stats ? (
        <>
          <div className="stats">
            <Stat label="running now" value={String(stats.runs.running)} sub={`${stats.runs.healthy} healthy · ${stats.runs.unhealthy} unhealthy`} />
            <Stat label="runs today" value={String(stats.runs.today)} sub={`${stats.runs.allTime} all time in range`} />
            <Stat label="stopped" value={String(stats.runs.stopped)} sub={`${stats.runs.failed} failed`} />
            <Stat label="containers" value={String(stats.containers.current)} sub={`${stats.containers.historical} historical runs`} />
          </div>

          <div className="stats">
            <Stat
              label="tokens"
              value={fmtTokens(stats.tokens.input + stats.tokens.output)}
              sub={
                stats.tokens.available
                  ? `${fmtTokens(stats.tokens.input)} in · ${fmtTokens(stats.tokens.output)} out · ${fmtTokens(stats.tokens.reasoning)} reasoning · ${fmtTokens(stats.tokens.cache)} cache`
                  : "no usage recorded yet"
              }
            />
            <Stat label="cost (exact)" value={stats.cost.exactAvailable ? `$${stats.cost.exact.toFixed(6)}` : "n/a"} sub={stats.cost.exactAvailable ? "from provider-reported pricing" : "none reported"} />
            <Stat label="cost (estimated)" value={stats.cost.estimatedAvailable ? `$${stats.cost.estimated.toFixed(6)}` : "n/a"} sub="from token counts and reference pricing" />
          </div>

          {stats.models.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>provider</th>
                    <th>model</th>
                    <th>runs</th>
                    <th>tokens in</th>
                    <th>tokens out</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.models.map((m) => (
                    <tr key={`${m.provider}:${m.model}`}>
                      <td>{m.provider}</td>
                      <td>{m.model}</td>
                      <td>{m.runs}</td>
                      <td>{m.tokensIn}</td>
                      <td>{m.tokensOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats.activeRuns.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>run</th>
                    <th>agent</th>
                    <th>sandbox</th>
                    <th>health</th>
                    <th>running since</th>
                    <th>elapsed</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.activeRuns.map((r) => (
                    <tr key={r.runId}>
                      <td className="code" style={{ whiteSpace: "nowrap" }}>{r.runId}</td>
                      <td>{r.agentKey}</td>
                      <td>{r.sandbox}</td>
                      <td>
                        <span className={`pill ${r.health === "ok" ? "good" : "warn"}`}>{r.health}</span>
                      </td>
                      <td>{new Date(r.startedAt).toLocaleString()}</td>
                      <td>{r.durationSec !== undefined ? fmtDuration(r.durationSec) : "…"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats.perAgent.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>agent</th>
                    <th>runs</th>
                    <th>running</th>
                    <th>last run</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.perAgent.map((a) => (
                    <tr key={a.agentKey}>
                      <td>{a.agentKey}</td>
                      <td>{a.runs}</td>
                      <td>{a.running}</td>
                      <td>{a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <div className="label" style={{ marginBottom: 4 }}>
                last successful run
              </div>
              <div className="sub">
                {stats.runs.lastSuccessfulRun
                  ? `${stats.runs.lastSuccessfulRun.agentKey} — ${new Date(stats.runs.lastSuccessfulRun.startedAt).toLocaleString()}`
                  : "none"}
              </div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 4 }}>
                last failed run
              </div>
              <div className="sub">
                {stats.runs.lastFailedRun
                  ? `${stats.runs.lastFailedRun.agentKey} — ${new Date(stats.runs.lastFailedRun.startedAt).toLocaleString()} (${stats.runs.lastFailedRun.exitReason ?? "failed"})`
                  : "none"}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Retention</h3>
            <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 12px" }}>
              History older than the retention window (or beyond the newest N runs) is pruned at the next daemon start. 0 = keep everything.
            </p>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <label className="sub">
                keep runs newer than{" "}
                <input
                  type="number"
                  min={0}
                  value={retentionDays}
                  placeholder="days"
                  onChange={(e) => setRetentionDays(e.target.value)}
                  style={{ width: 90, marginLeft: 6 }}
                />{" "}
                days
              </label>
              <label className="sub">
                keep at most{" "}
                <input
                  type="number"
                  min={0}
                  value={retentionMax}
                  placeholder="runs"
                  onChange={(e) => setRetentionMax(e.target.value)}
                  style={{ width: 90, marginLeft: 6 }}
                />{" "}
                runs
              </label>
              <button className="pill good" style={{ cursor: "pointer" }} onClick={saveSettings}>
                save
              </button>
              {settingsMsg && <span className="pill warn">{settingsMsg}</span>}
            </div>
          </div>
        </>
      ) : (
        <div className="not-found">collecting usage stats…</div>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="num">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function fmtTokens(n: number): string {
  return n.toLocaleString();
}

function fmtDuration(sec: number): string {
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)}h`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${sec}s`;
}
