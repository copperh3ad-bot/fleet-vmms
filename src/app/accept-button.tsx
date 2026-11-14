"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptPendingAction, type AcceptState } from "./accept-action";

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-10 rounded-md bg-sky-800 px-4 text-sm font-medium text-white disabled:opacity-60">{pending ? "Joining" : "Accept"}</button>;
}

export function AcceptButton({ invitationId, needsLicence = false }: { invitationId: string; needsLicence?: boolean }) {
  const [state, action] = useActionState<AcceptState, FormData>(acceptPendingAction.bind(null, invitationId), {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {needsLicence && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Driving licence number<input name="licence_no" autoComplete="off" className="mt-1 block h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900" /></label>
          <label className="text-xs">Expiry date<input name="licence_expires_on" type="date" className="mt-1 block h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900" /></label>
          <label className="text-xs">Class (optional)<input name="licence_class" autoComplete="off" className="mt-1 block h-10 w-28 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900" /></label>
        </div>
      )}
      <Go />
      {state.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
