import { NextResponse } from "next/server";

export async function POST(): Promise<Response> {
  setImmediate(() => process.kill(process.pid, "SIGTERM"));
  return NextResponse.json({ stopping: true });
}
