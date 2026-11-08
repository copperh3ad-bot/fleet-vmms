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
  // Server function names are kept readable in the production build: the activity log names each action by it (ADR-070).
  experimental: { serverActions: { bodySizeLimit: "6mb" }, authInterrupts: true, serverMinification: false },
  partialPrefetching: true,
  // The driver odometer link carries a secret in its path: never cache it, never leak it in a Referer, keep it out of search.
  async headers() {
    return [
      // Every page: no framing (clickjacking), no content-type guessing, no unneeded browser features, https only once seen.
      // No script policy yet: the framework's own inline scripts need a per-request nonce first, and a wrong one breaks every page.
      { source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; upgrade-insecure-requests" },
      ] },
      // Signed-in screens and the operator screens hold a company's records: a browser or a shared proxy must never keep a copy.
      { source: "/w/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/q/:token", headers: [
        { key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] },
      { source: "/o/:token", headers: [
        { key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] },
    ];
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
