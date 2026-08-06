"use client";

import { useCallback, useEffect, useState } from "react";

interface SessionInfo {
  id: number;
  audience: string;
  deviceLabel?: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revoked: boolean;
}

interface Agreements {
  tos: string;
  privacy: string;
  publisher: string;
}

interface AccountState {
  signedIn: boolean;
  sessions: SessionInfo[];
  agreements: Agreements;
  error?: string;
}

const REGISTRY_URL = process.env.NEXT_PUBLIC_REGISTRY_URL ?? "http://localhost:8000";

export function Account() {
  const [state, setState] = useState<AccountState>({ signedIn: false, sessions: [], agreements: { tos: "pending", privacy: "pending", publisher: "pending" } });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(undefined);
    try {
      const res = await fetch("/api/account/sessions", { cache: "no-store" });
      if (res.status === 401) {
        setState({ signedIn: false, sessions: [], agreements: { tos: "pending", privacy: "pending", publisher: "pending" } });
        return;
      }
      if (!res.ok) throw new Error(`sessions API returned ${res.status}`);
      const sessionsBody = (await res.json()) as { sessions: SessionInfo[] };
      const agreeRes = await fetch("/api/account/agreements", { cache: "no-store" });
      const agreements = agreeRes.ok ? ((await agreeRes.json()) as Agreements) : { tos: "pending", privacy: "pending", publisher: "pending" };
      setState({ signedIn: true, sessions: sessionsBody.sessions, agreements });
    } catch (err) {
      setState({ signedIn: false, sessions: [], agreements: { tos: "pending", privacy: "pending", publisher: "pending" }, error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const revoke = async (id: number, audience: string) => {
    if (audience === "web" && state.sessions.filter((s) => s.audience === "web" && !s.revoked).length <= 1) {
      setMessage("You cannot revoke your only active web session used to manage this page.");
      return;
    }
    await fetch(`/api/account/sessions?id=${id}`, { method: "DELETE", cache: "no-store" });
    await refresh();
  };

  const acceptAll = async () => {
    const res = await fetch("/api/account/agreements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tos: true, privacy: true, publisher: true }),
      cache: "no-store",
    });
    if (res.ok) setMessage("Agreements accepted. You are clear to publish.");
    else setMessage(`Could not accept agreements (${res.status}).`);
    await refresh();
  };

  const logout = async () => {
    await fetch("/api/account/logout", { method: "POST", cache: "no-store" });
    window.location.href = "/account";
  };

  const signInUrl = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3100";
    return `${process.env.NEXT_PUBLIC_REGISTRY_URL ?? "http://localhost:8000"}/auth/github/start?redirect_uri=${encodeURIComponent(origin + "/auth/callback")}`;
  };

  if (loading) {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Account</span>
          <h1>Your account</h1>
          <p className="muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (!state.signedIn) {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Account</span>
          <h1>Sign in</h1>
          <p>Sign in with GitHub to manage your published agents, sessions, and agreements.</p>
          {state.error && <p className="pill bad">{state.error}</p>}
          <div className="row" style={{ marginTop: 16 }}>
            <a className="btn btn-primary" href={signInUrl()}>
              Sign in with GitHub
            </a>
          </div>
        </div>
      </main>
    );
  }

  const pending =
    state.agreements.tos === "pending" || state.agreements.privacy === "pending" || state.agreements.publisher === "pending";

  return (
    <main>
      <div className="hero">
        <span className="eyebrow">Account</span>
        <h1>Your account</h1>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={logout}>
            Sign out
          </button>
          {pending && (
            <button type="button" className="btn btn-primary" onClick={acceptAll}>
              Accept agreements
            </button>
          )}
        </div>
        {message && <p className="muted" style={{ marginTop: 12 }}>{message}</p>}
      </div>

      <div className="content-block">
        <h2>Agreements</h2>
        {pending ? (
          <p>Review and accept the terms below before publishing.</p>
        ) : (
          <p className="muted">All agreements accepted.</p>
        )}
        <ul>
          <li>Terms of Service — <code className="inline">{state.agreements.tos}</code></li>
          <li>Privacy Policy — <code className="inline">{state.agreements.privacy}</code></li>
          <li>Publisher Agreement — <code className="inline">{state.agreements.publisher}</code></li>
        </ul>
      </div>

      <div className="content-block">
        <h2>Sessions</h2>
        {state.sessions.length === 0 ? (
          <p className="muted">No active sessions.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Audience</th>
                <th>Device</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.audience}</td>
                  <td>{s.deviceLabel ?? "—"}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>{new Date(s.lastUsedAt).toLocaleString()}</td>
                  <td>{new Date(s.expiresAt).toLocaleString()}</td>
                  <td>
                    {s.revoked ? (
                      <span className="muted">revoked</span>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => revoke(s.id, s.audience)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}