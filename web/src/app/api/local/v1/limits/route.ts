import { NextResponse } from "next/server";
import { openUsageStore, setManualLimit } from "@openagenthub/runtime";

export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    provider: string;
    window?: string;
    plan?: string;
    usedPercent?: number;
    units?: string;
    creditsUsed?: number;
    creditsTotal?: number;
    resetAt?: string;
  };
  const store = openUsageStore();
  try {
    const provider = body.provider as "claude" | "codex" | "opencode";
    if (!["claude", "codex", "opencode"].includes(provider)) {
      return NextResponse.json({ error: "unsupported provider" }, { status: 400 });
    }
    if (body.resetAt !== undefined && Number.isNaN(Date.parse(body.resetAt))) {
      return NextResponse.json({ error: "resetAt must be ISO 8601" }, { status: 400 });
    }
    const limit: {
      provider: "claude" | "codex" | "opencode";
      window: string;
      plan?: string;
      units?: string;
      resetAt?: string;
      usedPercent?: number;
      creditsUsed?: number;
      creditsTotal?: number;
    } = {
      provider,
      window: body.window ?? "manual",
    };
    if (body.plan !== undefined) limit.plan = String(body.plan);
    if (body.units) limit.units = body.units;
    if (body.resetAt !== undefined) limit.resetAt = new Date(body.resetAt).toISOString();
    for (const [k, v] of [
      ["usedPercent", body.usedPercent],
      ["creditsUsed", body.creditsUsed],
      ["creditsTotal", body.creditsTotal],
    ] as const) {
      if (v !== undefined) {
        if (!Number.isFinite(v) || v < 0) {
          return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 });
        }
        limit[k] = v;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setManualLimit(store, limit as any);
    return NextResponse.json(store.listLimits(provider));
  } finally {
    store.close();
  }
}