"use client";
import { useActionState } from "react";
import { Card, Notice, Submit } from "@/components/form";
import { importVehiclesAction, type ImportState } from "../actions";

export function ImportForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<ImportState, FormData>(importVehiclesAction.bind(null, slug), {});
  const p = state.preview;
  return (
    <div className="space-y-4">
      {state.imported ? (
        <div className="space-y-3">
          <Notice state={state} />
          {state.invited && state.invited.length > 0 && (
            <Card title="Invitations">
              <ul className="space-y-2 text-sm">
                {state.invited.map((i) => (
                  <li key={i.employee_no ?? i.full_name}>
                    <span className="font-medium">{i.full_name}</span> <span className="text-zinc-500">{i.email}</span>:{" "}
                    {i.emailed ? "invitation emailed" : i.whatsapp === "sent" ? "invitation sent on WhatsApp" : "could not be sent. Send this link yourself (it is shown once):"}
                    {i.emailed && i.whatsapp === "sent" ? " and sent on WhatsApp" : ""}
                    {i.link && <code className="mt-1 block break-all rounded bg-zinc-100 p-2 text-xs">{i.link}</code>}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-zinc-500">Each person must enter a valid driving licence to join, if the sheet did not give it. Their accounts are limited to the vehicle they hold.</p>
            </Card>
          )}
          <a className="inline-block rounded-md bg-sky-800 px-4 py-2 text-white" href={`/w/${slug}/vehicles`}>See the vehicles</a>
        </div>
      ) : (
        <form action={action} className="space-y-3">
          <Notice state={state} />
          <Card title="1. Choose a file">
            <label htmlFor="vehicle-file" className="block text-sm font-medium text-zinc-800">Excel sheet (.xlsx) or CSV file</label>
            <input id="vehicle-file" type="file" name="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-2 block w-full cursor-pointer rounded-md border border-dashed border-zinc-400 bg-zinc-50 p-3 text-sm text-zinc-800 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-sky-800 file:px-4 file:py-2 file:font-medium file:text-white" />
            <details className="mt-3" open={Boolean(state.text)}>
              <summary className="cursor-pointer text-sm text-sky-800 underline">Or paste the rows instead</summary>
              <textarea name="text" rows={5} defaultValue={state.text ?? ""} className="mt-2 w-full rounded-md border border-zinc-300 bg-white p-2 font-mono text-xs text-zinc-900" aria-label="CSV text" />
            </details>
            <div className="mt-3"><Submit pendingText="Checking">Check file</Submit></div>
          </Card>
          {p && (
            <Card title={`2. Result: ${p.ok} ready, ${p.failed} with errors`}>
              {p.trial && <p role="note" className={`mb-2 rounded-md border p-2 text-sm ${p.trial.note ? "border-amber-300 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}>{p.trial.note ?? `Free trial: up to ${p.trial.cap} vehicles. You have ${p.trial.existing}, so there is room for ${p.trial.room} more.`}</p>}
              {p.unknownColumns.length > 0 && <p className="mb-2 text-xs text-amber-800">Ignored columns: {p.unknownColumns.join(", ")}</p>}
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs text-zinc-500"><tr><th className="p-2">Row</th><th className="p-2">Plate</th><th className="p-2">Result</th></tr></thead>
                  <tbody>
                    {p.rows.map((r) => (
                      <tr key={r.row} className="border-t border-zinc-100 align-top">
                        <td className="p-2 tabular-nums">{r.row}</td><td className="p-2 font-medium">{r.plate || "—"}</td>
                        <td className="p-2">{r.errors.length === 0 ? <span className="text-green-700">Ready</span> : <ul className="list-disc pl-4 text-red-800">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {p.people.list.length > 0 && (
                <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                  <p className="font-medium">{p.people.list.length} new {p.people.list.length === 1 ? "person" : "people"} will be added as employees, limited to the vehicle they hold</p>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {p.people.list.slice(0, 12).map((x) => <li key={x.employee_no}>{x.full_name} ({x.employee_no}) {x.email ? x.email : "no email, so not invited"}</li>)}
                    {p.people.list.length > 12 && <li>and {p.people.list.length - 12} more</li>}
                  </ul>
                  {p.canInvite && p.people.invitable > 0 && p.failed === 0 && (
                    <label className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" name="invite" defaultChecked /> Invite {p.people.invitable} {p.people.invitable === 1 ? "person" : "people"} by email{p.people.list.length > p.people.invitable ? ` (${p.people.list.length - p.people.invitable} with no email are added but not invited)` : ""}
                    </label>
                  )}
                  {!p.canInvite && <p className="mt-2 text-xs">Only an administrator can send the invitations. The people are added; invite them from Users afterwards.</p>}
                </div>
              )}
              {p.failed === 0 ? (
                <div className="mt-3 flex items-center gap-3">
                  <input type="hidden" name="checked_text" value={state.text ?? ""} />
                  <button name="intent" value="commit" type="submit" className="h-10 rounded-md bg-sky-800 px-5 font-medium text-white">Import {p.ok} vehicle{p.ok === 1 ? "" : "s"}</button>
                  <span className="text-xs text-zinc-500">Nothing is saved until you press this.</span>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-700">Fix the rows above and check the file again. Nothing is imported until every row is clean.</p>
              )}
            </Card>
          )}
        </form>
      )}
    </div>
  );
}
