"use client";

import { useEffect, useState } from "react";

interface CatalogItem {
  namespace: string;
  name: string;
  version: string;
  digest: string;
  author: string;
  description: string;
  license: string;
  runtime?: string;
  interfaces: string[];
  permissions: string[];
  secrets: string[];
  downloads: number;
  publisher: string;
  signerVerified: boolean;
  reviewStatus: string;
  securityStatus: string;
  yanked: boolean;
  publishedAt: string;
  reviewedAt?: string;
}

const REGISTRY_URL = (process.env.NEXT_PUBLIC_REGISTRY_URL ?? "https://registry.openagenthub.dev").replace(/\/$/, "");

function statusPill(item: CatalogItem): { cls: string; text: string; title: string } {
  if (item.yanked) return { cls: "bad", text: "yanked", title: "removed from the registry" };
  if (item.reviewStatus === "rejected" || item.reviewStatus === "revoked")
    return { cls: "bad", text: item.reviewStatus, title: "blocked by the registry" };
  if (item.securityStatus === "flagged") return { cls: "bad", text: "flagged", title: "automated scan found issues" };
  if (item.reviewStatus === "verified" && item.securityStatus === "clean")
    return { cls: "good", text: "verified", title: "reviewed and scanned clean" };
  if (item.reviewStatus === "warning") return { cls: "warn", text: "warning", title: "review warnings apply" };
  return { cls: "warn", text: "pending", title: "awaiting review" };
}

export default function AgentCatalog() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: "50", sort: "downloads" });
    fetch(`${REGISTRY_URL}/api/v1/catalog?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalog returned ${r.status}`))))
      .then((data: { items: CatalogItem[] }) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = (items ?? []).filter((i) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      `${i.namespace}/${i.name}`.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.author.toLowerCase().includes(q)
    );
  });

  return (
    <main>
      <section className="band" style={{ paddingTop: 72, paddingBottom: 48 }}>
        <div className="container">
          <div className="section-head center">
            <span className="eyebrow">Registry</span>
            <h1>Browse agents</h1>
            <p>
              Every package is signed by its author and shows its review, scan, and permission status. Install with{" "}
              <code className="inline">openagenthub install namespace/name</code>.
            </p>
          </div>
          <div style={{ maxWidth: 420, margin: "24px auto 0" }}>
            <input
              type="search"
              placeholder="search agents, e.g. github, pr, notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)" }}
            />
          </div>
        </div>
      </section>

      <section className="band raised" style={{ paddingTop: 40, paddingBottom: 64 }}>
        <div className="container">
          {error ? (
            <div style={{ textAlign: "center", padding: 48 }}>
              <p>Could not reach the registry.</p>
              <p className="muted">{error}</p>
            </div>
          ) : items === null ? (
            <p className="muted" style={{ textAlign: "center", padding: 48 }}>
              Loading agents…
            </p>
          ) : filtered.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: 48 }}>
              No agents found{search ? ` for "${search}"` : " yet"}.
            </p>
          ) : (
            <div className="catalog-grid">
              {filtered.map((item) => {
                const pill = statusPill(item);
                return (
                  <article className="catalog-card" key={`${item.namespace}/${item.name}@${item.version}`}>
                    <div className="catalog-head">
                      <h3>
                        {item.namespace}/{item.name}
                      </h3>
                      <span className={`catalog-pill ${pill.cls}`} title={pill.title}>
                        {pill.text}
                      </span>
                    </div>
                    <p className="catalog-meta">
                      v{item.version} · by {item.publisher}
                      {item.signerVerified ? " · signature verified" : " · unverified signer"}
                      {item.license ? ` · ${item.license}` : ""}
                    </p>
                    <p className="catalog-desc">{item.description}</p>
                    <p className="catalog-meta">
                      {item.downloads} installs · published {new Date(item.publishedAt).toLocaleDateString()}
                      {item.reviewedAt ? ` · reviewed ${new Date(item.reviewedAt).toLocaleDateString()}` : ""}
                    </p>
                    {item.permissions.length > 0 && (
                      <p className="catalog-meta">
                        permissions: {item.permissions.map((p) => <code className="inline" key={p}>{p}</code>).join(" ")}
                      </p>
                    )}
                    {item.secrets.length > 0 && (
                      <p className="catalog-meta">
                        secrets: {item.secrets.map((s) => <code className="inline" key={s}>{s}</code>).join(" ")}
                      </p>
                    )}
                    <code className="catalog-install">openagenthub install {item.namespace}/{item.name}</code>
                    <p className="catalog-note">
                      “verified” marks a reviewed, scanned-clean version — not a guarantee of safety.
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}