// Usage: npx tsx --env-file=.env.local scripts/test-sms.mts +923001234567
// Sends ONE real text through the SMS provider in your settings (SMS_PROVIDER, SMS_ACCOUNT_ID, SMS_AUTH_TOKEN, SMS_FROM) and says whether the provider accepted it.
// "Accepted" is not "delivered": look at the phone, and note which network it was on and what sender name it showed. Prints no secret and no message body.
// Put the four SMS_ settings in .env.local on your own computer first (that file is never committed). Sends to the number you give and nowhere else.
import { sendSms, smsConfigured } from "../src/lib/sms";

const to = process.argv[2] ?? "";
if (!/^\+\d{8,15}$/.test(to)) { console.error("Give the number in international form, for example: +923001234567"); process.exit(2); }
if (!smsConfigured()) { console.error("SMS is not set up: SMS_PROVIDER (twilio or plivo), SMS_ACCOUNT_ID, SMS_AUTH_TOKEN and SMS_FROM must all be set."); process.exit(2); }

try {
  await sendSms(to, `Fleet OTG test message ${new Date().toISOString().slice(11, 16)} UTC. If you can read this, texts reach you.`);
  console.log(`The provider accepted the message for ${to.slice(0, 4)}…${to.slice(-4)} (${process.env.SMS_PROVIDER}). Now check the phone.`);
} catch (e) {
  console.error(`The provider refused it: ${e instanceof Error ? e.message : "unknown error"}`);
  console.error("A 401 means the account id or token is wrong; a 400 often means the sender (SMS_FROM) or the destination country is not allowed on your account.");
  process.exit(1);
}
