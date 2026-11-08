// Makes and models offered as drop-downs on the Add vehicle form (ADR-052). A convenience, not a rule: anything not listed is entered as "Other", so a
// vehicle is never refused for not being on this list. Common in Pakistan: passenger cars, pickups, vans, trucks, buses, motorcycles and yard equipment.
// Kept short on purpose; add to it as customers need.
export const OTHER = "__other";

export const CATALOG: Record<string, string[]> = {
  Toyota: ["Corolla", "Yaris", "Camry", "Hilux", "Revo", "Fortuner", "Land Cruiser", "Prado", "Hiace", "Coaster", "Vitz", "Aqua", "Passo", "Probox", "Premio", "Rush"],
  Suzuki: ["Alto", "Cultus", "Wagon R", "Swift", "Bolan", "Ravi", "Every", "Jimny", "APV", "GS 150", "GD 110"],
  Honda: ["Civic", "City", "BR-V", "HR-V", "Vezel", "Accord", "CR-V", "Fit", "N-Box", "CD 70", "CG 125", "CB 150F"],
  Isuzu: ["D-Max", "NLR", "NMR", "NPR", "NQR", "FRR", "FSR", "FTR", "FVR", "GVR"],
  Hino: ["300 Series", "500 Series", "700 Series", "Dutro", "Ranger"],
  Hyundai: ["Tucson", "Elantra", "Sonata", "Santa Fe", "Porter", "H-100", "Shehzore", "Staria"],
  Kia: ["Picanto", "Sportage", "Stonic", "Sorento", "Carnival", "Frontier"],
  Daihatsu: ["Hijet", "Mira", "Cuore", "Move", "Terios", "Charade"],
  Nissan: ["Sunny", "Dayz", "Clipper", "Navara"],
  Mitsubishi: ["Pajero", "Lancer", "L200", "Minica"],
  Fuso: ["Canter", "Fighter"],
  Mazda: ["Mazda3", "CX-5", "Bongo", "Titan"],
  Changan: ["Alsvin", "Oshan X7", "Karvaan", "Bravo"],
  Proton: ["Saga", "X50", "X70"],
  MG: ["HS", "ZS"],
  DFSK: ["Glory 500", "Glory 580", "C32", "C37", "K01", "K07"],
  FAW: ["Carrier", "X-PV", "V2"],
  JAC: ["X200", "T6", "T8"],
  Foton: ["Aumark", "Auman", "Tunland"],
  "Mercedes-Benz": ["Actros", "Atego", "Axor", "Sprinter"],
  Volvo: ["FH", "FM"],
  Scania: ["P-series", "R-series"],
  Yamaha: ["YBR 125", "YB 125Z"],
  Komatsu: [], Caterpillar: [], JCB: [], Hyster: [], Hangcha: [], Heli: [], TCM: [],
};

export const MAKES = Object.keys(CATALOG);
export const modelsOf = (make: string): string[] => CATALOG[make] ?? [];

/** The first year offered, and the latest: next year's models are on sale before the year starts. */
export const FIRST_YEAR = 1950;          // the oldest year a vehicle may be entered with (the form's own rule), so older models and rebuilt vehicles can be added
export const yearChoices = (thisYear: number): number[] => Array.from({ length: thisYear + 1 - FIRST_YEAR + 1 }, (_, i) => thisYear + 1 - i);

/** What the form sends for a make or model: a name from the list, or OTHER together with the typed name. Returns the name to save. */
export const resolveChoice = (choice: string, typed: string): string => (choice === OTHER ? typed : choice).trim();

// ---- names the built-in list does not have (ADR-071) ------------------------------------------------------------------------------------------------------------
// Pure helpers, so the browser can use them too. The database side (recording, review, approval) is in vehicle-names.ts.

/** Case, spaces and punctuation taken out: "Land Cruiser", "land-cruiser" and "LANDCRUISER" are one name. */
export const nameKey = (s: string): string => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export const builtinMake = (make: string): string | undefined => MAKES.find((m) => nameKey(m) === nameKey(make));
export const builtinModel = (make: string, model: string): string | undefined => (CATALOG[make] ?? []).find((m) => nameKey(m) === nameKey(model));

/** Extra names for a company's drop-downs, as plain data that can cross to the browser: approved names plus this company's own names awaiting review. */
export type CatalogExtras = { makes: string[]; models: Record<string, string[]> };
export type Catalog = { makes: string[]; modelsOf: (make: string) => string[] };

/** The built-in list plus the extras. A built-in spelling always wins over a typed one, and a name is never listed twice. */
export function mergeCatalog(extras: CatalogExtras = { makes: [], models: {} }): Catalog {
  const makes = [...MAKES];
  for (const m of extras.makes) if (!makes.some((x) => nameKey(x) === nameKey(m))) makes.push(m);
  const modelsOf = (make: string): string[] => {
    const out = [...(CATALOG[make] ?? [])];
    for (const [k, list] of Object.entries(extras.models)) {
      if (nameKey(k) !== nameKey(make)) continue;
      for (const m of list) if (!out.some((x) => nameKey(x) === nameKey(m))) out.push(m);
    }
    return out;
  };
  return { makes, modelsOf };
}
