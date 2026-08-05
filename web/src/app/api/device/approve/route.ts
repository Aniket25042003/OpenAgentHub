import { NextRequest, NextResponse } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const userCode = body.userCode ?? req.nextUrl.searchParams.get("user_code");
  if (!userCode) return NextResponse.json({ error: "missing user code" }, { status: 400 });
  const res = await registryFetch(`/api/v1/auth/approve?user_code=${encodeURIComponent(userCode)}`, { method: "POST" }, cookieHeader(req));
  if (!res.ok) return jsonOrError(res);
  return NextResponse.json({ ok: true });
}