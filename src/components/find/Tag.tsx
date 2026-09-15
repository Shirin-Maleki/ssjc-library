import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** A plain, neutral chip for digital topic/theme tags — deliberately not
 * color-coded per tag. A row of differently-colored tags would read as a "rainbow,"
 * which the brand's own "use color sparingly" guidance and the product's calm visual
 * direction both rule out. See CategoryBadge for the one place a brand color is
 * actually used, and why. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-xs text-text-secondary",
        className
      )}
    >
      {children}
    </span>
  );
}
