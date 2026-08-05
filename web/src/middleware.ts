import { NextRequest, NextResponse } from "next/server";

const TOKEN = process.env.OPENAGENTHUB_LOCAL_TOKEN ?? "";
const PUBLIC_PATHS = new Set(["/api/local/v1/health", "/api/local/v1/version"]);
const SAFE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function hostnameOf(authority: string): string {
  const host = authority.trim();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host.slice(1) : host.slice(1, end);
  }
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

export function middleware(req: NextRequest): NextResponse {
  const host = req.headers.get("host") ?? "";
  if (!SAFE_HOSTNAMES.has(hostnameOf(host))) {
    return NextResponse.json({ error: "forbidden: unsafe host" }, { status: 403 });
  }

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (TOKEN !== "" && req.headers.get("authorization") !== `Bearer ${TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin !== null) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        return NextResponse.json({ error: "forbidden: bad origin" }, { status: 403 });
      }
      if (hostnameOf(originHost) !== hostnameOf(host)) {
        return NextResponse.json({ error: "forbidden: origin mismatch" }, { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/local/:path*"],
};
