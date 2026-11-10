import { Badge } from "@/components/ui/badge";
import type { Availability } from "@/convex/lib/availability";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function availabilityLabel(availability: Availability | null) {
  if (!availability) return "Removed";
  switch (availability.kind) {
    case "available":
      return availability.bookedFrom
        ? `Available · booked from ${formatDay(availability.bookedFrom)}`
        : "Available";
    case "on_loan":
      return `On loan until ${formatDay(availability.until)}`;
    case "overdue":
      return `Overdue since ${formatDay(availability.since)}`;
  }
}

export function AvailabilityText({
  availability,
}: {
  availability: Availability | null;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        availability?.kind === "overdue" && "font-medium text-destructive",
      )}
    >
      {availabilityLabel(availability)}
    </span>
  );
}

export function TrustedBadge() {
  return (
    <Badge variant="secondary" title="An Admin has vouched for this Lender">
      Trusted
    </Badge>
  );
}
