// Wraps a route handler so its outcome is on the activity log (ADR-070): which route, the answer's status, how long it took, and the error if it threw.
// The log records the route and the status, never the body or a header that carries a secret.
import { isFrameworkSignal, logActivity, type ActivityKind, type ActivityOutcome } from "./log";

export function outcomeOfStatus(status: number): ActivityOutcome {
  if (status >= 500) return "error";
  if (status === 401 || status === 403 || status === 429) return "denied";
  if (status >= 400) return "invalid";
  return "ok";
}

export function loggedRoute<F extends (...args: never[]) => Response | Promise<Response>>(kind: ActivityKind, name: string, handler: F): F {
  const wrapped = async (...args: unknown[]) => {
    const req = args[0] as Request;
    const t0 = Date.now();
    let path = "";
    try { path = new URL(req.url).pathname; } catch { /* not a URL */ }
    try {
      const res = await (handler as unknown as (...a: unknown[]) => Response | Promise<Response>)(...args);
      await logActivity({ kind, name, outcome: outcomeOfStatus(res.status), status: res.status, path, method: req.method, durationMs: Date.now() - t0 });
      return res;
    } catch (error) {
      if (!isFrameworkSignal(error)) await logActivity({ kind, name, outcome: "error", path, method: req.method, durationMs: Date.now() - t0, error });
      throw error;
    }
  };
  return wrapped as unknown as F;
}
