import { NextResponse, type NextRequest } from "next/server";
import { sessionConfig } from "@/config/site";
import { maybeRenewSessionToken, sessionCookieOptions, verifySessionToken } from "@/lib/auth/session";

export const config = {
  matcher: [
    "/home/:path*",
    "/find/:path*",
    "/add/:path*",
    "/lists/:path*",
    "/guide/:path*",
    "/teacher-catalog/:path*",
    "/admin/:path*",
  ],
};

/**
 * Route protection happens here, server-side, before any protected page renders —
 * not by hiding UI client-side. Staff and admin share the same gate; the finer-grained
 * "staff session but admin not yet elevated" branch is decided at the page level
 * (see src/app/(staff)/admin/page.tsx), since that's a UI state, not an access denial.
 */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(sessionConfig.cookieName)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next();
  const renewed = await maybeRenewSessionToken(session);
  if (renewed) {
    response.cookies.set(
      sessionConfig.cookieName,
      renewed,
      sessionCookieOptions(sessionConfig.staffSessionTtlSeconds)
    );
  }
  return response;
}
