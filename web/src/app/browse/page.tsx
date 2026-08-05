import type { Metadata } from "next";
import { searchAgents, type AgentSummary } from "@/lib/api";
import { AgentCard } from "../agent-card";

export const metadata: Metadata = {
  title: "Browse agents · OpenAgentHub",
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function BrowsePage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  let items: AgentSummary[] = [];
  let error: string | undefined;
  try {
    items = await searchAgents(q);
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main>
      <div className="hero">
        <span className="eyebrow">Registry</span>
        <h1>Browse agents</h1>
        <p>
          Agents published to the registry. Install with{" "}
          <code className="inline">openagenthub install namespace/name</code>, signed and sandboxed by default.
        </p>
        <form className="search-form" method="GET" action="/browse">
          <input name="q" defaultValue={q ?? ""} placeholder="search agents, e.g. github, pr, notes" />
          <button type="submit">Search</button>
        </form>
      </div>

      {error ? (
        <div className="not-found">
          <p>Could not reach the registry.</p>
          <p className="muted">{error}</p>
          <p className="muted">
            Start it with: <code className="inline">cd registry && uv run uvicorn app.main:app --port 8000</code>
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="not-found">
          <p>No agents found{q ? ` for "${q}"` : " yet"}.</p>
        </div>
      ) : (
        <div className="grid">
          {items.map((a) => (
            <AgentCard key={`${a.namespace}/${a.name}`} agent={a} />
          ))}
        </div>
      )}
    </main>
  );
}
