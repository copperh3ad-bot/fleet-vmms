// The same blank vehicle sheet as plain CSV, for anyone without Excel (ADR-038). Open to anyone; no customer data.
import { vehicleSheetCsv } from "@/lib/master/vehicle-sheet";

export function GET() {
  return new Response(vehicleSheetCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fleet-otg-vehicle-sheet.csv"',
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
