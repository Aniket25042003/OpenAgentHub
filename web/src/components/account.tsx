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

interface Profile {
  username: string;
  role: string;
  status: string;
  githubId?: string;
  avatarUrl?: string;
  agreements: Agreements;
}

interface SecurityEvent {
  id: number;
  action: string;
  targetType?: string;
  targetId?: number;
  detail?: Record<string, unknown>;
  createdAt: string;
}

interface AccountState {
  signedIn: boolean;
  sessions: SessionInfo[];
  agreements: Agreements;
  profile?: Profile;
  securityEvents: SecurityEvent[];
  error?: string;
}

const REGISTRY_URL = process.env.NEXT_PUBLIC_REGISTRY_URL ?? "http://localhost:8000";

const EMPTY_AGREEMENTS: Agreements = { tos: "pending", privacy: "pending", publisher: "pending" };

export function Account() {
  const [state, setState] = useState<AccountState>({
    signedIn: false,
    sessions: [],
    agreements: EMPTY_AGREEMENTS,
    securityEvents: [],
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const emptyState = (): AccountState => ({
    signedIn: false,
    sessions: [],
    agreements: { ...EMPTY_AGREEMENTS },
    securityEvents: [],
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(undefined);
    try {
      const res = await fetch("/api/account/sessions", { cache: "no-store" });
      if (res.status === 401) {
        setState(emptyState());
        return;
      }
      if (!res.ok) throw new Error(`sessions API returned ${res.status}`);
      const sessionsBody = (await res.json()) as { sessions: SessionInfo[] };
      const agreeRes = await fetch("/api/account/agreements", { cache: "no-store" });
      const agreements = agreeRes.ok ? ((await agreeRes.json()) as Agreements) : { ...EMPTY_AGREEMENTS };
      const profileRes = await fetch("/api/account/profile", { cache: "no-store" });
      const profile = profileRes.ok ? ((await profileRes.json()) as Profile) : undefined;
      const eventsRes = await fetch("/api/account/security-events", { cache: "no-store" });
      const securityEvents = eventsRes.ok ? ((await eventsRes.json()) as { events: SecurityEvent[] }).events : [];
      setState({ signedIn: true, sessions: sessionsBody.sessions, agreements, profile, securityEvents });
    } catch (err) {
      setState({ ...emptyState(), error: (err as Error).message });
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

  const deleteAccount = async () => {
    if (deleteConfirm !== "delete my account") {
      setMessage("Type 'delete my account' to confirm.");
      return;
    }
    setDeleting(true);
    setMessage(undefined);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "delete-account" }),
        cache: "no-store",
      });
      if (res.ok) {
        await fetch("/api/account/logout", { method: "POST", cache: "no-store" });
        window.location.href = "/account";
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(body.error ?? `Could not delete account (${res.status}).`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setDeleting(false);
    }
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

      {state.profile && (
        <div className="content-block">
          <h2>Profile</h2>
          <div className="row">
            {state.profile.avatarUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={state.profile.avatarUrl} width={48} height={48} alt="" style={{ borderRadius: "50%" }} />
            )}
            <div>
              <p><strong>{state.profile.username}</strong></p>
              <p className="muted">
                Linked GitHub identity {state.profile.githubId ? `#${state.profile.githubId}` : "(none)"}
                {" · "}role <code className="inline">{state.profile.role}</code>
              </p>
            </div>
            <span className={`badge ${state.profile.status === "active" ? "" : "bad"}`}>{state.profile.status}</span>
          </div>
        </div>
      )}

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

      <div className="content-block">
        <h2>Security events</h2>
        {state.securityEvents.length === 0 ? (
          <p className="muted">No security events recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {state.securityEvents.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td><code className="inline">{e.action}</code></td>
                  <td className="muted">{e.targetType ? `${e.targetType}#${e.targetId ?? "?"}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="content-block">
        <h2>Delete account</h2>
        <p className="muted">
          Permanently closes this account, revokes every session, token, and signing key, and removes you from
          all organizations. Published packages remain but can no longer be maintained.
        </p>
        <div className="row">
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="type 'delete my account'"
            aria-label="confirmation text"
            style={{ flex: 1, maxWidth: 320 }}
          />
          <button type="button" className="btn btn-primary" onClick={deleteAccount} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>
    </main>
  );
}