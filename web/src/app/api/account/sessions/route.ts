import { NextRequest, NextResponse } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

export async function GET(req: NextRequest): Promise<Response> {
  const res = await registryFetch("/api/v1/sessions", {}, cookieHeader(req));
  return jsonOrError(res);
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const sessionId = req.nextUrl.searchParams.get("id");
  if (!sessionId) return NextResponse.json({ error: "missing session id" }, { status: 400 });
  const res = await registryFetch(`/api/v1/sessions/${sessionId}`, { method: "DELETE" }, cookieHeader(req));
  if (!res.ok) return jsonOrError(res);
  return NextResponse.json({ ok: true });
}