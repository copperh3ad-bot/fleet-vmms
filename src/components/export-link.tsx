/** A plain link to the CSV route. The browser downloads it; the route checks the permission again. */
export function ExportLink({ slug, kind, query = {}, label = "Export CSV" }: { slug: string; kind: string; query?: Record<string, string | undefined>; label?: string }) {
  const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <a href={`/w/${slug}/export/${kind}${qs ? `?${qs}` : ""}`} download className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900">{label}</a>
  );
}
