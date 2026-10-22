"use client";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-6">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-zinc-500">Fleet VMMS</p>
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-600">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required
            className="h-10 w-full rounded-md border border-zinc-300 px-3" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            className="h-10 w-full rounded-md border border-zinc-300 px-3" />
        </div>
        {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
        <button type="submit" disabled={pending}
          className="h-10 w-full rounded-md bg-sky-800 font-medium text-white disabled:opacity-60">
          {pending ? "Signing in" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
