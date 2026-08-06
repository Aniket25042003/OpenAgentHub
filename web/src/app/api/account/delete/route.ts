import { NextRequest, NextResponse } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const res = await registryFetch("/api/v1/me/delete", { method: "POST", body: JSON.stringify(body) }, cookieHeader(req));
  return jsonOrError(res);
}