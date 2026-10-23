# ADR-015: Reading uploaded files (policy first)

Status: accepted, 2026-10-24. Owner choices: no AI service, a person reviews before anything changes, policy first and the other uploads after.

## Decision
An uploaded file can be turned into text and then into suggestions, on our own server, with no outside service.

1. **Text.** A PDF that already contains text is read as is. A scanned PDF has its page pictures read with Tesseract (open source, English model, run in-process through `tesseract.js`). A JPEG or PNG is read the same way. HEIC and WebP are refused with a plain message. The file never leaves our servers, so the privacy text needs no new third party.
2. **Findings.** Plain patterns (`src/lib/docs/policy-extract.ts`) find the numbers a policy states and map each to something the system can apply: a policy setting, or a service interval. Each finding carries the sentence it came from. Wording that is not found is simply not offered; nothing is guessed.
3. **Apply.** A manager reviews the findings next to the current values and ticks what is right. The server applies its own stored findings, never numbers sent from the browser, through the same functions and permissions as changing the setting by hand. Nothing changes who pays for what until a person confirms.
4. **Steps.** Reading is one page per call (a host call is short), with progress on screen, so a long file is many short calls. A second call for the same page changes nothing.

## Engine for other uploads
`read-file.ts` (file to text) is generic. Each kind of upload brings its own extractor. Registration book, insurance policy and compliance documents are the next ones; they will pre-fill their forms for review, not save by themselves.

## Consequences
- Scans are read well when printed and straight (a real 4-page scan: 87–93% confidence, 1–2 seconds a page on a laptop). Handwriting, skewed photos and tables are weaker, which is why every number is confirmed by a person.
- Patterns need to know the wording. A company that words a rule differently gets fewer suggestions, and sets that rule by hand. Adding a pattern is a small, tested change.
- Hosting: the reader and its model are packaged with the policy page through `outputFileTracingIncludes` in `next.config.ts` (about 25 MB). The tesseract.js release in use loads its non-LSTM engine variants, so those are included, not the LSTM ones.
- The reading (`policy_readings`) keeps the text found, as a draft, in the company's own schema. It is not audited row by row; the settings and service rules a person applies from it are.
