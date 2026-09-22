"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusMessage } from "@/components/ui/StatusMessage";
import type { CategoryHealthRow, TaxonomySuggestionRow } from "@/lib/admin/categoryHealth";
import {
  createCategoryAction,
  updateCategoryAction,
  setCategoryActiveAction,
  approveTaxonomySuggestionAction,
  rejectTaxonomySuggestionAction,
  postponeTaxonomySuggestionAction,
  mergeTaxonomySuggestionAction,
} from "@/lib/admin/actions";

interface TaxonomyClientProps {
  categories: CategoryHealthRow[];
  suggestions: TaxonomySuggestionRow[];
}

export function TaxonomyClient({ categories, suggestions }: TaxonomyClientProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [mergingSuggestionId, setMergingSuggestionId] = useState<string | null>(null);
  const [mergeTargetSlug, setMergeTargetSlug] = useState("");
  const [approvingSuggestionId, setApprovingSuggestionId] = useState<string | null>(null);
  const [approveLabel, setApproveLabel] = useState("");

  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");
  const decidedSuggestions = suggestions.filter((s) => s.status !== "pending");

  async function handleCreate() {
    if (!newLabel.trim()) return;
    setBusy(true);
    const result = await createCategoryAction({ label: newLabel.trim(), description: newDescription.trim() || undefined });
    setBusy(false);
    if (result.ok) {
      setNewLabel("");
      setNewDescription("");
      setMessage({ tone: "success", text: `Category "${result.slug}" created.` });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  function startEdit(category: CategoryHealthRow) {
    setEditingId(category.id);
    setEditLabel(category.label);
    setEditDescription(category.description ?? "");
  }

  async function handleSaveEdit(categoryId: string) {
    setBusy(true);
    const result = await updateCategoryAction({ categoryId, label: editLabel.trim(), description: editDescription.trim() || null });
    setBusy(false);
    setEditingId(null);
    if (result.ok) {
      setMessage({ tone: "success", text: "Category updated." });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function handleToggleActive(category: CategoryHealthRow) {
    setBusy(true);
    const result = await setCategoryActiveAction(category.id, !category.isActive);
    setBusy(false);
    if (result.ok) {
      setMessage({ tone: "success", text: category.isActive ? "Category deactivated." : "Category activated." });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function handleApprove(suggestionId: string) {
    if (!approveLabel.trim()) return;
    setBusy(true);
    const result = await approveTaxonomySuggestionAction(suggestionId, approveLabel.trim());
    setBusy(false);
    setApprovingSuggestionId(null);
    if (result.ok) {
      setMessage({ tone: "success", text: `Category "${result.categorySlug}" created from this suggestion.` });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function handleReject(suggestionId: string) {
    setBusy(true);
    const result = await rejectTaxonomySuggestionAction(suggestionId);
    setBusy(false);
    if (result.ok) router.refresh();
    else setMessage({ tone: "error", text: result.message });
  }

  async function handlePostpone(suggestionId: string) {
    setBusy(true);
    const result = await postponeTaxonomySuggestionAction(suggestionId);
    setBusy(false);
    if (result.ok) router.refresh();
    else setMessage({ tone: "error", text: result.message });
  }

  async function handleMerge(suggestionId: string) {
    const target = categories.find((c) => c.slug === mergeTargetSlug);
    if (!target) return;
    setBusy(true);
    const result = await mergeTaxonomySuggestionAction(suggestionId, target.id);
    setBusy(false);
    setMergingSuggestionId(null);
    if (result.ok) {
      setMessage({ tone: "success", text: `Merged into "${target.label}".` });
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  return (
    <div className="flex w-full flex-col gap-10">
      {message && <StatusMessage tone={message.tone === "error" ? "error" : "success"}>{message.text}</StatusMessage>}

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-text-primary">Categories</h2>
        {categories.length === 0 && <p className="text-text-secondary">No categories yet.</p>}
        <ul className="flex flex-col gap-2">
          {categories.map((category) => (
            <li key={category.id} className="rounded-lg border border-border bg-surface p-4">
              {editingId === category.id ? (
                <div className="flex flex-col gap-3">
                  <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
                  <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} placeholder="Shelving guidance (optional)" className="rounded-md border border-border-input bg-surface px-3 py-2 text-base" />
                  <div className="flex gap-2">
                    <Button size="md" disabled={busy} onClick={() => handleSaveEdit(category.id)}>
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
                      {category.label} {!category.isActive && <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-text-muted">Inactive</span>}
                    </p>
                    <p className="text-xs text-text-muted">/{category.slug}</p>
                    {category.description && <p className="mt-1 text-sm text-text-secondary">{category.description}</p>}
                    <p className="mt-1 text-sm text-text-secondary">
                      {category.activeBookCount} active book{category.activeBookCount === 1 ? "" : "s"}
                      {category.pendingReviewBookCount > 0 ? `, ${category.pendingReviewBookCount} pending` : ""}
                    </p>
                    {!category.canDeactivate && category.isActive && (
                      <p className="mt-1 text-sm text-warning">
                        {category.activeBookCount + category.pendingReviewBookCount} book{category.activeBookCount + category.pendingReviewBookCount === 1 ? "" : "s"} still use this category. Re-categorize
                        {category.activeBookCount + category.pendingReviewBookCount === 1 ? " it" : " them"} before deactivating it.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="md" variant="secondary" disabled={busy} onClick={() => startEdit(category)}>
                      Edit
                    </Button>
                    <Button
                      size="md"
                      variant="ghost"
                      disabled={busy || (category.isActive && !category.canDeactivate)}
                      onClick={() => handleToggleActive(category)}
                    >
                      {category.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-4">
          <h3 className="font-medium text-text-primary">Add a category</h3>
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Category name" className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" />
          <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Shelving guidance (optional)" rows={2} className="rounded-md border border-border-input bg-surface px-3 py-2 text-base" />
          <Button size="md" disabled={busy || !newLabel.trim()} onClick={handleCreate} className="self-start">
            Create category
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-text-primary">Taxonomy suggestions</h2>
        {pendingSuggestions.length === 0 ? (
          <p className="text-text-secondary">No taxonomy suggestions are waiting.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pendingSuggestions.map((suggestion) => (
              <li key={suggestion.id} className="rounded-lg border border-border bg-surface p-4">
                <p className="font-medium text-text-primary">{suggestion.suggestedName}</p>
                <p className="text-sm text-text-secondary">{suggestion.reason}</p>
                {suggestion.supportingBooks.length > 0 && (
                  <p className="mt-1 text-sm text-text-muted">Supporting books: {suggestion.supportingBooks.map((b) => b.title).join(", ")}</p>
                )}

                {approvingSuggestionId === suggestion.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <input value={approveLabel} onChange={(e) => setApproveLabel(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base" placeholder="Confirm category name" />
                    <div className="flex gap-2">
                      <Button size="md" disabled={busy || !approveLabel.trim()} onClick={() => handleApprove(suggestion.id)}>
                        Confirm &amp; create category
                      </Button>
                      <Button size="md" variant="ghost" disabled={busy} onClick={() => setApprovingSuggestionId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : mergingSuggestionId === suggestion.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <select value={mergeTargetSlug} onChange={(e) => setMergeTargetSlug(e.target.value)} className="h-11 rounded-md border border-border-input bg-surface px-3 text-base">
                      <option value="">Choose an existing category</option>
                      {categories.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Button size="md" disabled={busy || !mergeTargetSlug} onClick={() => handleMerge(suggestion.id)}>
                        Merge
                      </Button>
                      <Button size="md" variant="ghost" disabled={busy} onClick={() => setMergingSuggestionId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="md"
                      disabled={busy}
                      onClick={() => {
                        setApprovingSuggestionId(suggestion.id);
                        setApproveLabel(suggestion.suggestedName);
                      }}
                    >
                      Approve as new category
                    </Button>
                    <Button size="md" variant="secondary" disabled={busy} onClick={() => setMergingSuggestionId(suggestion.id)}>
                      Merge with existing
                    </Button>
                    <Button size="md" variant="ghost" disabled={busy} onClick={() => handlePostpone(suggestion.id)}>
                      Postpone
                    </Button>
                    <Button size="md" variant="ghost" disabled={busy} onClick={() => handleReject(suggestion.id)}>
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {decidedSuggestions.length > 0 && (
          <details className="rounded-lg border border-border bg-surface-subtle p-4">
            <summary className="cursor-pointer text-sm font-medium text-text-secondary">Past decisions ({decidedSuggestions.length})</summary>
            <ul className="mt-3 flex flex-col gap-2">
              {decidedSuggestions.map((s) => (
                <li key={s.id} className="text-sm text-text-secondary">
                  {s.suggestedName} — {s.status}
                  {s.resolvedCategoryLabel ? ` (${s.resolvedCategoryLabel})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
