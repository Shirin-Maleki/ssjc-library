import Link from "next/link";
import { LogoMark } from "@/components/ui/Logo";
import { siteConfig } from "@/config/site";
import { LogoutForm } from "./LogoutForm";

export function Header() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/home" className="flex items-center gap-2.5 rounded-sm">
          <LogoMark size={28} />
          <span className="text-sm font-semibold text-text-primary">{siteConfig.appName}</span>
        </Link>
        <LogoutForm />
      </div>
    </header>
  );
}
