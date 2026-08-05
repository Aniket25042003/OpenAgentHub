import { NextResponse } from "next/server";
import { systemSnapshot } from "@openagenthub/runtime";

export async function GET(): Promise<Response> {
  const snapshot = await systemSnapshot();
  return NextResponse.json(snapshot);
}
