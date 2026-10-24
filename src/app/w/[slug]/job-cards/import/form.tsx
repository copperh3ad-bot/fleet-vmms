"use client";
import { useActionState } from "react";
import { importFormsAction, type ImportState } from "./actions";

export function ImportForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importFormsAction.bind(null, slug), {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="files" className="mb-1 block text-xs font-medium text-zinc-600">Filled forms (.xlsx, up to 10)</label>
        <input id="files" name="files" type="file" multiple required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full max-w-md text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-4 file:text-sm file:font-medium" />
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-10 rounded-md bg-brand px-5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Reading forms" : "Upload and create drafts"}</button>
      {state.results && (
        <ul className="space-y-3" aria-label="Results">
          {state.results.map((r, i) => (
            <li key={`${r.file}-${i}`} className={`rounded-md border p-3 text-sm ${r.ok ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-900"}`}>
              <p className="font-medium">{r.file}</p>
              {r.ok
                ? <p>Draft created: <a className="font-medium underline" href={`/w/${slug}/job-cards/${r.jobId}`}>{r.jobNo}</a>. Open it to add photos and send it for approval.</p>
                : <><p>Not created. Fix these in the file and upload it again:</p><ul className="mt-1 list-disc pl-5">{r.problems.map((p, j) => <li key={j}>{p.field === "file" ? p.message : <><span className="font-medium">{p.field}:</span> {p.message}</>}</li>)}</ul></>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
