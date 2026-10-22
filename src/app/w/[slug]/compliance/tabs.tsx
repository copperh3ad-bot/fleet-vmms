const TABS = [["compliance", "Documents"], ["accidents", "Accidents"], ["challans", "Challans"]] as const;

export function Tabs({ slug, active }: { slug: string; active: (typeof TABS)[number][0] }) {
  return (
    <nav className="flex gap-2 text-sm" aria-label="Compliance sections">
      {TABS.map(([k, l]) => (
        <a key={k} href={`/w/${slug}/${k}`} aria-current={k === active ? "page" : undefined}
          className={`rounded-md border px-3 py-2 ${k === active ? "border-sky-800 bg-sky-800 text-white" : "border-zinc-300 bg-white"}`}>{l}</a>
      ))}
    </nav>
  );
}

export const DOC_CHIP: Record<string, { text: string; cls: string }> = {
  expired: { text: "Expired", cls: "bg-red-100 text-red-800" },
  due_30: { text: "Due within 30 days", cls: "bg-amber-100 text-amber-800" },
  due_90: { text: "Due within 90 days", cls: "bg-sky-100 text-sky-800" },
  ok: { text: "OK", cls: "bg-green-100 text-green-800" },
};

export const SEVERITY: Record<string, string> = { minor: "Minor", moderate: "Moderate", major: "Major", total_loss: "Total loss" };
export const FAULT: Record<string, string> = { our_driver: "Our driver", third_party: "The other party", shared: "Shared", unknown: "Unknown" };
