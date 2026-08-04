import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAgent, getAgentVersion } from "@/lib/api";
import { InstallCommand } from "@/components/install";

interface PageProps {
  params: Promise<{ namespace: string; name: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { namespace, name } = await params;
  return { title: `${namespace}/${name} · OpenAgentHub` };
}

const SECURITY: Record<string, { cls: string; text: string }> = {
  clean: { cls: "good", text: "scan passed" },
  pending: { cls: "warn", text: "scan pending" },
  flagged: { cls: "bad", text: "flagged" },
  failed: { cls: "bad", text: "scan failed" },
};

export default async function AgentPage({ params }: PageProps) {
  const { namespace, name } = await params;
  let agent;
  let detail;
  try {
    [agent, detail] = await Promise.all([getAgent(namespace, name), getAgentVersion(namespace, name)]);
  } catch {
    notFound();
  }

  const manifest = detail.manifest as {
    runtime?: { language?: string };
    models?: { supported?: string[] };
    permissions?: string[];
    secrets?: string[];
    interfaces?: { cli?: unknown; mcp?: unknown; http?: unknown };
  };
  const security = detail.security ? SECURITY[detail.security.status] : SECURITY.pending;
  const findings = detail.security?.findings ?? [];
  const trust = detail.trust === "untrusted" ? { cls: "bad", text: "untrusted" } : detail.trust === "trusted" ? { cls: "good", text: "trusted" } : { cls: "warn", text: "unknown" };
  const interfaces = Object.keys(manifest.interfaces ?? {});

  return (
    <main>
      <p className="muted" style={{ marginBottom: 4 }}>
        <a href="/browse">← browse</a>
      </p>
      <span className="eyebrow clear">Agent manifest</span>
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>
          {agent.namespace}/{agent.name}
        </h1>
        <span className={`pill ${trust.cls}`}>{trust.text}</span>
        <span className={`pill ${security.cls}`}>{security.text}</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        v{detail.version} · by {detail.author} · {detail.downloadCount} downloads · published {detail.publishedAt}
      </p>
      <p>{agent.description}</p>

      <div className="row">
        <span className="badge">{manifest.runtime?.language ?? "other"}</span>
        <span className="badge">license {agent.license}</span>
        {manifest.models?.supported?.map((m) => (
          <span key={m} className="badge">
            model: {m}
          </span>
        ))}
        {(manifest.permissions ?? []).map((p) => (
          <span key={p} className="badge">
            perm: {p}
          </span>
        ))}
        {interfaces.map((i) => (
          <span key={i} className="badge">
            iface: {i}
          </span>
        ))}
      </div>

      <section>
        <h2>Install &amp; run</h2>
        <InstallCommand spec={`${agent.namespace}/${agent.name}`} />
      </section>

      <section>
        <h2>Declared secrets</h2>
        {(manifest.secrets ?? []).length > 0 ? (
          <p>
            {manifest.secrets!.map((s) => (
              <span key={s} className="badge">
                {s}
              </span>
            ))}
            <span className="muted">— set them with </span>
            <code className="inline">agent env {agent.namespace}/{agent.name} NAME=value</code>
          </p>
        ) : (
          <p className="muted">This agent declares no secrets.</p>
        )}
      </section>

      <section>
        <h2>Manifest</h2>
        <code className="code">{JSON.stringify(manifest, null, 2)}</code>
      </section>

      {findings.length > 0 && (
        <section>
          <h2>Security findings</h2>
          <ul>
            {findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
