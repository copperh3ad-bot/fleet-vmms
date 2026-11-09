# ADR-084: WhatsApp forms (Meta Flows) instead of one question per message

Status: accepted, 2026-11-09 (owner decision: too many questions raise the WhatsApp message count, so ask with a form that has selection options).

## Why
Each question in the chat is a message from the sender (counted against the daily cap, ADR-081, and the menu's hourly limit) and one from us. A cargo request took about eleven, a job card about eight to ten.

## Decision
- Cargo requests, trips and job cards can be asked with **a WhatsApp form** (Meta's "Flows"): one screen or two with dropdowns, a date picker and text boxes, sent by us after the person picks the item on the menu. The person fills it in and sends it: **one message from them**. Hi, the menu tap and the form are three messages in all, against about thirteen.
- The forms are defined in `src/lib/wa-menu/forms.ts` and written to `docs/whatsapp-flows/{cargo,trip,jobcard}.json` by `npx tsx scripts/wa-form-json.mts`. A test keeps the files equal to what the code builds. The owner pastes each file into WhatsApp Manager (Account tools, Flows), publishes it, and sets its id in the server's environment: `WHATSAPP_FORM_CARGO`, `WHATSAPP_FORM_TRIP`, `WHATSAPP_FORM_JOBCARD`. **With no id set, nothing changes**: the questions are asked in the chat as before. `WHATSAPP_FORMS_DRAFT=1` sends the forms in draft mode, so a draft form can be tried by the business's own testers before it is published.
- **The form is only a nicer way to ask.** Its answers come back in one message and are **checked again on our side** exactly as the chat checks them (dates not in the past, a phone number in the contact box, the word limit for Others, a real vehicle the sender may use, numbers, the allowed options). A problem comes back as one message with the reason and the form again. The request is made by the same function, with the sender's own role, so permissions, approvals and every other rule are unchanged. A form's `flow_token` is the conversation's id; an answer for any other conversation is refused.
- **Fallbacks:** if the form cannot be sent, the same words go as text with "reply TEXT"; **TEXT** at any time turns to the chat questions; any other words point back to the form.
- **Job card photos** cannot go in a form without a data endpoint, so after the form the chat asks for up to three photos (DONE or SKIP); the card is sent as soon as that is answered. Nothing more is asked: the form was the confirmation, so there is no YES step after a form (the chat questionnaire still has one).
- **Not forms:** the odometer reading stays in the chat (two answers). Vehicle choice in the job card form is a typed registration number, because a form without a data endpoint cannot list a person's own vehicles. A trip's preferred vehicle is not asked on the form; the fleet office chooses.
- **Security and data:** answers are accepted only as short plain text and numbers (names up to 60 characters of letters, digits and underscore, values up to 2,000 characters, 20 KB in all); nothing else from the message is kept. No answer or phone number is logged. No data endpoint, so there is nothing to encrypt or host.

## Untested against Meta
The forms were built to Meta's published limits (screen titles 30 characters, labels 20, helper text 80, option titles 30) and checked by our tests, but have not been uploaded to Meta from here: the owner's upload will list any error Meta finds. The date picker's answer is read as `YYYY-MM-DD` or as milliseconds. The first real use should be in draft mode.
