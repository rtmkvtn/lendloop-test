"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/toolFields";

export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic, {});

  return (
    <section aria-labelledby="available-now" className="space-y-3">
      <h2 id="available-now" className="text-sm font-medium">
        Available now
      </h2>
      {tools === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is up for lending yet. Sign in and be the first to list a
          tool.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tools.map((tool, i) => (
            <li
              key={`${tool.name}-${i}`}
              className="flex items-center justify-between gap-4 px-4 py-2 text-sm"
            >
              <span className="font-medium">{tool.name}</span>
              <span className="text-muted-foreground">
                {CATEGORY_LABELS[tool.category]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
