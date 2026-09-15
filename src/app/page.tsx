import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";
import { LogoMark } from "@/components/ui/Logo";
import { siteConfig } from "@/config/site";
import { WelcomeGate } from "@/components/welcome/WelcomeGate";

export default async function WelcomePage() {
  const session = await getSession();
  if (session) {
    redirect("/home");
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-10 px-6 py-12">
      <div className="flex flex-col items-center gap-5 text-center">
        {/* A soft, restrained two-tone halo behind the mark — the one deliberate
            brand-color moment on this screen, per the "small accent around the
            logo/title area" direction. Light enough that it reads as texture, not a
            colored panel; the logo itself is never recolored or cropped. */}
        <div className="relative flex items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute h-28 w-28 rounded-full bg-highlight/25 sm:h-32 sm:w-32"
          />
          <div
            aria-hidden="true"
            className="absolute h-28 w-28 translate-x-3 translate-y-2 rounded-full bg-accent/15 sm:h-32 sm:w-32"
          />
          <LogoMark size={112} className="relative" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">
            {siteConfig.appName}
          </h1>
          <p className="text-sm text-text-muted">{siteConfig.tagline}</p>
        </div>
      </div>
      <WelcomeGate />
    </main>
  );
}
