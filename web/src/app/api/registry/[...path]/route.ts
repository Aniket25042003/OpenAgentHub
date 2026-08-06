import { NextRequest } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const segs = path.join("/");
  const res = await registryFetch(`/api/v1/${segs}${req.nextUrl.search}`, {}, cookieHeader(req));
  return jsonOrError(res);
}