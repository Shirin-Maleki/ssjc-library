import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/guards";
import { db } from "@/db/client";
import { listLocationsWithUsage } from "@/lib/locations/persistence";
import { LocationsClient } from "@/components/admin/LocationsClient";

export default async function AdminLocationsPage() {
  await requireAdminSession();
  const locations = await listLocationsWithUsage(db);

  return (
    <div className="flex w-full flex-col gap-6 py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-text-primary">Locations</h1>
        <Link href="/admin" className="text-sm font-medium text-text-secondary underline underline-offset-4">
          Admin overview
        </Link>
      </div>
      <p className="max-w-2xl text-text-secondary">
        Where physical copies currently are — corridors, classrooms, and other spaces. Teachers move copies between these from{" "}
        <Link href="/move" className="underline underline-offset-4">
          Move a Book
        </Link>
        .
      </p>
      <LocationsClient locations={locations} />
    </div>
  );
}
