import type { Flow } from "../types";
import { cargoFlow } from "./cargo";
import { jobCardFlow } from "./jobcard";
import { odometerFlow } from "./odometer";
import { tripFlow } from "./trip";

/** The menu, in the order people see it. A flow that is not built yet is simply not here; the menu only lists what works. */
export const FLOWS: Flow[] = [jobCardFlow, cargoFlow, tripFlow, odometerFlow];
export const flowById = (id: string) => FLOWS.find((f) => f.id === id);
