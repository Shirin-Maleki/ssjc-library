"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import type { AuthFormState } from "@/lib/auth/actions";

interface SecretGateProps {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fieldLabel: string;
  submitLabel: string;
  pendingLabel: string;
  autoFocus?: boolean;
}

function SubmitButton({ pendingLabel, submitLabel }: { pendingLabel: string; submitLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : submitLabel}
    </Button>
  );
}

/** Shared shape behind both the staff Welcome gate and the Admin unlock gate — same
 * form, same error/loading/accessibility behavior, parameterized by which Server
 * Action it submits to. */
export function SecretGate({ action, fieldLabel, submitLabel, pendingLabel, autoFocus }: SecretGateProps) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <PasswordInput name="password" label={fieldLabel} error={state?.error} autoFocus={autoFocus} />
      <SubmitButton pendingLabel={pendingLabel} submitLabel={submitLabel} />
    </form>
  );
}
