import { redirect } from "next/navigation";

// Recording an accident is now the panel on the "Accidents and challans" screen. Links that pre-fill a vehicle or job card still work.
export default async function NewAccidentPage({ params, searchParams }: PageProps<"/w/[slug]/accidents/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ["vehicle", "job_card"]) if (typeof sp[k] === "string") q.set(k, sp[k] as string);
  redirect(`/w/${slug}/accidents${q.size ? `?${q}` : ""}`);
}
