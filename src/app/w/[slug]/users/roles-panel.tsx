"use client";
import { useActionState, useState, useTransition } from "react";
import { Input, Select } from "@/components/form";
import { btn, btnPrimary } from "@/components/ui";
import { PERMISSION_GROUPS } from "@/lib/admin/permission-catalog";
import type { EditableRole } from "@/lib/admin/roles";
import type { FormState } from "../actions-util";
import { createRoleAction, deleteRoleAction, renameRoleAction, saveRoleAction } from "./roles-actions";

function Msg({ state }: { state: FormState }) {
  return <>{state.error && <span role="alert" className="text-sm text-red-700">{state.error}</span>}{state.ok && <span role="status" className="text-sm text-green-800">{state.ok}</span>}</>;
}

function RoleEditor({ slug, role }: { slug: string; role: EditableRole }) {
  const [state, action] = useActionState<FormState, FormData>(saveRoleAction.bind(null, slug, role.key), {});
  const [renameState, rename] = useActionState<FormState, FormData>(renameRoleAction.bind(null, slug, role.key), {});
  const [pending, start] = useTransition();
  const [delState, setDel] = useState<FormState>({});
  const held = new Set(role.grants);
  const locked = role.locked;
  return (
    <details className="rounded-lg border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
        <span className="font-medium text-zinc-900">{role.name}</span>
        <span className="text-zinc-600">{role.people === 1 ? "1 person" : `${role.people} people`}</span>
        {!role.builtin && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-900">Your own role</span>}
        {locked && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">Fixed</span>}
      </summary>
      <div className="space-y-4 border-t border-zinc-100 px-4 py-4">
        {locked ? <p className="text-sm text-zinc-600">The workshop role is fixed. Workshops quote and invoice through their own portal.</p> : (
          <form action={action} className="space-y-4">
            {role.key === "tenant_admin" && <p className="text-sm text-zinc-600">Managing people and roles always stays with this role, so there is always someone who can edit them.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {PERMISSION_GROUPS.map((g) => (
                <fieldset key={g.title} className="space-y-1.5">
                  <legend className="pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{g.title}</legend>
                  {g.items.map((i) => (
                    <label key={i.key} className="flex items-start gap-2 text-sm text-zinc-800">
                      <input type="checkbox" name="perm" value={i.key} defaultChecked={held.has(i.key)} className="mt-0.5" />
                      <span>{i.label}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3"><button type="submit" className={btnPrimary}>Save {role.name}</button><Msg state={state} /></div>
          </form>
        )}
        {!role.builtin && (
          <div className="space-y-3 border-t border-zinc-100 pt-4">
            <form action={rename} className="flex flex-wrap items-end gap-2">
              <label className="text-sm text-zinc-700">Name<input name="name" defaultValue={role.name} maxLength={40} className="mt-1 block h-10 rounded-md border border-zinc-300 px-3 text-zinc-900" /></label>
              <button type="submit" className={btn}>Rename</button><Msg state={renameState} />
            </form>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={pending} className={btn} onClick={() => { if (confirm(`Delete the role ${role.name}?`)) start(async () => setDel(await deleteRoleAction(slug, role.key))); }}>Delete this role</button>
              <Msg state={delState} />
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export function RolesPanel({ slug, roles, canAdd }: { slug: string; roles: EditableRole[]; canAdd: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(createRoleAction.bind(null, slug), {});
  return (
    <div className="space-y-3">
      {roles.map((r) => <RoleEditor key={r.key} slug={slug} role={r} />)}
      {canAdd ? (
        <form action={action} className="grid gap-3 rounded-lg border border-dashed border-zinc-300 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input name="name" label="New role name" state={state} required maxLength={40} />
          <Select name="copy_from" label="Start from" state={state} blank="Nothing ticked" options={roles.filter((r) => !r.locked).map((r) => [r.key, r.name] as [string, string])} />
          <button type="submit" className={btnPrimary}>Make the role</button>
          <div className="sm:col-span-3"><Msg state={state} /></div>
        </form>
      ) : <p className="text-sm text-zinc-600">This organization has reached the limit of roles of its own.</p>}
    </div>
  );
}
