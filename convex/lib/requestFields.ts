import { v } from "convex/values";

export const REQUEST_STATUSES = [
  "pending",
  "approved",
  "declined",
  "cancelled",
  "returned",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const REQUEST_ACTIONS = [
  "approve",
  "decline",
  "markReturned",
  "cancel",
] as const;

export type RequestAction = (typeof REQUEST_ACTIONS)[number];

export const MAX_REQUEST_DAYS = 30;

export const vRequestStatus = v.union(
  ...REQUEST_STATUSES.map((s) => v.literal(s)),
);
