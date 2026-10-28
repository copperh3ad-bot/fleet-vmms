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
