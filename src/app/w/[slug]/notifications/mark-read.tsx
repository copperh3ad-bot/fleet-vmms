"use client";
import { useActionState } from "react";
import type { FormState } from "../actions-util";
import { markReadAction } from "../job-cards/actions";

export function MarkRead({ slug }: { slug: string }) {
  const [, action] = useActionState<FormState>(markReadAction.bind(null, slug), {});
  return <form action={action}><button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" type="submit">Mark all read</button></form>;
}
