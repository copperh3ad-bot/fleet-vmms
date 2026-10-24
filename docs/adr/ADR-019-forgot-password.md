# ADR-019: Forgot password

Status: accepted, 2026-10-24. Owner request: people who lose their password had no way back in.

## Decision
1. **`/forgot-password` (public).** Takes an email address and asks Supabase to send a reset email. It answers the same way whether or not the address has an account, so it cannot be used to learn who is a customer. It is limited to 8 requests per hour per IP address and 3 per hour per email address, counted before the attempt and shared across servers (`allowShared`), like sign-up.
2. **The link.** The email link returns through the existing `/auth/callback` with `?next=reset`. The callback turns the one-time code into a session and then goes to `/reset-password` when `next` is exactly `reset`, and to `/` otherwise. The destination is chosen from that one fixed word, never from an address in the request, so the callback still cannot be used as an open redirect.
3. **`/reset-password` (not public).** Only someone with a session can reach it, and the only way to get one without a password is the emailed link. The password rule is the same as sign-up (10 characters, typed twice). After the change the session on this device stays, and every other session is ended (`signOut({ scope: "others" })`).
4. **Same browser.** The code only works in the browser that asked for it (the PKCE verifier is a cookie there). Opened elsewhere, the link ends at the sign-in page. The request page says to use the same browser.
5. **Supabase settings the owner must make.** The address's redirect URLs must allow `/auth/callback` with a query string: add the wildcard `https://<domain>/**` for each address in use, and set the Site URL. Without that, Supabase sends the link to the Site URL with no code and nothing happens.
6. **Email sender.** Reset emails go through Supabase's built-in sender until the owner sets up SMTP from the company's own domain. That sender allows only a few emails per hour across the whole project, so SMTP must be in place before real customers arrive.

## Why
Supabase already issues, signs, expires and uses up the one-time code. We add only two small pages and one fixed destination, so no password handling, token store or generic redirect is added to our own code.

## Not done
- No "change password" page inside a workspace for someone who is already signed in and knows their password.
- No second factor, and no rule about reusing old passwords (leaked-password checking needs Supabase Pro).
