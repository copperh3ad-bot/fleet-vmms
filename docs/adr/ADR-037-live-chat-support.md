# ADR-037: Live chat for customer support

Status: accepted, 2026-10-28.

## Decision
1. **Zoho SalesIQ**, because the owner already uses Zoho for mail and wants one account and one set of apps. The chat is answered from SalesIQ's console or phone app. Building our own chat was
   considered and not chosen: real-time delivery, an agent inbox and abuse control are a large build for something a service provides.
2. **Where it shows (owner's decision): the public pages and inside the workspace.** Never the operator's area (`/admin`), the one-time workshop and driver link pages, the
   confirmation, set-up and password pages, or any page not in the list in `src/lib/chat.ts` (`chatAllowedOn`, tested).
3. **Nothing about the owner's account is in the repository.** The owner pastes the SalesIQ widget code into Admin, Settings (`chat_widget_code`, and `chat_widget_host` for the Zoho data
   centre). Only the checked code and one of Zoho's own addresses (an allowlist in `src/lib/chat.ts`) are used; the script address is built from them, never taken from a setting, so a
   mistyped or malicious setting cannot load code from anywhere else. Empty means no chat and nothing is loaded.
4. **The public pages stay built ahead of time.** The root layout mounts a small client component that asks `GET /api/chat-config` for the code after the page has loaded. That address
   is public by nature (any site using a chat widget shows its code in the page source), returns only the checked code and host or nothing, is rate-limited, and is cached for five
   minutes. It is the one new unauthenticated address (CLAUDE.md rule 5).
5. **What the support team learns inside a workspace:** the company name, workspace, plan and status only, never a person's name, email or phone. Leaving the workspace, or signing out,
   ends the chat session and clears those details, so the next person on a shared device does not see the previous company's chat.
6. **Privacy.** SalesIQ may record the page, browser and an IP-based country or city for visitors on the pages where it loads, and it sets its own cookies. The Privacy policy now names
   it, says what it records and what it sets, and the cookies paragraph and the "no tracking" sentence were changed so they stay true. The owner can turn visitor tracking off in
   SalesIQ (docs/OPERATIONS.md); if they do, the policy should be simplified.
7. The chat is optional and cannot break a page: every call into the widget is guarded.

## Not done
- No chat history in our own database, and no hand-over from the chat to a ticket; SalesIQ keeps the conversations.
- No chat for the operator's area.
