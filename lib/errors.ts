import { ConvexError } from "convex/values";
import type { AppErrorData, ErrorCode } from "@/convex/lib/errors";

const FALLBACK: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in again.",
  FORBIDDEN: "You don't have access to that.",
  NOT_FOUND: "That doesn't exist, or it isn't yours.",
  CONFLICT: "That clashes with something that already exists.",
  INVALID: "Some of that input isn't valid.",
};

export function errorCode(error: unknown): ErrorCode | null {
  return error instanceof ConvexError
    ? ((error.data as AppErrorData).code ?? null)
    : null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as AppErrorData;
    return data.message && data.message !== data.code
      ? data.message
      : FALLBACK[data.code];
  }
  return "Something went wrong. Please try again.";
}
