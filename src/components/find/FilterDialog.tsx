"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import type { FacetCounts } from "@/db/repositories/searchRepository";
import { countActiveFilters, EMPTY_FILTERS, type Filters } from "@/lib/search/filters";
import { buildFindHref } from "@/lib/search/urlParams";
import { Button } from "@/components/ui/Button";
import { AgeFilterGroup } from "./AgeFilterGroup";
import { CheckboxGroup } from "./CheckboxGroup";

interface FilterDialogProps {
  query: string;
  filters: Filters;
  /** Precomputed server-side (Phase 4 brief §31) — this component never imports the
   * catalog or computes facets itself. */
  facets: FacetCounts;
}

/**
 * One consistent "Filters" control, used the same way on mobile and desktop (a
 * centered dialog rather than a mobile-only sheet plus a separate desktop popover
 * system) — the brief explicitly allows "another composition that fits the existing
 * shell" over building several distinct filter surfaces. Radix Dialog supplies focus
 * trapping, Escape-to-close, and correct labelling for free.
 *
 * Changes are staged as local draft state and only applied (navigated to) on "Show
 * results" — applying every checkbox click immediately would spam browser history
 * with one entry per click.
 */
export function FilterDialog({ query, filters, facets }: FilterDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  const activeCount = countActiveFilters(filters);

  function handleOpenChange(next: boolean) {
    if (next) setDraft(filters);
    setOpen(next);
  }

  function applyAndClose() {
    setOpen(false);
    router.push(buildFindHref(query, draft));
  }

  function clearAll() {
    setDraft(EMPTY_FILTERS);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="md" className="gap-2">
          Filters
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-emphasis px-1 text-xs font-semibold text-text-primary">
              {activeCount}
            </span>
          )}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border border-border bg-surface p-5 pt-4 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[80dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6"
        >
          {/* A small grab handle communicates "this is a sheet you could swipe away,"
              purely decorative — Radix/Escape/the explicit close button remain the
              real dismiss affordances. */}
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
          <div className="flex items-center justify-between gap-4 pb-4">
            <div className="flex items-center gap-2.5">
              <Dialog.Title className="text-lg font-semibold text-text-primary">Filters</Dialog.Title>
              {activeCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-emphasis px-1.5 text-xs font-semibold text-text-primary">
                  {activeCount}
                </span>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close filters"
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-subtle"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M4 4l10 10M14 4 4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-6 overflow-y-auto pb-4">
            <AgeFilterGroup selected={draft.ageYears} onChange={(ageYears) => setDraft((d) => ({ ...d, ageYears }))} />
            <CheckboxGroup
              legend="Category"
              options={facets.categories}
              selected={draft.categories ?? []}
              onChange={(categories) => setDraft((d) => ({ ...d, categories }))}
            />
            <CheckboxGroup
              legend="Language"
              options={facets.languages}
              selected={draft.languages ?? []}
              onChange={(languages) => setDraft((d) => ({ ...d, languages }))}
            />
            <CheckboxGroup
              legend="Visual style / realism"
              options={facets.visualRealism}
              selected={draft.visualRealism ?? []}
              onChange={(visualRealism) => setDraft((d) => ({ ...d, visualRealism }))}
            />
            <CheckboxGroup
              legend="Fiction / nonfiction"
              options={facets.fictionTypes}
              selected={draft.fictionTypes ?? []}
              onChange={(fictionTypes) => setDraft((d) => ({ ...d, fictionTypes }))}
            />
            <CheckboxGroup
              legend="Read-aloud duration"
              options={facets.durations}
              selected={draft.durations ?? []}
              onChange={(durations) => setDraft((d) => ({ ...d, durations }))}
            />
            <CheckboxGroup
              legend="Illustration style"
              options={facets.illustrationStyles}
              selected={draft.illustrationStyles ?? []}
              onChange={(illustrationStyles) => setDraft((d) => ({ ...d, illustrationStyles }))}
            />
            <CheckboxGroup
              legend="Format"
              options={facets.formats}
              selected={draft.formats ?? []}
              onChange={(formats) => setDraft((d) => ({ ...d, formats }))}
            />
            <CheckboxGroup
              legend="Author"
              options={facets.authors}
              selected={draft.authors ?? []}
              onChange={(authors) => setDraft((d) => ({ ...d, authors }))}
            />
            <CheckboxGroup
              legend="Illustrator"
              options={facets.illustrators}
              selected={draft.illustrators ?? []}
              onChange={(illustrators) => setDraft((d) => ({ ...d, illustrators }))}
            />
            <CheckboxGroup
              legend="Publisher"
              options={facets.publishers}
              selected={draft.publishers ?? []}
              onChange={(publishers) => setDraft((d) => ({ ...d, publishers }))}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="ghost" size="md" onClick={clearAll}>
              Clear all
            </Button>
            <Button variant="primary" size="md" onClick={applyAndClose}>
              Show results
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
