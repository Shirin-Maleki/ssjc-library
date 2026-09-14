import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "error" | "info" | "success";

interface StatusMessageProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

const toneStyles: Record<Tone, string> = {
  error: "bg-danger-bg text-danger",
  info: "bg-surface-subtle text-text-secondary",
  success: "bg-success-bg text-success",
};

export function StatusMessage({ tone = "info", children, className }: StatusMessageProps) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md px-4 py-3 text-sm", toneStyles[tone], className)}
    >
      {children}
    </p>
  );
}
