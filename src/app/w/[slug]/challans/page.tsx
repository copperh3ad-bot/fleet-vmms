import { redirect } from "next/navigation";

// Challans now live on the combined "Accidents and challans" screen.
export default async function ChallansPage({ params }: PageProps<"/w/[slug]/challans">) {
  const { slug } = await params;
  redirect(`/w/${slug}/accidents?form=challan`);
}
