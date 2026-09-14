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
      <div className="flex flex-col items-center gap-4 text-center">
        <LogoMark size={64} />
        <div className="flex flex-col gap-1">
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
