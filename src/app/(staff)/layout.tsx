import type { ReactNode } from "react";
import { requireStaffSession } from "@/lib/auth/guards";
import { Header } from "@/components/layout/Header";
import { PageShell } from "@/components/layout/PageShell";
import { ReadingListsProvider } from "@/components/reading-lists/ReadingListsProvider";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  await requireStaffSession();

  return (
    <ReadingListsProvider>
      <div className="flex min-h-dvh flex-col">
        <Header />
        <PageShell className="flex flex-1 flex-col py-8 sm:py-12">{children}</PageShell>
      </div>
    </ReadingListsProvider>
  );
}
