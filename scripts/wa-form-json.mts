// Writes the WhatsApp forms' Flow JSON files (docs/whatsapp-flows/*.json) from src/lib/wa-menu/forms.ts. The owner pastes each file into WhatsApp Manager (Account tools, Flows),
// publishes it, and sets the form's id in the server's environment (ADR-084). Run: npx tsx scripts/wa-form-json.mts
import { mkdirSync, writeFileSync } from "node:fs";
import { cargoFormJson, jobCardFormJson, tripFormJson } from "../src/lib/wa-menu/forms";

mkdirSync("docs/whatsapp-flows", { recursive: true });
for (const [name, json] of [["cargo", cargoFormJson()], ["trip", tripFormJson()], ["jobcard", jobCardFormJson()]] as const) {
  writeFileSync(`docs/whatsapp-flows/${name}.json`, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`docs/whatsapp-flows/${name}.json`);
}
