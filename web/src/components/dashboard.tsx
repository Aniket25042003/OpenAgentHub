"use client";

import { useCallback, useEffect, useState } from "react";
import type { DetectedAgent, HostInfo, SystemSnapshot } from "@openagenthub/runtime";
import { Reveal } from "@/components/reveal";

const POLL_MS = 8000;

export function Dashboard() {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [updated, setUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/system", { cache: "no-store" });
      if (!res.ok) throw new Error(`system API returned ${res.status}`);
      setSnap((await res.json()) as SystemSnapshot);
      setUpdated(new Date());
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <main>
      <div className="dash-hero">
        <div className="hero-glow" />
        <span className="eyebrow clear">Live system check</span>
        <h1>
          System <span className="hl">dashboard</span>
        </h1>
        <p className="lead">
          Everything OpenAgentHub sees on this machine — installed agents, detected third-party agents,
          running containers, and host health. Polled every {POLL_MS / 1000}s from{" "}
          <code className="inline">/api/system</code>.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <span className="pill good">
            <span className="dot" />
            {updated ? `updated ${updated.toLocaleTimeString()}` : "collecting snapshot…"}
          </span>
          {error && <span className="pill bad">{error}</span>}
        </div>
      </div>

      {snap ? (
        <>
          <Reveal>
            <HostCards host={snap.host} />
          </Reveal>
          <Reveal delay={80}>
            <InstalledAgents snap={snap} />
          </Reveal>
          <Reveal delay={160}>
            <DetectedAgents agents={snap.agents} />
          </Reveal>
          <Reveal delay={240}>
            <Containers snap={snap} />
          </Reveal>
        </>
      ) : (
        <div className="not-found">collecting system snapshot…</div>
      )}
    </main>
  );
}

function HostCards({ host }: { host: HostInfo }) {
  const used = host.memTotalBytes - host.memFreeBytes;
  return (
    <section>
      <div className="stats">
        <Stat label="host" value={host.hostname} sub={`${host.platform}/${host.arch} · ${host.cpus} cpu`} />
        <Stat label="uptime" value={fmtDuration(host.uptimeSec)} sub={`load ${host.loadavg.map((n) => n.toFixed(2)).join(" ")}`} />
        <Stat label="memory" value={fmtBytes(used)} sub={`of ${fmtBytes(host.memTotalBytes)} used`} />
        <Stat label="docker" value={host.docker.available ? "running" : "down"} sub={host.docker.version ?? host.docker.error ?? ""} good={host.docker.available} />
        <Stat label="node" value={host.node} sub={host.python ? `python ${host.python.replace("Python ", "")}` : ""} />
      </div>
    </section>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="num" style={{ color: good === undefined ? undefined : good ? "var(--clear-strong)" : "#e08a6a" }}>
        {value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function InstalledAgents({ snap }: { snap: SystemSnapshot }) {
  const installed = snap.openagenthub.installed;
  return (
    <section>
      <h2>
        OpenAgentHub agents <span className="badge">{installed.length}</span>
      </h2>
      {installed.length === 0 ? (
        <p className="hint">
          No agents installed via OpenAgentHub. Try <code className="inline">agent install &lt;namespace&gt;/&lt;name&gt;</code>.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>spec</th>
                <th>version</th>
                <th>trust</th>
                <th>installed</th>
              </tr>
            </thead>
            <tbody>
              {installed.map((a) => (
                <tr key={a.spec}>
                  <td>{a.spec}</td>
                  <td>{a.version}</td>
                  <td>
                    <span className={`pill ${trustPill(a.trust)}`}>{a.trust}</span>
                  </td>
                  <td>{a.installedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        install dir: <code className="inline">{snap.openagenthub.agentsDir}</code> · registry:{" "}
        <code className="inline">{snap.openagenthub.registryUrl}</code>
      </p>
    </section>
  );
}

function DetectedAgents({ agents }: { agents: DetectedAgent[] }) {
  const detected = agents.filter((a) => a.status !== "unknown");
  return (
    <section>
      <h2>
        Detected agents <span className="badge">{detected.length}</span>
      </h2>
      {detected.length === 0 ? (
        <p className="hint">No known third-party agents (OpenClaw, Hermes, …) detected on this machine.</p>
      ) : (
        <div className="grid">
          {detected.map((a) => (
            <div className="card" key={a.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>{a.displayName}</h3>
                <span className={`pill ${a.status === "running" ? "good" : "warn"}`}>
                  <span className={`dot ${a.status === "running" ? "" : "warn"}`} />
                  {a.status}
                </span>
              </div>
              <p className="desc">{a.description}</p>
              <div className="row">
                {a.detectedVia.map((v) => (
                  <span key={v} className="badge">
                    {v}
                  </span>
                ))}
              </div>
              <footer>
                <span>
                  {a.processes.length > 0 && <span className="muted">{a.processes.map((p) => p.pid).join(", ")} pids</span>}
                  {a.listeningPorts.length > 0 && <span className="muted"> · ports {a.listeningPorts.join(", ")}</span>}
                </span>
                {a.homepage && (
                  <a href={a.homepage} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                )}
              </footer>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Containers({ snap }: { snap: SystemSnapshot }) {
  const containers = snap.containers;
  return (
    <section>
      <h2>
        Containers <span className="badge">{containers.length}</span>
      </h2>
      {containers.length === 0 ? (
        <p className="hint">No running containers detected.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>name</th>
                <th>image</th>
                <th>state</th>
                <th>ports</th>
                <th>agent</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr key={c.id}>
                  <td className="code" style={{ whiteSpace: "nowrap" }}>{c.id.slice(0, 12)}</td>
                  <td>{c.name}</td>
                  <td>{c.image}</td>
                  <td>{c.state}</td>
                  <td>{c.ports}</td>
                  <td>{c.matchedAgentId ?? c.managedBy ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        OpenAgentHub marks its own sandbox containers; third-party agent containers are matched to known agents.
      </p>
    </section>
  );
}

function trustPill(trust: string): string {
  if (trust === "trusted" || trust === "local") return "good";
  if (trust === "untrusted") return "bad";
  return "warn";
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.round(n / 1024)} KiB`;
}

function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
