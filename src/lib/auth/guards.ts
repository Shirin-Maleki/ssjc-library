import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionConfig } from "@/config/site";
import { verifySessionToken, isAdminActive, type Session } from "./session";

/** Reads and verifies the session cookie without redirecting. Use in places that need
 * to branch on session state (e.g. the admin page deciding unlock-form vs. placeholder). */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(sessionConfig.cookieName)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Any valid session (staff or admin) satisfies this — admin implies staff. Route-level
 * protection also happens in middleware; this is the defense-in-depth check at the
 * Server Component level, per docs/ARCHITECTURE.md §14. */
export async function requireStaffSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }
  return session;
}

/**
 * The centralized Phase 8 admin guard — requires a valid staff session AND currently
 * active admin elevation (`isAdminActive`), redirecting to the existing `/admin`
 * unlock flow otherwise (never a new admin-specific login form; `/admin` already
 * renders the password prompt when a session exists but elevation doesn't — see
 * `src/app/(staff)/admin/page.tsx`). `src/proxy.ts` already requires a bare staff
 * session for every `/admin/:path*` request, but that alone is not enough for a
 * Phase 8 mutation: it's page-render-time protection only, and a Server Action is
 * independently invokable (a POST straight to the action, no page render involved).
 * Every Phase 8 Server Action, Route Handler, and mutation must call this itself —
 * never assume the caller already went through a protected page. An admin session
 * whose elevation window has lapsed (`isAdminActive` false) is treated exactly like
 * "never elevated": redirected back to the unlock prompt, never allowed to silently
 * keep mutating — matching the sliding-renewal downgrade `maybeRenewSessionToken`
 * already performs for page navigation.
 */
export async function requireAdminSession(): Promise<Session> {
  const session = await getSession();
  if (!session || !isAdminActive(session)) {
    redirect("/admin");
  }
  return session;
}

/** Same admin-elevation check as `requireAdminSession()`, without the `redirect()` —
 * for a Route Handler (e.g. the admin source-cover proxy), where the right response
 * to missing/expired elevation is a JSON/HTTP status the caller's `fetch()` can
 * handle, never a 3xx redirect to an HTML page. Returns `true`/`false`; the caller
 * decides its own response shape. */
export async function hasActiveAdminSession(): Promise<boolean> {
  const session = await getSession();
  return session != null && isAdminActive(session);
}
