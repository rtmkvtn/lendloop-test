export function PagePlaceholder({
  title,
  empty,
}: {
  title: string;
  empty: string;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    </section>
  );
}
