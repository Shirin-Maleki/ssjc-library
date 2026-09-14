import bcrypt from "bcryptjs";

/** Server-side only. Never compares or logs the plaintext value. */
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  if (!plainText || !hash) return false;
  return bcrypt.compare(plainText, hash);
}
