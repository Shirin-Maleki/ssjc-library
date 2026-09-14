"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface PasswordInputProps {
  name: string;
  label: string;
  autoComplete?: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PasswordInput({
  name,
  label,
  autoComplete = "current-password",
  error,
  disabled,
  autoFocus,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          className={cn(
            "h-12 w-full rounded-md border border-border bg-surface pl-4 pr-20 text-base text-text-primary placeholder:text-text-muted",
            "focus:outline-none",
            error && "border-danger"
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-2 my-1.5 rounded-sm px-3 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
