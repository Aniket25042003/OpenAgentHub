import type { ContainerInfo, KnownAgentSpec } from "./types.js";

export function parsePsLine(line: string): { pid: number; command: string } | null {
  const m = line.match(/^\s*(\d+)\s+(.*)$/);
  if (!m) return null;
  return { pid: Number(m[1]), command: m[2] };
}

export function parseContainerLine(line: string): ContainerInfo | null {
  try {
    const raw = JSON.parse(line);
    return {
      id: raw.ID ?? "",
      name: (raw.Names ?? "").split(",")[0] ?? "",
      image: raw.Image ?? "",
      command: raw.Command ?? "",
      state: raw.State ?? "",
      status: raw.Status ?? "",
      ports: raw.Ports ?? "",
      created: raw.CreatedAt ?? "",
      labels: raw.Labels ?? "",
      mounts: raw.Mounts ?? "",
    };
  } catch {
    return null;
  }
}

export function processMatches(spec: KnownAgentSpec, commandLine: string): boolean {
  const lower = commandLine.toLowerCase();
  return spec.processPatterns.some((p) => lower.includes(p.toLowerCase()));
}

export function containerMatches(spec: KnownAgentSpec, c: ContainerInfo): boolean {
  const name = c.name.toLowerCase();
  const image = c.image.toLowerCase();
  return (
    spec.containerNamePatterns.some((p) => name.includes(p.toLowerCase())) ||
    spec.containerImagePatterns.some((p) => image.includes(p.toLowerCase()))
  );
}

export function isOahContainer(c: ContainerInfo): boolean {
  return c.mounts.toLowerCase().includes("oah-deps-");
}
