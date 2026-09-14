import type { ReactNode } from "react";
import Link from "next/link";
import type { NavItem } from "@/config/site";

interface NavTileProps {
  item: NavItem;
  variant: "primary" | "secondary";
  icon?: ReactNode;
}

export function NavTile({ item, variant, icon }: NavTileProps) {
  if (variant === "primary") {
    return (
      <Link
        href={item.href}
        className="group flex flex-1 flex-col gap-3 rounded-lg border border-border bg-surface p-6 transition-colors hover:border-border-strong hover:bg-surface-subtle sm:p-8"
      >
        {icon && <span className="text-brand-primary">{icon}</span>}
        <span className="text-xl font-semibold text-text-primary sm:text-2xl">{item.label}</span>
        <span className="text-sm text-text-secondary">{item.description}</span>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      className="flex flex-col gap-0.5 rounded-md border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-surface-subtle sm:w-56"
    >
      <span className="text-sm font-medium text-text-primary">{item.label}</span>
      <span className="text-xs text-text-muted">{item.description}</span>
    </Link>
  );
}
