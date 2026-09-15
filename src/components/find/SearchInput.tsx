"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { books } from "@/lib/catalog/fixtures";
import { deriveAutocompleteOptions, getSuggestionTypeLabel } from "@/lib/search/autocomplete";
import type { Filters } from "@/lib/search/filters";
import { buildFindHref } from "@/lib/search/urlParams";
import { cn } from "@/lib/utils/cn";

interface SearchInputProps {
  initialQuery: string;
  filters: Filters;
}

export function SearchInput({ initialQuery, filters }: SearchInputProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => (open ? deriveAutocompleteOptions(books, value) : []), [open, value]);

  function navigate(query: string) {
    setOpen(false);
    setActiveIndex(-1);
    router.push(buildFindHref(query, filters));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      const suggestion = suggestions[activeIndex];
      setValue(suggestion.value);
      navigate(suggestion.value);
      return;
    }
    navigate(value);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown" && value.trim().length >= 2) {
        setOpen(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function handleSelectSuggestion(value: string) {
    setValue(value);
    navigate(value);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <form role="search" onSubmit={handleSubmit}>
        <label htmlFor={inputId} className="sr-only">
          Search by title, author, topic, or describe what you need
        </label>
        <div className="relative">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="m17 17-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            autoComplete="off"
            placeholder="Search by title, author, topic, or describe what you need"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(event.target.value.trim().length >= 2);
              setActiveIndex(-1);
            }}
            onFocus={() => setOpen(value.trim().length >= 2)}
            onBlur={() => {
              // Allow a click on a suggestion to register before the list disappears.
              window.setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={handleKeyDown}
            className="h-14 w-full rounded-lg border border-border-input bg-surface pl-12 pr-4 text-base text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
      </form>

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute z-10 mt-2 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.type}:${suggestion.value}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                handleSelectSuggestion(suggestion.value);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm",
                index === activeIndex ? "bg-surface-subtle" : "bg-surface"
              )}
            >
              <span className="text-text-primary">{suggestion.value}</span>
              <span className="text-xs text-text-muted">{getSuggestionTypeLabel(suggestion.type)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
