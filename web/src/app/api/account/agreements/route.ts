import { NextRequest, NextResponse } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

export async function GET(req: NextRequest): Promise<Response> {
  const res = await registryFetch("/api/v1/me/agreements", {}, cookieHeader(req));
  return jsonOrError(res);
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const res = await registryFetch("/api/v1/me/agreements", { method: "POST", body: JSON.stringify(body) }, cookieHeader(req));
  return jsonOrError(res);
}