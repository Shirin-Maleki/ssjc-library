import type { ReactNode } from "react";
import Link from "next/link";
import type { NavItem } from "@/config/site";
import { cn } from "@/lib/utils/cn";

interface NavTileProps {
  item: NavItem;
  variant: "primary" | "secondary";
  icon?: ReactNode;
  /** Which brand accent tints this tile's icon container — teal for the primary
   * "find/select" action, warm orange for the "create/add" action. Restrained: a
   * soft tint behind a black icon glyph, never a solid color fill. */
  accent?: "teal" | "warm";
  /** Find a Book is the dominant primary action (docs/DECISIONS.md) — a slightly
   * stronger border gives it a hair more visual weight when stacked with Add a Book
   * on a narrow phone viewport, without changing either tile's size. */
  dominant?: boolean;
}

const accentBg: Record<NonNullable<NavTileProps["accent"]>, string> = {
  teal: "bg-accent/20",
  warm: "bg-accent-warm/20",
};

export function NavTile({ item, variant, icon, accent, dominant }: NavTileProps) {
  if (variant === "primary") {
    return (
      <Link
        href={item.href}
        prefetch={false}
        className={cn(
          "group flex flex-1 flex-col gap-4 rounded-lg border bg-surface p-6 transition-colors hover:bg-surface-subtle sm:p-8",
          dominant ? "border-border-strong hover:border-text-primary" : "border-border hover:border-border-strong"
        )}
      >
        {icon && (
          <span
            className={cn(
              "inline-flex h-12 w-12 items-center justify-center rounded-lg text-text-primary",
              accent ? accentBg[accent] : "bg-surface-subtle"
            )}
          >
            {icon}
          </span>
        )}
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-semibold text-text-primary sm:text-2xl">{item.label}</h2>
          <span className="text-sm text-text-secondary">{item.description}</span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      prefetch={false}
      className="flex flex-col gap-0.5 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-surface-subtle sm:w-56"
    >
      <span className="text-sm font-medium text-text-primary">{item.label}</span>
      <span className="text-xs text-text-muted">{item.description}</span>
    </Link>
  );
}
