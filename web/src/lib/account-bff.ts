import { NextRequest, NextResponse } from "next/server";

export const REGISTRY_URL = (process.env.OPENAGENTHUB_REGISTRY_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function registryFetch(path: string, init: RequestInit = {}, cookies?: string): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (cookies) headers.set("Cookie", cookies);
  return fetch(`${REGISTRY_URL}${path}`, { ...init, headers, cache: "no-store" });
}

export function cookieHeader(req: NextRequest): string | undefined {
  return req.headers.get("cookie") ?? undefined;
}

export interface RegistryError {
  detail?: string;
}

export async function jsonOrError(res: Response): Promise<NextResponse> {
  if (res.ok) return NextResponse.json(await res.json());
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as RegistryError;
    if (body.detail) detail = body.detail;
  } catch {
    /* no body */
  }
  return NextResponse.json({ error: detail }, { status: res.status });
}