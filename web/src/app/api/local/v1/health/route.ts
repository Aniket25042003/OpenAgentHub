import { NextResponse } from "next/server";
import { CONTROL_PROTOCOL_VERSION } from "@openagenthub/runtime";

export async function GET(): Promise<Response> {
  return NextResponse.json({ status: "ok", protocolVersion: CONTROL_PROTOCOL_VERSION });
}
