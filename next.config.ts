import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // A self-contained server (server.js plus only the files it needs) for the container image and beta hosting.
  // Netlify's own Next.js runtime builds the server itself and must not get this output, so it is skipped there.
  output: process.env.NETLIFY ? undefined : "standalone",
  poweredByHeader: false,
  // Reading an uploaded policy (OCR) runs on our own server. The reader starts worker threads from files on disk, so it is
  // not bundled, and the page that uses it is told to carry the reader, its model and the lstm engines (not the 44 MB of every variant).
  serverExternalPackages: ["tesseract.js"],
  outputFileTracingIncludes: {
    "/w/*/policy": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/zlibjs/**/*",
      "./node_modules/idb-keyval/**/*",
      "./node_modules/tesseract.js-core/package.json",
      "./node_modules/tesseract.js-core/index.js",
      "./node_modules/tesseract.js-core/tesseract-core{,-simd,-relaxedsimd}.*",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/*",
      "./node_modules/@tesseract.js-data/eng/package.json",
    ],
  },
  // Photo uploads go through server actions; the largest allowed file is 4 MB and the host refuses a body over about 6 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" }, authInterrupts: true },
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
