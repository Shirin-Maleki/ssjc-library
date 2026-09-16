"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Book } from "@/lib/catalog/types";
import { deriveAutocompleteOptions, getSuggestionTypeLabel } from "@/lib/search/autocomplete";
import type { Filters } from "@/lib/search/filters";
import { buildFindHref } from "@/lib/search/urlParams";
import { useVoiceSearch } from "@/lib/voice/useVoiceSearch";
import {
  getVoicePrivacyNoteText,
  getVoiceStatusMessage,
  getVoiceUnsupportedMessage,
  shouldShowVoicePrivacyNote,
} from "@/lib/voice/messages";
import { cn } from "@/lib/utils/cn";
import { VoiceSearchButton } from "./VoiceSearchButton";

interface SearchInputProps {
  initialQuery: string;
  filters: Filters;
  /** Precomputed server-side (Phase 4 brief §31) — this component never imports the
   * catalog directly. */
  books: Book[];
  categoryLabelBySlug: Record<string, string>;
}

/** How long the transcript stays visible, alone, before the search actually runs —
 * long enough to read what was heard, short enough that voice still feels instant. */
const VOICE_SEARCH_DELAY_MS = 350;

export function SearchInput({ initialQuery, filters, books, categoryLabelBySlug }: SearchInputProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const preVoiceQueryRef = useRef("");
  const categoryLabelBySlugMap = useMemo(() => new Map(Object.entries(categoryLabelBySlug)), [categoryLabelBySlug]);

  const {
    status: voiceStatus,
    interimTranscript: voiceInterimTranscript,
    finalTranscript: voiceFinalTranscript,
    start: startVoice,
    stop: stopVoice,
    cancel: cancelVoice,
    reset: resetVoice,
  } = useVoiceSearch();

  const suggestions = useMemo(
    () => (open ? deriveAutocompleteOptions(books, value, categoryLabelBySlugMap) : []),
    [open, value, books, categoryLabelBySlugMap]
  );

  const navigate = useCallback(
    (query: string) => {
      setOpen(false);
      setActiveIndex(-1);
      router.push(buildFindHref(query, filters));
    },
    [router, filters]
  );

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

  // Voice: a final transcript reuses the exact same navigation path typed search
  // uses — this effect never scores or filters books itself. The transcript is shown
  // immediately via `displayValue` below; `value` itself (the real query state) is
  // only committed once the delay elapses, inside the timeout callback rather than
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (voiceStatus === "processing" && voiceFinalTranscript !== null) {
      const transcript = voiceFinalTranscript;
      const timer = window.setTimeout(() => {
        setValue(transcript);
        navigate(transcript);
        resetVoice();
      }, VOICE_SEARCH_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
  }, [voiceStatus, voiceFinalTranscript, navigate, resetVoice]);

  // Derived, not synced via effect: while listening or processing, the field shows
  // what voice is hearing/heard; otherwise it shows the normal typed/committed value.
  const displayValue =
    voiceStatus === "listening" && voiceInterimTranscript
      ? voiceInterimTranscript
      : voiceStatus === "processing" && voiceFinalTranscript !== null
        ? voiceFinalTranscript
        : value;

  function handleStartVoice() {
    preVoiceQueryRef.current = value;
    setOpen(false);
    setActiveIndex(-1);
    startVoice();
  }

  function handleCancelVoice() {
    cancelVoice();
    setValue(preVoiceQueryRef.current);
  }

  const voiceStatusMessage = getVoiceStatusMessage(voiceStatus, voiceInterimTranscript);
  const showVoiceButton = voiceStatus !== "unsupported";

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
            value={displayValue}
            readOnly={voiceStatus === "listening" || voiceStatus === "processing"}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(event.target.value.trim().length >= 2);
              setActiveIndex(-1);
              if (voiceStatus === "no-speech" || voiceStatus === "error" || voiceStatus === "permission-denied") {
                resetVoice();
              }
            }}
            onFocus={() => setOpen(value.trim().length >= 2)}
            onBlur={() => {
              // Allow a click on a suggestion to register before the list disappears.
              window.setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              "h-14 w-full rounded-lg border border-border-input bg-surface pl-12 text-base text-text-primary placeholder:text-text-muted focus:outline-none",
              showVoiceButton ? (voiceStatus === "listening" ? "pr-24" : "pr-14") : "pr-4"
            )}
          />
          {showVoiceButton && (
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
              <VoiceSearchButton
                status={voiceStatus}
                onStart={handleStartVoice}
                onStop={stopVoice}
                onCancel={handleCancelVoice}
              />
            </div>
          )}
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

      <div aria-live="polite" role="status" className="sr-only">
        {voiceStatusMessage}
      </div>

      {voiceStatus === "unsupported" && (
        <p className="mt-2 text-xs text-text-muted">{getVoiceUnsupportedMessage()}</p>
      )}

      {voiceStatusMessage && voiceStatus !== "unsupported" && (
        <div className="mt-2 flex flex-col gap-1" aria-hidden="true">
          <p className="text-sm text-text-secondary">{voiceStatusMessage}</p>
          {shouldShowVoicePrivacyNote(voiceStatus) && (
            <p className="text-xs text-text-muted">{getVoicePrivacyNoteText()}</p>
          )}
        </div>
      )}
    </div>
  );
}
