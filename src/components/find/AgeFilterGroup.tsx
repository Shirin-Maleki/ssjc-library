import { cn } from "@/lib/utils/cn";

const AGE_YEARS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

interface AgeFilterGroupProps {
  selected?: number;
  onChange: (years: number | undefined) => void;
}

/** A row of single-year buttons rather than a range slider — the brief is explicit
 * that a precision slider would imply developmental-science exactness this doesn't
 * have. Selecting a year toggles it off if already selected. */
export function AgeFilterGroup({ selected, onChange }: AgeFilterGroupProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-text-primary">Suitable for age</legend>
      <div className="flex flex-wrap gap-2">
        {AGE_YEARS.map((years) => {
          const checked = selected === years;
          return (
            <button
              key={years}
              type="button"
              aria-pressed={checked}
              onClick={() => onChange(checked ? undefined : years)}
              className={cn(
                "h-9 min-w-9 rounded-md border px-2 text-sm transition-colors",
                checked
                  ? "border-brand-primary bg-brand-primary text-text-on-brand"
                  : "border-border bg-surface text-text-secondary hover:bg-surface-subtle"
              )}
            >
              {years}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
