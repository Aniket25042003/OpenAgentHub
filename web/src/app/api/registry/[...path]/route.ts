import { NextRequest } from "next/server";
import { cookieHeader, jsonOrError, registryFetch } from "@/lib/account-bff";

type RouteContext = { params: Promise<{ path: string[] }> };

function target(req: NextRequest, path: string[]): string {
  return `/api/v1/${path.join("/")}${req.nextUrl.search}`;
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const res = await registryFetch(target(req, path), {}, cookieHeader(req));
  return jsonOrError(res);
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  let body: string | undefined;
  try {
    body = JSON.stringify(await req.json());
  } catch {
    body = undefined;
  }
  const res = await registryFetch(target(req, path), { method: "POST", body }, cookieHeader(req));
  return jsonOrError(res);
}

export async function DELETE(req: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const res = await registryFetch(target(req, path), { method: "DELETE" }, cookieHeader(req));
  return jsonOrError(res);
}