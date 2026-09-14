"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionConfig } from "@/config/site";
import { passwordFormSchema } from "@/lib/validation/auth";
import { verifyPassword } from "./password";
import {
  createAdminSessionToken,
  createStaffSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from "./session";
import { getClientKey, isRateLimited, recordFailedAttempt, resetAttempts } from "./rateLimit";

export interface AuthFormState {
  error?: string;
}

const GENERIC_ERROR = "That password didn't work. Please try again.";
const RATE_LIMIT_ERROR = "Too many attempts. Please wait a few minutes and try again.";
const CONFIG_ERROR = "Access isn't configured yet. Contact your administrator.";

export async function authenticateStaff(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = passwordFormSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Enter the staff password." };
  }

  const key = await getClientKey("staff");
  if (isRateLimited(key)) {
    return { error: RATE_LIMIT_ERROR };
  }

  const hash = process.env.STAFF_PASSWORD_HASH;
  if (!hash) {
    console.error("STAFF_PASSWORD_HASH is not set — see .env.example.");
    return { error: CONFIG_ERROR };
  }

  const valid = await verifyPassword(parsed.data.password, hash);
  if (!valid) {
    recordFailedAttempt(key);
    return { error: GENERIC_ERROR };
  }

  resetAttempts(key);
  const token = await createStaffSessionToken();
  const store = await cookies();
  store.set(
    sessionConfig.cookieName,
    token,
    sessionCookieOptions(sessionConfig.staffSessionTtlSeconds)
  );
  redirect("/home");
}

export async function authenticateAdmin(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const store = await cookies();
  const existingToken = store.get(sessionConfig.cookieName)?.value;
  const existingSession = existingToken ? await verifySessionToken(existingToken) : null;
  if (!existingSession) {
    redirect("/");
  }

  const parsed = passwordFormSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Enter the admin password." };
  }

  const key = await getClientKey("admin");
  if (isRateLimited(key)) {
    return { error: RATE_LIMIT_ERROR };
  }

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    console.error("ADMIN_PASSWORD_HASH is not set — see .env.example.");
    return { error: CONFIG_ERROR };
  }

  const valid = await verifyPassword(parsed.data.password, hash);
  if (!valid) {
    recordFailedAttempt(key);
    return { error: GENERIC_ERROR };
  }

  resetAttempts(key);
  const token = await createAdminSessionToken();
  store.set(
    sessionConfig.cookieName,
    token,
    sessionCookieOptions(sessionConfig.staffSessionTtlSeconds)
  );
  redirect("/admin");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(sessionConfig.cookieName);
  redirect("/");
}
