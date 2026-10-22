"use client";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const box = "h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900";

// The design's split screen: brand panel on the left, the form on the right. On a phone only the form shows.
export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <main className="grid flex-1 md:grid-cols-2">
      <section className="hidden flex-col justify-between bg-side p-16 text-white md:flex">
        <p className="text-lg font-semibold">Fleet VMMS</p>
        <div className="max-w-md">
          <h2 className="text-[34px] font-semibold leading-tight">Know what every vehicle costs, and why.</h2>
          <p className="mt-4 text-[#9FB2BE]">Job cards, approvals, workshops, budgets and servicing in one place.</p>
        </div>
        <p className="text-xs text-[#7E93A1]">Pricing and plans are not shown here.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form action={action} className="w-full max-w-[380px] space-y-4">
          <div>
            <p className="mb-6 text-lg font-semibold md:hidden">Fleet VMMS</p>
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-zinc-500">Use the email your fleet office gave you.</p>
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-600">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" className={box} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className={box} />
          </div>
          {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
          <button type="submit" disabled={pending} className="h-11 w-full rounded-md bg-brand font-medium text-white disabled:opacity-60">
            {pending ? "Signing in" : "Sign in"}
          </button>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-900">
            Drivers who only send odometer readings do not need to sign in. Use the link in your message.
          </p>
          <p className="text-xs text-zinc-500">First time here? Use the invitation link your administrator sent you.</p>
        </form>
      </section>
    </main>
  );
}
