import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeNextPath,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/api/auth/login", "/api/auth/logout"]);

const EXEMPT_API_PATHS = new Set([
  "/api/postmark/inbound",
  "/api/gmail/sync",
  "/api/gmail/backfill-attachments",
  "/api/reminders/run",
  "/api/ai/classify-all",
]);

const isPublicAsset = (pathname: string) =>
  pathname.startsWith("/_next/") ||
  pathname === "/favicon.ico" ||
  /\.[a-zA-Z0-9]+$/.test(pathname);

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname) || EXEMPT_API_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (pathname === "/login") {
    if (session) {
      return NextResponse.redirect(new URL("/crm", request.url));
    }
    return NextResponse.next();
  }

  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", normalizeNextPath(`${pathname}${search}`));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/:path*"],
};
