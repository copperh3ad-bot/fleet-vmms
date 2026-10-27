// The blank vehicle sheet, open to anyone (ADR-038): the same file for everyone, no customer data, so a company can start filling in its fleet before it has signed up.
import { buildVehicleSheet } from "@/lib/master/vehicle-sheet";
import { trialVehicleCap } from "@/lib/billing/trial";
import { getDriver } from "@/lib/db";

export async function GET() {
  const bytes = await buildVehicleSheet(await trialVehicleCap(getDriver()).catch(() => undefined));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="fleet-otg-vehicle-sheet.xlsx"',
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
