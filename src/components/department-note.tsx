/** Shown on an empty list to a department login (ADR-048): it sees only its own department's vehicles, so "nothing here" may mean "nothing assigned to the department yet". */
export function DepartmentNote({ department, what }: { department: string | null; what: "vehicles" | "job cards" | "choices" }) {
  if (!department) return null;
  const tail = what === "vehicles" ? "None are in that department yet." : what === "job cards" ? "There are none for those vehicles yet." : "None are in that department yet, so there is nothing to choose.";
  return (
    <p role="note" className="mt-2 text-sm text-zinc-700">
      Your role sees only vehicles in the <span className="font-medium">{department}</span> department. {tail} An administrator or fleet manager sets a vehicle&apos;s department on the vehicle&apos;s page.
    </p>
  );
}
