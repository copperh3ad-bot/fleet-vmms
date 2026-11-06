"use client";
import { useState, useTransition } from "react";
import { poolCarAction } from "./actions";

/** One car's place in the pool: a button that flips it, with the reason shown if it is refused. */
export function PoolSwitch({ slug, id, pool }: { slug: string; id: string; pool: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      <button type="button" disabled={pending} className="h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium hover:bg-zinc-50 disabled:opacity-60"
        onClick={() => start(async () => { const r = await poolCarAction(slug, id, !pool); setError(r.error ?? ""); })}>
        {pool ? "In the pool · take out" : "Add to the pool"}
      </button>
    </span>
  );
}
