import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
// The 60-day usage simulation (sim/). Not part of `npm test`: it needs a real Postgres (TEST_DATABASE_URL) and takes a long time.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["sim/**/*.sim.ts"], testTimeout: 6 * 60 * 60 * 1000, hookTimeout: 10 * 60 * 1000, fileParallelism: false },
});
