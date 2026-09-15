import Image from "next/image";
import { brandConfig } from "@/config/brand";
import { cn } from "@/lib/utils/cn";

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/** Intrinsic aspect ratio of public/brand/logo.png (1000×950) — preserved rather than
 * forced square, per "preserve its proportions, never redraw or modify it." */
const LOGO_ASPECT_RATIO = 950 / 1000;

/**
 * The real school logo (provided 2026-09-14) — a transparent PNG, used as-is. Callers
 * pass only `size` (the width; height follows the artwork's own proportions), so no
 * call site needed to change when this replaced the earlier placeholder mark.
 */
export function LogoMark({ size = 56, className }: LogoMarkProps) {
  const height = Math.round(size * LOGO_ASPECT_RATIO);

  return (
    <Image
      src="/brand/logo.png"
      alt={brandConfig.logoAltText}
      width={size}
      height={height}
      className={cn("object-contain", className)}
      priority
    />
  );
}
