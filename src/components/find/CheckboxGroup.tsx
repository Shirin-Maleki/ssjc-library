import type { FacetOption } from "@/lib/search/facets";
import { cn } from "@/lib/utils/cn";

interface CheckboxGroupProps {
  legend: string;
  options: FacetOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}

/** One filter dimension, OR semantics within the group (docs/SEARCH.md). A
 * `<fieldset>` with real checkboxes — no ARIA needed, semantic HTML already does the
 * right thing for a multi-select group. */
export function CheckboxGroup({ legend, options, selected, onChange }: CheckboxGroupProps) {
  if (options.length === 0) return null;

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-text-primary">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3.5 text-sm font-medium transition-colors",
                "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
                checked
                  ? "border-accent bg-accent/25 text-text-primary"
                  : "border-border bg-surface font-normal text-text-secondary hover:bg-surface-subtle"
              )}
            >
              {/* The checkbox itself is visually hidden but stays keyboard/AT
                  operable; :focus-within on the label (not :focus-visible on this
                  input) is what makes the focus ring visible, since the label is the
                  input's parent, not its sibling. */}
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
