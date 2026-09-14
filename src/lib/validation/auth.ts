import { z } from "zod";

export const passwordFormSchema = z.object({
  password: z.string().min(1, "Enter a password."),
});
