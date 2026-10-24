# ADR-027: A shared premium surface, and a 3D wheel on the home page

Status: accepted, 2026-10-25. Owner request: "polish the web GUI to make it look modern and premium with high end 3d dynamic graphics".

## Decision
1. **Every signed-in screen gets the new look from the shared pieces, not screen by screen.** `Panel`, `Kpi`, `PageHeader`, the two button styles, the sidebar and its active link, and table rows carry the change (`src/components/ui.tsx`, `shell/nav-link.tsx`, `globals.css`): rounded corners, soft layered shadows, a faint wash behind the page, a lit sidebar with a gold marker on the current page, a teal-to-gold line on number cards, buttons that press, rows that light under the pointer. Only colour, shadow and movement change; layout, text and contrast are as before, and the browser test's phone-width and accessibility checks pass unchanged.
2. **The home page hero has a real 3D scene**: a wheel (tyre, tread, steel rim, gold hub) that turns slowly and tilts toward the pointer, inside a turning network of route points with light pulses travelling along it (`src/components/hero-3d.tsx`, three.js 0.185.1, no model files, everything is built in code). It sits behind the headline and fades out before the words.
3. **It costs nothing until wanted.** The 3D library is a separate download (about 86 KB compressed) that starts when the browser is idle after the page has appeared, and only where all of these hold: a screen at least 768 px wide, no "save data" setting, at least 2 GB device memory where the browser says so, and WebGL available. Everywhere else the page has no canvas and shows the flat illustration it always had. Drawing stops when the picture is scrolled off screen or the tab is hidden; for visitors who ask for less motion, one still frame is drawn and nothing moves.
4. **3D stays on the home page.** Working screens do not get WebGL: fleets run on modest phones and shared computers, and a data screen should never wait on a graphics card.

## Not done
- No 3D on phones. A heavier, animated scene on a low-end phone would drain battery and data for decoration.
- The wheel is built from simple shapes, so it is stylised rather than photographic. A modelled asset (a glTF file) would look richer and is a separate piece of design work.
