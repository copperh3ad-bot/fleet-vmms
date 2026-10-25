"use client";
import { useActionState, useEffect } from "react";
import { signIn, type LoginState } from "./actions";
import { Logo } from "@/components/brand";

const box = "h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900";

// The design's split screen: brand panel on the left, the form on the right. On a phone only the form shows.
export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  // A full page load, so the new session cookie is sent and "/" decides where this person belongs.
  useEffect(() => { if (state.done) window.location.assign("/"); }, [state.done]);
  return (
    <main className="grid flex-1 md:grid-cols-2">
      <section className="hidden flex-col justify-between bg-side p-16 text-white md:flex">
        <Logo height={56} />
        <div className="max-w-md">
          <h2 className="text-[34px] font-semibold leading-tight">Know what you&apos;re spending on your fleet&apos;s maintenance, and why.</h2>
          <p className="mt-4 text-[#9FB2BE]">Job cards, approvals, workshops, budgets and servicing in one place.</p>
        </div>
        <p className="text-xs text-[#7E93A1]"><a href="/pricing" className="underline">See pricing</a></p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form action={action} className="w-full max-w-[380px] space-y-4">
          <div>
            <div className="mb-6 inline-block rounded-md bg-side px-4 py-3 md:hidden"><Logo height={36} /></div>
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-zinc-500">Use the email or sign-in name your fleet office gave you.</p>
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-600">Email or sign-in name</label>
            <input id="email" name="email" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required placeholder="you@company.com" className={box} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className={box} />
            <p className="mt-1 text-right text-xs"><a href="/forgot-password" className="font-medium text-brand underline">Forgot your password?</a></p>
            <p className="mt-1 text-xs text-zinc-500">No email? Ask your administrator for a password reset link.</p>
          </div>
          {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
          <button type="submit" disabled={pending || state.done} className="h-11 w-full rounded-md bg-brand font-medium text-white disabled:opacity-60">
            {pending || state.done ? "Signing in" : "Sign in"}
          </button>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-900">
            Drivers who only send odometer readings do not need to sign in. Use the link in your message.
          </p>
          <div className="space-y-1 text-sm text-zinc-600">
            <p>New company? <a href="/signup" className="font-medium text-brand underline">Start a free trial</a>.</p>
            <p>Your company already uses Fleet OTG? Use your invitation link, or <a href="/join" className="font-medium text-brand underline">join with your company code</a>.</p>
          </div>
        </form>
      </section>
    </main>
  );
}
