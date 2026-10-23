"use client";
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium hover:bg-zinc-50">Print or save as PDF</button>;
}
