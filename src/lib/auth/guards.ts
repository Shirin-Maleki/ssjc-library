import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionConfig } from "@/config/site";
import { verifySessionToken, type Session } from "./session";

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
