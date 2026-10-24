import type { MetadataRoute } from "next";
import { INDEXABLE_PATHS, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXABLE_PATHS.map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}`, changeFrequency: path === "/" ? "weekly" : "monthly", priority: path === "/" ? 1 : path === "/pricing" || path === "/signup" ? 0.8 : 0.5 }));
}
