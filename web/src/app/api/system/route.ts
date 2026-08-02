import { NextResponse } from "next/server";
import { systemSnapshot } from "@openagenthub/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await systemSnapshot();
    return NextResponse.json(snap);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
