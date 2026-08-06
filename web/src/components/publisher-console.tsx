"use client";

import { useCallback, useEffect, useState } from "react";

interface PublisherOverview {
  namespaceCount: number;
  packageCount: number;
  keyCount: number;
  activeSessions: number;
  publishesUsed: number;
  publishesLimit: number;
  publishesUnlimited: boolean;
  pendingScans: number;
  flaggedVersions: number;
}

interface PackageSummary {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  author: string;
  description: string;
  license: string;
  publishedAt: string;
  downloads: number;
  trust: string;
  reviewStatus: string;
  securityStatus: string;
  yanked: boolean;
  blocked?: string | null;
  signerFingerprint?: string | null;
}

interface NamespaceInfo {
  name: string;
  role: string;
  memberCount: number;
  packageCount: number;
  createdAt: string;
}

interface ActivityItem {
  action: string;
  detail: Record<string, string | number | boolean | null>;
  createdAt: string;
}

type State =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "error"; message: string }
  | { status: "ready"; overview: PublisherOverview; packages: PackageSummary[]; activity: ActivityItem[] };

const REGISTRY_URL = process.env.NEXT_PUBLIC_REGISTRY_URL ?? "http://localhost:8000";

export function PublisherConsole() {
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [ov, pk, ac] = await Promise.all([
        fetch("/api/registry/me/overview", { cache: "no-store" }),
        fetch("/api/registry/me/packages", { cache: "no-store" }),
        fetch("/api/registry/me/activity", { cache: "no-store" }),
      ]);
      if (ov.status === 401 || pk.status === 401 || ac.status === 401) {
        setState({ status: "anon" });
        return;
      }
      if (!ov.ok || !pk.ok || !ac.ok) {
        throw new Error(`publisher API returned ${ov.status}/${pk.status}/${ac.status}`);
      }
      const overview = (await ov.json()) as PublisherOverview;
      const packages = (await pk.json()) as PackageSummary[];
      const activity = ((await ac.json()) as { items: ActivityItem[] }).items;
      setState({ status: "ready", overview, packages, activity });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signInUrl = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3100";
    return `${REGISTRY_URL}/auth/github/start?redirect_uri=${encodeURIComponent(origin + "/auth/callback")}`;
  };

  if (state.status === "loading") {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Publisher</span>
          <h1>Your publishing dashboard</h1>
          <p className="muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (state.status === "anon") {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Publisher</span>
          <h1>Sign in to publish</h1>
          <p>Sign in with GitHub to manage your published agents, security scans, and installs.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <a className="btn btn-primary" href={signInUrl()}>
              Sign in with GitHub
            </a>
          </div>
        </div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Publisher</span>
          <h1>Could not load</h1>
          <p className="pill bad">{state.message}</p>
          <button type="button" className="btn btn-secondary" onClick={refresh}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const { overview, packages, activity } = state;
  const blocked = packages.filter((p) => p.yanked || p.blocked);
  const pending = packages.filter((p) => p.reviewStatus === "pending" || p.securityStatus === "flagged");

  return (
    <main>
      <div className="hero">
        <span className="eyebrow">Publisher Console</span>
        <h1>Your agents</h1>
        <div className="stats">
          <div className="stat">
            <div className="num">{overview.packageCount}</div>
            <div className="label">Packages</div>
          </div>
          <div className="stat">
            <div className="num">{overview.namespaceCount}</div>
            <div className="label">Namespaces</div>
          </div>
          <div className="stat">
            <div className="num">{overview.keyCount}</div>
            <div className="label">Signing keys</div>
          </div>
          <div className="stat">
            <div className="num">{overview.pendingScans}</div>
            <div className="label">Pending scans</div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          {overview.publishesUnlimited
            ? "Unlimited publishes this month."
            : `${overview.publishesUsed} of ${overview.publishesLimit} publishes used this month.`}
          {overview.flaggedVersions > 0 && ` ${overview.flaggedVersions} flagged version(s).`}
        </p>
      </div>

      {pending.length > 0 && (
        <div className="content-block">
          <h2>Needs attention</h2>
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Version</th>
                <th>Review</th>
                <th>Security</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={`${p.namespace}/${p.name}@${p.version}`}>
                  <td>
                    <code className="inline">{p.namespace}/{p.name}</code>
                  </td>
                  <td>{p.version}</td>
                  <td>
                    <span className={`pill ${p.reviewStatus === "pending" ? "warn" : "good"}`}>{p.reviewStatus}</span>
                  </td>
                  <td>
                    <span className={`pill ${p.securityStatus === "flagged" ? "bad" : "warn"}`}>{p.securityStatus}</span>
                  </td>
                  <td>{new Date(p.publishedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="content-block">
          <h2>Suspended or revoked</h2>
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Version</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {blocked.map((p) => (
                <tr key={`${p.namespace}/${p.name}@${p.version}`}>
                  <td>
                    <code className="inline">{p.namespace}/{p.name}</code>
                  </td>
                  <td>{p.version}</td>
                  <td className="muted">{p.blocked ?? (p.yanked ? "yanked" : "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="content-block">
        <h2>Packages</h2>
        {packages.length === 0 ? (
          <p className="muted">You have not published any agents yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Version</th>
                <th>Downloads</th>
                <th>Review</th>
                <th>Security</th>
                <th />{" "}
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={`${p.namespace}/${p.name}@${p.version}`}>
                  <td>
                    <a href={`/agents/${p.namespace}/${p.name}`}>
                      <code className="inline">{p.namespace}/{p.name}</code>
                    </a>
                  </td>
                  <td>{p.version}</td>
                  <td>{p.downloads}</td>
                  <td>
                    <span className={`pill ${p.reviewStatus === "verified" ? "good" : p.reviewStatus === "pending" ? "warn" : "bad"}`}>
                      {p.reviewStatus}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${p.securityStatus === "clean" ? "good" : "bad"}`}>{p.securityStatus}</span>
                  </td>
                  <td>
                    {p.yanked && <span className="pill bad">yanked</span>}
                    {p.blocked && <span className="pill bad">blocked</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="content-block">
        <h2>Recent activity</h2>
        {activity.length === 0 ? (
          <p className="muted">No recent activity.</p>
        ) : (
          <ul>
            {activity.map((a, i) => (
              <li key={i} className="muted">
                <code className="inline">{a.action}</code> — {new Date(a.createdAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}