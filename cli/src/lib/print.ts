import { AgentHubError } from "@openagenthub/sdk";

export function printTable(header: string[], rows: (string | number)[][]): void {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const fmt = (cells: (string | number)[]) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(fmt(row));
}

export function formatErrors(err: unknown): string {
  if (err instanceof AgentHubError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
