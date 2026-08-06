import { NextRequest, NextResponse } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

export async function GET(req: NextRequest): Promise<Response> {
  const limit = req.nextUrl.searchParams.get("limit") ?? "50";
  const res = await registryFetch(`/api/v1/me/security-events?limit=${limit}`, {}, cookieHeader(req));
  return jsonOrError(res);
}