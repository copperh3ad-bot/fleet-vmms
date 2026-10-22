"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptPendingAction, type AcceptState } from "./accept-action";

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-10 rounded-md bg-sky-800 px-4 text-sm font-medium text-white disabled:opacity-60">{pending ? "Joining" : "Accept"}</button>;
}

export function AcceptButton({ invitationId }: { invitationId: string }) {
  const [state, action] = useActionState<AcceptState, FormData>(acceptPendingAction.bind(null, invitationId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Go />
      {state.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
