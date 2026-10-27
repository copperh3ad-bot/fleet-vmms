/** The offer on the sign-up pages (ADR-038): download the blank vehicle sheet now and fill it in while the workspace is being set up, so the trial is for trying the product. */
export function VehicleSheetCard({ trialDays, vehicleLimit }: { trialDays?: number; vehicleLimit?: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold">Get your vehicles ready first</h2>
      <p className="mt-2 text-zinc-700">{trialDays ? `Your ${trialDays}-day trial is short, so spend it trying Fleet OTG, not typing.` : "Spend your trial trying Fleet OTG, not typing."} Download the vehicle sheet, fill in your number plates (the rest is optional), and upload it in one go once your workspace is ready.{vehicleLimit ? ` A free trial includes up to ${vehicleLimit} vehicles, so start with the ones you most want to try.` : ""}</p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        <a href="/vehicle-sheet.xlsx" download className="font-medium text-brand underline">Download for Excel (.xlsx)</a>
        <a href="/vehicle-sheet.csv" download className="font-medium text-brand underline">Download as CSV</a>
      </p>
      <p className="mt-2 text-xs text-zinc-500">Nothing is sent anywhere. The sheet is blank, the same for everyone.</p>
    </div>
  );
}
