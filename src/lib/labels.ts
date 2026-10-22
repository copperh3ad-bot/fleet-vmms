// Words the screens share, in the wording the design uses.
export const REASON_CATEGORY: Record<string, string> = {
  scheduled_service: "Scheduled service", wear_and_tear: "Wear and tear", driver_misuse: "Driver misuse", accident_damage: "Accident damage",
  defect: "Defect", poor_previous_repair: "Poor earlier repair", environmental: "Weather and roads", other: "Other",
};

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthShort = (yyyyMm: string) => MONTH_SHORT[Number(yyyyMm.slice(5, 7)) - 1] ?? yyyyMm;

/** "28 Oct" */
export const dayMonth = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
