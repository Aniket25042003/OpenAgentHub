import { NextRequest, NextResponse } from "next/server";

const TOKEN = process.env.OPENAGENTHUB_LOCAL_TOKEN ?? "";
const PUBLIC_PATHS = new Set(["/api/local/v1/health", "/api/local/v1/version"]);
const SAFE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function middleware(req: NextRequest): NextResponse {
  const host = req.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  if (!SAFE_HOSTNAMES.has(hostname)) {
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
      if (originHost !== host) {
        return NextResponse.json({ error: "forbidden: origin mismatch" }, { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/local/:path*"],
};
