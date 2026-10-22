"use client";
import { useActionState } from "react";
import { btn } from "@/components/ui";
import type { FormState } from "../actions-util";
import { markReadAction } from "../job-cards/actions";

export function MarkRead({ slug }: { slug: string }) {
  const [, action] = useActionState<FormState>(markReadAction.bind(null, slug), {});
  return <form action={action}><button className={btn} type="submit">Mark all read</button></form>;
}
