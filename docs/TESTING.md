# Testing

Status: reflects what Phase 1 actually built and ran — every command below was executed
against the real project, not just written.

## Running the suite

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest run — unit tests
npm run test:e2e    # playwright test — E2E, against a real production build
npm run build       # next build
```

`npm run test:e2e` builds and starts the app itself (`playwright.config.ts`'s `webServer`)
against fixture credentials computed at config-load time — nothing sensitive is ever written
to disk. No real environment variables or `.env.local` are needed to run any of the above.

## Unit tests (Vitest) — `tests/unit/`

| File | Covers |
|---|---|
| `auth/session.test.ts` | Token creation/verification, admin elevation activity/expiry, sliding renewal (including the "admin elevation lapsed → downgrade to staff on renewal" path), rejection of garbage/wrong-secret/expired tokens |
| `auth/password.test.ts` | bcrypt verification: correct, incorrect, empty, and unconfigured-hash cases |
| `auth/rateLimit.test.ts` | Throttling allows attempts under the threshold, blocks at the threshold, resets on success |
| `validation/auth.test.ts` | The login form's Zod schema accepts/rejects appropriately |

Environment note: tests run with `environment: "node"`, not `jsdom` — an early attempt to use
`jsdom` caused `jose`'s WebCrypto key handling to see cross-realm `Uint8Array` instances and
fail with a cryptic key-type error. Since Phase 1's unit tests are pure logic with no DOM
dependency, `node` is both correct and faster; `jsdom` remains available per-file via a
`// @vitest-environment jsdom` pragma whenever a later phase adds component tests that
actually need a DOM.

## E2E tests (Playwright) — `tests/e2e/`

Run against **real Chromium and real WebKit** (the mobile project uses WebKit specifically,
because that's the engine behind iPhone Safari — the brief is explicit that this app will be
used heavily on phones, so testing only against Chromium would have missed a real bug, below).

| File | Covers |
|---|---|
| `auth.spec.ts` | Welcome screen rendering, Tap to Enter reveal, wrong/right password, show/hide toggle, full keyboard-only login, route protection on every protected path, logout, admin unlock (wrong/right password), admin elevation clearing on logout |
| `navigation.spec.ts` | Every Home destination reaches its placeholder (not a broken link) and can navigate back; the two primary tiles are meaningfully larger than secondary nav items (a real bounding-box comparison, not just a visual impression) |

**38 tests, run against 2 projects (mobile/WebKit, desktop/Chromium) = all passing.**

### A real bug this suite caught

The mobile/WebKit project initially failed 10 of 38 tests — every test that performed a
*second* navigation after login (clicking any Home link, or logging out) landed back on the
Welcome screen instead of its destination, while the *first* navigation (login itself) always
worked. Root-caused by adding temporary request logging to the proxy and inspecting real
server output (not guessed at): the session cookie's `Secure` flag, tied to
`NODE_ENV === "production"`, was being set even though the test server runs over plain HTTP;
Chromium tolerates `Secure` cookies on `localhost` as a developer convenience, WebKit doesn't
reliably extend that tolerance to client-side `fetch()`-driven navigations. Fixed by adding an
explicit `SESSION_COOKIE_SECURE` override (full writeup in `docs/SECURITY.md`). This is
exactly the class of bug that only shows up on a real device engine — a good justification,
in hindsight, for the extra setup cost of installing and testing against WebKit rather than
treating Chromium as sufficient.

A second, smaller bug the suite caught: "Find a Book" / "Add a Book" were built as plain
`<span>` elements rather than real headings, which an accessibility-minded E2E assertion
(`getByRole("heading", ...)`) correctly failed on — fixed by making them `<h2>` elements,
which also directly serves the brief's heading-hierarchy accessibility requirement, not just
the test.

## Manual verification performed

- Visually inspected real Playwright screenshots (not just automated assertions) of every
  major screen at both a mobile viewport (390×844, matching a contemporary iPhone) and a
  desktop viewport (1440×900) — see `docs/screenshots/phase-1/` locally (not committed to
  git; screenshots are treated as phase-report artifacts, not repository content — referenced
  by path in each phase's report).
- Caught and fixed a real layout issue this way: Home's content was top-anchored, leaving a
  large, unresolved empty void below on tall/wide viewports — fixed by vertically centering
  the content within the available space.
- Computed real WCAG contrast ratios for every text/background and border/surface token pair
  actually in use (see `docs/ACCESSIBILITY.md`) rather than relying on a visual guess — this
  caught two real failing pairs, both fixed before this phase was considered done.

## What's not tested yet (by design)

Nothing in Find, Add, Reading Lists, Library Guide, or the Admin dashboard beyond their
placeholder states — there's no real functionality there yet to test. Database, Google,
and AI integrations have no tests because nothing is connected yet (Phases 4, 6, 7, 9).
