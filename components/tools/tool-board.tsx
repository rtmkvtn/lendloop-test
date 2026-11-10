"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  type Category,
} from "@/convex/lib/toolFields";
import { CategoryChips } from "./category-chips";
import { AvailabilityText, TrustedBadge } from "./tool-labels";

export function ToolBoard() {
  const [category, setCategory] = useState<Category | null>(null);
  const tools = useQuery(api.tools.listBoard, category ? { category } : {});

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">All tools</h1>
      <CategoryChips value={category} onChange={setCategory} />
      {tools === undefined ? (
        <p className="text-sm text-muted-foreground">Loading the board…</p>
      ) : tools.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {category ? (
            <>No {CATEGORY_LABELS[category]} Tools on the board yet. </>
          ) : (
            <>No Tools on the board yet. </>
          )}
          <Link href="/listings" className="underline underline-offset-3">
            List one from My listings.
          </Link>
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Lender</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool) => (
              <TableRow key={tool._id}>
                <TableCell className="max-w-md whitespace-normal">
                  <div className="font-medium">{tool.name}</div>
                  {tool.description && (
                    <div className="text-muted-foreground">
                      {tool.description}
                    </div>
                  )}
                </TableCell>
                <TableCell>{CATEGORY_LABELS[tool.category]}</TableCell>
                <TableCell>{CONDITION_LABELS[tool.condition]}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {tool.lender.name}
                    {tool.lender.trusted && <TrustedBadge />}
                  </span>
                </TableCell>
                <TableCell>
                  <AvailabilityText availability={tool.availability} />
                </TableCell>
                <TableCell className="text-right">
                  {tool.isMine && <Badge variant="outline">Yours</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
