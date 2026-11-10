import { Badge } from "@/components/ui/badge";
import type { Availability } from "@/convex/lib/availability";

export function availabilityLabel(availability: Availability | null) {
  if (!availability) return "Removed";
  switch (availability.kind) {
    case "available":
      return "Available";
  }
}

export function AvailabilityText({
  availability,
}: {
  availability: Availability | null;
}) {
  return (
    <span className="whitespace-nowrap">{availabilityLabel(availability)}</span>
  );
}

export function TrustedBadge() {
  return (
    <Badge variant="secondary" title="An Admin has vouched for this Lender">
      Trusted
    </Badge>
  );
}
