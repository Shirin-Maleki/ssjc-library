import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>
  );
}
