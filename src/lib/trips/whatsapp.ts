import { whatsappConfigured } from "@/lib/whatsapp";

/** Can Fleet OTG send the trip quote request on WhatsApp itself? It needs the WhatsApp connection and an approved template (ADR-078, ADR-042). */
export const tripWhatsappFromServer = () => whatsappConfigured() && !!process.env.WHATSAPP_TRIP_QUOTE_TEMPLATE;
