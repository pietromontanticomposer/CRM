import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeNextPath,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

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

const withSecurityHeaders = (response: NextResponse) => {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  return response;
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicAsset(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (PUBLIC_PATHS.has(pathname) || EXEMPT_API_PATHS.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (pathname === "/login") {
    if (session) {
      return withSecurityHeaders(
        NextResponse.redirect(new URL("/crm", request.url))
      );
    }
    return withSecurityHeaders(NextResponse.next());
  }

  if (session) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (pathname.startsWith("/api/")) {
    return withSecurityHeaders(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", normalizeNextPath(`${pathname}${search}`));
  return withSecurityHeaders(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: ["/:path*"],
};
