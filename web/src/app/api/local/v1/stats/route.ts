import { NextResponse } from "next/server";
import { getUsageStats, openUsageStore } from "@openagenthub/runtime";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const agent = searchParams.get("agent") ?? undefined;
  const store = openUsageStore();
  try {
    const stats = getUsageStats(store, { from, to, agent });
    return NextResponse.json(stats);
  } finally {
    store.close();
  }
}
