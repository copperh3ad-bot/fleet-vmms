import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // A self-contained server (server.js plus only the files it needs) for the container image and beta hosting.
  output: "standalone",
  poweredByHeader: false,
  // Photo uploads go through server actions; the largest allowed file is 10 MB.
  experimental: { serverActions: { bodySizeLimit: "12mb" }, authInterrupts: true },
  partialPrefetching: true,
  // The driver odometer link carries a secret in its path: never cache it, never leak it in a Referer, keep it out of search.
  async headers() {
    return [{ source: "/o/:token", headers: [
      { key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
