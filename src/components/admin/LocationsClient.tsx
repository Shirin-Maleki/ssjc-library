"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusMessage } from "@/components/ui/StatusMessage";
import type { LocationWithUsage, LocationType } from "@/lib/locations/persistence";
import { createLocationAction, updateLocationAction, setLocationActiveAction } from "@/lib/admin/actions";

interface LocationsClientProps {
  locations: LocationWithUsage[];
}

const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string }[] = [
  { value: "corridor", label: "Corridor" },
  { value: "classroom", label: "Classroom" },
  { value: "other", label: "Other" },
];

/**
 * Small, admin-maintainable location list (Phase 9 addendum §8) — mirrors
 * `TaxonomyClient.tsx`'s exact CRUD conventions. Deliberately NOT an
 * enterprise inventory-management dashboard: add, rename, change type,
 * activate/deactivate, and see how many copies currently sit there — nothing
 * more.
 */
export function LocationsClient({ locations }: LocationsClientProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<LocationType>("other");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<LocationType>("other");

  async function handleCreate() {
    if (!newName.trim()) return;
    setBusy(true);
    const result = await createLocationAction({ displayName: newName.trim(), locationType: newType });
    setBusy(false);
    if (result.ok) {
      setNewName("");
      setNewType("other");
      setMessage({ tone: "success", text: `Location "${result.slug}" created.` });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  function startEdit(location: LocationWithUsage) {
    setEditingId(location.id);
    setEditName(location.displayName);
    setEditType(location.locationType);
  }

  async function handleSaveEdit(locationId: string) {
    setBusy(true);
    const result = await updateLocationAction({ locationId, displayName: editName.trim(), locationType: editType });
    setBusy(false);
    setEditingId(null);
    if (result.ok) {
      setMessage({ tone: "success", text: "Location updated." });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function handleToggleActive(location: LocationWithUsage) {
    setBusy(true);
    const result = await setLocationActiveAction(location.id, !location.isActive);
    setBusy(false);
    if (result.ok) {
      setMessage({ tone: "success", text: location.isActive ? "Location deactivated." : "Location activated." });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {message && <StatusMessage tone={message.tone === "error" ? "error" : "success"}>{message.text}</StatusMessage>}

      <section className="flex flex-col gap-4">
        {locations.length === 0 && <p className="text-text-secondary">No locations yet.</p>}
        <ul className="flex flex-col gap-2">
          {locations.map((location) => (
            <li key={location.id} className="rounded-lg border border-border bg-surface p-4">
              {editingId === location.id ? (
                <div className="flex flex-col gap-3">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
                  <select value={editType} onChange={(e) => setEditType(e.target.value as LocationType)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
                    {LOCATION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button size="md" disabled={busy} onClick={() => handleSaveEdit(location.id)}>
                      Save
                    </Button>
                    <Button size="md" variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-text-primary">
                      {location.displayName} {!location.isActive && <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-text-muted">Inactive</span>}
                    </p>
                    <p className="text-xs text-text-muted">
                      /{location.slug} · {LOCATION_TYPE_OPTIONS.find((o) => o.value === location.locationType)?.label ?? location.locationType}
                    </p>
                    <p className="mt-1 text-sm text-text-secondary">
                      {location.currentCopyCount} cop{location.currentCopyCount === 1 ? "y" : "ies"} currently here
                    </p>
                    {location.isActive && location.currentCopyCount > 0 && (
                      <p className="mt-1 text-sm text-warning">Move {location.currentCopyCount === 1 ? "it" : "them"} before deactivating this location.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="md" variant="secondary" disabled={busy} onClick={() => startEdit(location)}>
                      Edit
                    </Button>
                    <Button size="md" variant="ghost" disabled={busy || (location.isActive && location.currentCopyCount > 0)} onClick={() => handleToggleActive(location)}>
                      {location.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-4">
          <h3 className="font-medium text-text-primary">Add a location</h3>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Location name (e.g. Corridor 218)" className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
          <select value={newType} onChange={(e) => setNewType(e.target.value as LocationType)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
            {LOCATION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button size="md" disabled={busy || !newName.trim()} onClick={handleCreate} className="self-start">
            Create location
          </Button>
        </div>
      </section>
    </div>
  );
}
