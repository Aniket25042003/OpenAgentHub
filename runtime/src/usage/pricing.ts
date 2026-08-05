import type { UsageObservation } from "./types.js";

export const CLAUDE_PRICING_VERSION = 1;

interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: Array<{ prefix: string; price: ModelPrice }> = [
  { prefix: "claude-opus-4", price: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } },
  { prefix: "claude-sonnet-4", price: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { prefix: "claude-haiku-4", price: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
  { prefix: "claude-3-5-haiku", price: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 } },
  { prefix: "claude-3-opus", price: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } },
  { prefix: "claude-3-sonnet", price: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { prefix: "claude-3-haiku", price: { input: 0.25, output: 1.25, cacheWrite: 0.3, cacheRead: 0.03 } },
];

export function claudePrice(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  const match = PRICING.find((p) => model.startsWith(p.prefix));
  return match?.price;
}

export function estimateClaudeCost(obs: Omit<UsageObservation, "costEstimated">): number | undefined {
  const price = claudePrice(obs.model);
  if (!price) return undefined;
  return (
    ((obs.tokensIn ?? 0) * price.input +
      (obs.tokensOut ?? 0) * price.output +
      (obs.cacheWrite ?? 0) * price.cacheWrite +
      (obs.cacheRead ?? 0) * price.cacheRead) /
    1_000_000
  );
}
