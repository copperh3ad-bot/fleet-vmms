// Next.js calls onRequestError for every error the server could not handle itself (a page that crashed, a route or action that threw something unexpected).
// Known refusals (a UserError, a permission refusal, a redirect, not-found) are not errors and never reach here; actions log those themselves (ADR-070).
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logActivity, isFrameworkSignal } = await import("@/lib/activity/log");
  if (isFrameworkSignal(error)) return;
  const h = request.headers;
  const one = (k: string) => { const v = h[k]; return Array.isArray(v) ? v[0] : v ?? null; };
  await logActivity({
    kind: "error", name: `${context.routeType}: ${context.routePath}`, outcome: "error", error,
    path: request.path.split("?")[0], method: request.method,
    details: { router: context.routerKind, source: context.renderSource ?? null },
    context: {
      requestId: one("x-fleet-rid") ?? one("x-nf-request-id"), path: request.path.split("?")[0], method: request.method,
      ip: one("x-forwarded-for")?.split(",")[0]?.trim() || one("x-real-ip") || null, userAgent: one("user-agent"),
    },
  });
};
