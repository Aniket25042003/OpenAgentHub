import { NextRequest, NextResponse } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

export async function GET(req: NextRequest): Promise<Response> {
  const res = await registryFetch("/api/v1/me/profile", {}, cookieHeader(req));
  return jsonOrError(res);
}