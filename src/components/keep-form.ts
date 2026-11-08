import { startTransition, type FormEvent } from "react";

/**
 * Sends a form to a server action by hand, so React does not clear it afterwards.
 *
 * React resets a form after every `<form action={fn}>` finishes. That puts a drop-down that React controls back on its first option while React still holds the
 * pick, so the screen and the form disagree (the add-vehicle form lost its make, model and year after a message). Sent this way nothing is reset: what the person
 * chose stays chosen, files stay attached, and the message simply appears. A form that should be blank after success redirects or remounts itself (key={state.ok}).
 * Use it as `<form onSubmit={keepForm(action)}>` with the dispatch function from useActionState; the button that was pressed is sent too, as it would be.
 */
export function keepForm(dispatch: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null);
    startTransition(() => dispatch(data));
  };
}
