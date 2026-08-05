import { NextResponse } from "next/server";
import { CONTROL_PROTOCOL_VERSION } from "@openagenthub/runtime";

export async function GET(): Promise<Response> {
  return NextResponse.json({
    product: "openagenthub",
    version: process.env.OPENAGENTHUB_PRODUCT_VERSION ?? "unknown",
    protocolVersion: CONTROL_PROTOCOL_VERSION,
  });
}
