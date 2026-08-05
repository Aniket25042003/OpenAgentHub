export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitCore(a);
  const [coreB, preB] = splitCore(b);
  const n = Math.max(coreA.length, coreB.length);
  for (let i = 0; i < n; i++) {
    const x = coreA[i] ?? 0;
    const y = coreB[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA.localeCompare(preB);
}

export function highestVersion(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return versions.slice().sort(compareVersions)[versions.length - 1];
}

function splitCore(v: string): [(string | number)[], string | undefined] {
  const dash = v.indexOf("-");
  const core = dash === -1 ? v : v.slice(0, dash);
  const pre = dash === -1 ? undefined : v.slice(dash + 1);
  return [
    core.split(".").map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : p)),
    pre,
  ];
}
