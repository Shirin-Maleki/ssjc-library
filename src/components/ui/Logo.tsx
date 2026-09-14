import { brandConfig } from "@/config/brand";
import { cn } from "@/lib/utils/cn";

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/**
 * Neutral placeholder mark — a deliberately abstract open-book motif, not an attempt
 * at the school's real crest. Branding status: PENDING, see docs/BRANDING.md.
 *
 * To replace with the real logo later: swap this component's contents for an <img>
 * (or next/image) referencing public/brand/logo.svg — callers pass only `size`, so no
 * call site needs to change.
 */
export function LogoMark({ size = 56, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      role="img"
      aria-label={brandConfig.logoAltText}
      className={cn("text-brand-primary", className)}
    >
      <rect x="1" y="1" width="54" height="54" rx="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M28 19c-3.5-3-8-4-13-3v19c5-1 9.5 0 13 3 3.5-3 8-4 13-3V16c-5-1-9.5 0-13 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M28 19v19" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
