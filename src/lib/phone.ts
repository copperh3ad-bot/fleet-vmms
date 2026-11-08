// Phone numbers for invitations (ADR-026). An invitation link is sent to the person's phone number and nowhere else, so the number
// has to be one a message can actually reach. People type numbers the way they say them ("0300 1234567"); this turns that into the
// international form ("+923001234567") that WhatsApp and text messages need. Free of server code so the form and the server agree.

/** Pakistan is where the first customers are, so a number starting with 0 or 3 is read as Pakistani unless it says otherwise. */
export const DEFAULT_COUNTRY_CODE = "92";

export type PhoneResult = { ok: true; e164: string; digits: string; display: string } | { ok: false; message: string };

export function normalizePhone(raw: string): PhoneResult {
  const bad = (message: string): PhoneResult => ({ ok: false, message });
  const text = raw.trim();
  if (!text) return bad("Enter a phone number.");
  if (!/^[+(\d][\d\s().-]*$/.test(text)) return bad("Use digits only, for example +92 300 1234567 or +44 7700 900123.");
  let digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) { /* already international */ }
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith("3")) digits = DEFAULT_COUNTRY_CODE + digits;
  else if (!digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length < 11) return bad("Start the number with 0, or with + and the country code.");
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    // A Pakistani mobile number is the code and ten digits starting with 3: 92 3xx xxxxxxx.
    const national = digits.slice(DEFAULT_COUNTRY_CODE.length);
    if (national.length !== 10 || !national.startsWith("3")) return bad("That is not a Pakistani mobile number. It should look like +92 300 1234567.");
  }
  if (digits.length < 8 || digits.length > 15) return bad("That phone number is the wrong length.");
  if (/^(\d)\1+$/.test(digits)) return bad("That phone number does not look real.");
  const e164 = `+${digits}`;
  const display = digits.startsWith(DEFAULT_COUNTRY_CODE) ? `+${DEFAULT_COUNTRY_CODE} ${digits.slice(DEFAULT_COUNTRY_CODE.length, DEFAULT_COUNTRY_CODE.length + 3)} ${digits.slice(DEFAULT_COUNTRY_CODE.length + 3)}` : e164;
  return { ok: true, e164, digits, display };
}

/** The address that opens WhatsApp with this number and the message ready to send. */
export const whatsappLink = (digits: string, text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

/** The address that opens the phone's messages with this number and the message ready to send. `?&body=` works on both iPhone and Android. */
export const smsLink = (e164: string, text: string) => `sms:${e164}?&body=${encodeURIComponent(text)}`;
