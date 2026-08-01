import type { AgentSummary } from "@/lib/api";

const TRUST_LABEL: Record<AgentSummary["trust"], { cls: string; text: string }> = {
  trusted: { cls: "good", text: "verified" },
  unknown: { cls: "warn", text: "unverified" },
  untrusted: { cls: "bad", text: "flagged" },
};

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const trust = TRUST_LABEL[agent.trust];
  return (
    <a className="card" href={`/agents/${agent.namespace}/${agent.name}`}>
      <h3>
        {agent.namespace}/{agent.name}
      </h3>
      <div className="meta">
        v{agent.version} · by {agent.author} · {agent.downloads} downloads
      </div>
      <p className="desc">{agent.description}</p>
      <footer>
        <span>
          {agent.tags.map((t) => (
            <span key={t} className="badge">
              {t}
            </span>
          ))}
        </span>
        <span className={`pill ${trust.cls}`}>{trust.text}</span>
      </footer>
    </a>
  );
}
