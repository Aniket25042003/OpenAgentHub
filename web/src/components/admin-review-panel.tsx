"use client";

import { useCallback, useEffect, useState } from "react";

interface ReviewQueueItem {
  id: number;
  namespace: string;
  name: string;
  version: string;
  digest: string;
  publishedAt: string;
  publisher: string;
  signerFingerprint?: string | null;
  reviewStatus: string;
  securityStatus: string;
  riskScore: number;
  permissions: string[];
  secrets: string[];
  downloads: number;
}

type State =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ReviewQueueItem[] };

export function AdminReviewPanel() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [action, setAction] = useState<Record<number, { action: string; reason: string }>>({});

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/registry/admin/review-queue", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setState({ status: "anon" });
        return;
      }
      if (!res.ok) throw new Error(`review queue API returned ${res.status}`);
      const items = ((await res.json()) as { items: ReviewQueueItem[] }).items;
      setState({ status: "ready", items });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async (item: ReviewQueueItem) => {
    const chosen = action[item.id];
    if (!chosen?.action) return;
    const res = await fetch(`/api/registry/admin/agents/${item.namespace}/${item.name}/versions/${item.version}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: chosen.action, reason: chosen.reason || "no reason given" }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`Review failed: ${(body as { error?: string }).error ?? res.status}`);
      return;
    }
    await refresh();
  };

  if (state.status === "loading") {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Admin</span>
          <h1>Review queue</h1>
          <p className="muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (state.status === "anon") {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Admin</span>
          <h1>Reviewers only</h1>
          <p>You need a reviewer or admin account to access the review queue.</p>
        </div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main>
        <div className="hero">
          <span className="eyebrow">Admin</span>
          <h1>Could not load</h1>
          <p className="pill bad">{state.message}</p>
          <button type="button" className="btn btn-secondary" onClick={refresh}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const { items } = state;

  return (
    <main>
      <div className="hero">
        <span className="eyebrow">Admin</span>
        <h1>Review queue</h1>
        <p className="muted">{items.length} version(s) awaiting review.</p>
      </div>

      {items.length === 0 ? (
        <div className="content-block">
          <p className="muted">Nothing pending. All versions have been reviewed.</p>
        </div>
      ) : (
        items.map((item) => (
          <div className="content-block" key={item.id}>
            <div className="row">
              <h2 style={{ margin: 0 }}>
                <code className="inline">{item.namespace}/{item.name}</code>{" "}
                <span className="muted">@{item.version}</span>
              </h2>
              <span className={`pill ${item.riskScore >= 80 ? "bad" : item.riskScore >= 40 ? "warn" : "good"}`}>
                risk {item.riskScore}
              </span>
            </div>
            <p className="muted">
              Published by <code className="inline">{item.publisher}</code> · {new Date(item.publishedAt).toLocaleString()} ·{" "}
              {item.downloads} downloads
            </p>
            <p>
              Review: <span className={`pill ${item.reviewStatus === "pending" ? "warn" : "good"}`}>{item.reviewStatus}</span>{" "}
              Security: <span className={`pill ${item.securityStatus === "flagged" ? "bad" : "good"}`}>{item.securityStatus}</span>
            </p>
            {item.permissions.length > 0 && (
              <p className="muted">
                Permissions: {item.permissions.map((p) => <code className="inline" key={p}>{p}</code>).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, " ", el]), [])}
              </p>
            )}
            {item.secrets.length > 0 && (
              <p className="muted">
                Secrets: {item.secrets.map((s) => <code className="inline" key={s}>{s}</code>).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, " ", el]), [])}
              </p>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <select
                value={action[item.id]?.action ?? ""}
                onChange={(e) => setAction((a) => ({ ...a, [item.id]: { action: e.target.value, reason: a[item.id]?.reason ?? "" } }))}
              >
                <option value="" disabled>
                  Action…
                </option>
                <option value="verify">Verify</option>
                <option value="warning">Warn</option>
                <option value="request">Request changes</option>
                <option value="reject">Reject</option>
                <option value="revoke">Revoke</option>
              </select>
              <input
                type="text"
                placeholder="Reason"
                value={action[item.id]?.reason ?? ""}
                onChange={(e) => setAction((a) => ({ ...a, [item.id]: { action: a[item.id]?.action ?? "", reason: e.target.value } }))}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={!action[item.id]?.action} onClick={() => submit(item)}>
                Submit review
              </button>
            </div>
          </div>
        ))
      )}
    </main>
  );
}