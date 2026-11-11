import type { PolicyLine } from "@/lib/master/policy-rules";

/** The company policy as it applies to one job card, read-only (ADR-095). */
export function PolicyLines({ lines, money }: { lines: PolicyLine[]; money: (n: number) => string }) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-2 text-sm">
      {lines.map((l) => (
        <li key={l.rule} className={l.applies ? "" : "text-zinc-500"}>
          <span className="font-medium">{l.rule}.</span> {l.text}
          {l.amount !== null && <> Amount for the driver: <span className="font-mono font-medium">{money(l.amount)}</span>.</>}
        </li>
      ))}
    </ul>
  );
}
