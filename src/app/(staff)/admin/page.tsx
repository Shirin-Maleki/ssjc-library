import { getSession } from "@/lib/auth/guards";
import { isAdminActive } from "@/lib/auth/session";
import { authenticateAdmin } from "@/lib/auth/actions";
import { SecretGate } from "@/components/auth/SecretGate";

export default async function AdminPage() {
  // The (staff) layout already guarantees a valid session exists before this renders.
  const session = await getSession();
  const adminActive = session ? isAdminActive(session) : false;

  if (!adminActive) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-6 py-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-text-primary">Admin</h1>
          <p className="text-text-secondary">Enter the admin password to continue.</p>
        </div>
        <div className="w-full max-w-sm">
          <SecretGate
            action={authenticateAdmin}
            fieldLabel="Admin password"
            submitLabel="Unlock"
            pendingLabel="Unlocking…"
            autoFocus
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold text-text-primary">Admin</h1>
      <p className="max-w-md text-text-secondary">
        Review queues, taxonomy management, and import tools will be added in a later phase.
      </p>
    </div>
  );
}
