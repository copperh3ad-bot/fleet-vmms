import { ldString } from "@/lib/seo";

/** One block of structured data for search and answer engines. Server-rendered, so it is in the page's first HTML. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldString(data) }} />;
}
