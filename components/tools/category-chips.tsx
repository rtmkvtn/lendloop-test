import { Button } from "@/components/ui/button";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
} from "@/convex/lib/toolFields";

export function CategoryChips({
  value,
  onChange,
}: {
  value: Category | null;
  onChange: (category: Category | null) => void;
}) {
  const chips: [Category | null, string][] = [
    [null, "All"],
    ...CATEGORIES.map((c): [Category, string] => [c, CATEGORY_LABELS[c]]),
  ];
  return (
    <div
      role="group"
      aria-label="Filter by Category"
      className="flex flex-wrap gap-2"
    >
      {chips.map(([category, label]) => {
        const active = value === category;
        return (
          <Button
            key={label}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            className="rounded-full"
            onClick={() => onChange(category)}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
