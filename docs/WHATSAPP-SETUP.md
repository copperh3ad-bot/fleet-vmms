# WhatsApp codes for invitations: set-up (ADR-041)

What it does: when an employee opens their invitation link, the page asks for a 6-digit code that Fleet OTG sends on WhatsApp to the phone number the administrator typed for them. Until the four settings below are in Netlify, no code is asked and invitations work as before. Nothing about this is in the repository.

## What you need (one time, about an hour plus Meta's approval wait)
1. **A WhatsApp Business Platform account (the "Cloud API"), not only the WhatsApp Business app.** The phone app and the Platform are different things. In https://business.facebook.com open **Business settings**, then **Accounts, WhatsApp accounts**; if there is none, create one at https://developers.facebook.com (create an app of type *Business*, add the **WhatsApp** product).
2. **A phone number for the business that is not already used on the WhatsApp phone app.** A number can be on the app *or* on the Platform. Use a new number or move the number off the app (in WhatsApp Manager, *Add phone number*, verify by SMS or call). A landline works.
3. **The phone number ID.** WhatsApp Manager, *API setup*, shown under the number as **Phone number ID** (a long number, not the phone number). This is `WHATSAPP_PHONE_NUMBER_ID`.
4. **A permanent access token.** Business settings, *Users, System users*, add a system user (Admin), *Add assets* (your WhatsApp account, full control), then *Generate token* for your app with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`, and choose **never expires**. Copy it once. This is `WHATSAPP_ACCESS_TOKEN`. (The 24-hour token on the API setup page is for trying only.)
5. **An approved authentication template.** WhatsApp Manager, *Message templates*, *Create template*, category **Authentication**, a name such as `fleetotg_code`, language English, *Copy code* as the button, and add the code-expiry line ("This code expires in 10 minutes"). Meta approves authentication templates in minutes to a day. The template name is `WHATSAPP_OTP_TEMPLATE`; its language code (for example `en` or `en_US`) is `WHATSAPP_TEMPLATE_LANG` (leave empty for `en`).
6. **A payment method on the WhatsApp account** (Business settings, *Payments*). Meta charges per authentication message (a few US cents in Pakistan); the first 1,000 service conversations a month are free but authentication messages are not.

## Put it in Netlify, then deploy
In Netlify, *Site configuration, Environment variables*, add: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE`, and `WHATSAPP_TEMPLATE_LANG` if it is not `en`. Mark the token as a secret. Then redeploy. Platform migration 0014 must already be run.

## Check it
1. Add an employee on the Users page with your own WhatsApp number.
2. Open the invitation link in a private window, press *Send me a code*, and the code arrives on WhatsApp.
3. A wrong code is refused; five wrong tries end it; the right code lets you create the account.

## If it does not arrive
- *"The code could not be sent"* on the page: the Netlify function log shows `invitation code message failed: whatsapp failed: <number>`. 400 usually means the template name or language is wrong, or the template is not approved yet; 401 means the token expired or lacks permission; 131030 style errors mean the number is not allowed to receive messages yet while the account is in test mode (add it under *API setup, To* as a test recipient, or finish business verification).
- No `WHATSAPP_OTP_TEMPLATE` set: the code goes as plain text and only reaches people who messaged your business number in the last 24 hours. Always set the template in production.
- To switch the code off, remove `WHATSAPP_PHONE_NUMBER_ID` or `WHATSAPP_ACCESS_TOKEN` and redeploy.

# Replies from workshops (ADR-042)

Workshops can answer a request by replying on WhatsApp with a PDF or photo, and the answer is filed on the job card. This needs three more things.

1. **The webhook.** Meta developer console, your app, *WhatsApp*, *Configuration*, *Webhooks*. Callback URL: `https://www.fleetotg.com/api/inbound/whatsapp`. Verify token: any long random string you make up (for example 40 random letters and digits); keep it, it is `WHATSAPP_VERIFY_TOKEN`. Put `WHATSAPP_VERIFY_TOKEN` in Netlify and redeploy **before** pressing *Verify and save*, because Meta checks it at that moment. Then, in the same page, subscribe to the field **messages**.
2. **The app secret.** Meta developer console, *App settings*, *Basic*, *App secret* (press Show). Put it in Netlify as `WHATSAPP_APP_SECRET`. Every call Meta makes is signed with it, and Fleet OTG refuses any call that is not.
3. **The request template.** WhatsApp Manager, *Message templates*, category **Utility**, name `fleetotg_request`, English. Body (the four numbered gaps are filled in by Fleet OTG):
   `Hello {{1}}, {{2}} asks for your {{3}} for job card {{4}}. Press the button to send it, or reply to this message with a PDF or photo.`
   Add one **Visit website** button, type *Dynamic*, URL `https://www.fleetotg.com/q/{{1}}`, button text "Send it now". Submit it and wait for the approval tick. Its name is `WHATSAPP_REQUEST_TEMPLATE`.

Then open a job card that is waiting for an estimate, press **Ask on WhatsApp** (the button appears once the template is named), and from the workshop's phone reply to the message with a PDF. The reply shows on the job card as "WhatsApp, needs entering".

If nothing arrives: the webhook must show a green tick in Meta's page; check the Netlify function log for `inbound-whatsapp`. A 401 means the app secret in Netlify is wrong. Workshops must have their mobile number on the Vendors page, in the form 0300 1234567.

## If the template is not approved yet (ADR-046)
With the WhatsApp variables set but no approved `WHATSAPP_OTP_TEMPLATE`, the invitation code cannot be sent and no invited person can finish. Set `INVITE_CODE_CHANNEL` in Netlify and redeploy: `email` sends the code to the invited email address (people invited by sign-in name still get WhatsApp), `off` asks for no code. Unset it again once Meta approves the template.

Or send the code by text message instead (ADR-047): set `SMS_PROVIDER` (`twilio` or `plivo`), `SMS_ACCOUNT_ID`, `SMS_AUTH_TOKEN` and `SMS_FROM` in Netlify, and `INVITE_CODE_CHANNEL=sms`. This reaches people invited without an email, which email cannot.
