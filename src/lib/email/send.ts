// Sends one email through whatever mail service the owner has set up (ADR-024). Any service that speaks SMTP works (Resend,
// Amazon SES, Brevo, Postmark, a hosting mailbox), so changing service is changing two settings, not code:
//   SMTP_URL    smtps://user:password@smtp.example.com:465   (a secret: set it in Netlify, never in the repository)
//   EMAIL_FROM  Fleet OTG <noreply@fleetotg.com>             (an address the service has verified)
// Nothing here logs an address, a link or a password.
import nodemailer from "nodemailer";
import { appendFileSync } from "node:fs";
import type { Mail } from "./templates";

export class EmailNotConfigured extends Error {
  constructor() { super("email is not configured"); this.name = "EmailNotConfigured"; }
}

export const emailConfigured = () => !!process.env.SMTP_URL && !!process.env.EMAIL_FROM;

export async function sendMail(m: Mail): Promise<void> {
  const url = process.env.SMTP_URL, from = process.env.EMAIL_FROM;
  if (!url || !from) throw new EmailNotConfigured();
  // For the browser test only: write the email to a file instead of sending it. Refused unless that is switched on explicitly.
  if (url.startsWith("file:") && process.env.ALLOW_FILE_MAILER === "1") { appendFileSync(url.slice(5), JSON.stringify({ from, ...m }) + "\n"); return; }
  const transport = nodemailer.createTransport({ url, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 });
  try { await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html }); } finally { transport.close(); }
}
