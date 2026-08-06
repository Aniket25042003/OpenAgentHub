import { NextRequest, NextResponse } from "next/server";
import { cookieHeader, registryFetch } from "@/lib/account-bff";

export async function POST(req: NextRequest): Promise<Response> {
  const res = await registryFetch("/api/v1/logout", { method: "POST" }, cookieHeader(req));
  const cookie = res.headers.get("set-cookie");
  const out = NextResponse.json({ ok: true });
  if (cookie) out.headers.set("set-cookie", cookie);
  return out;
}