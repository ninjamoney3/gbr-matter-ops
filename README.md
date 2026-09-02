# GBR Matter Ops

A single-page app for Gaul, Baratta & Rosello, LLC: deadline engine, matter
tracker, discovery ledger, records chase, letter generator, pre-bill scrub,
and task board. No backend — it's one HTML file plus a manifest, a service
worker, and two icons, and it runs entirely in the browser.

**This is the public deploy repo — it exists only so GitHub Pages has
somewhere public to serve from.** It contains no client data and never will
(see Confidentiality below). The firm's private `legal` repo is where this
app actually gets developed, under its `matter-ops/` folder; changes land
here by copying that folder over and pushing. If you're looking to edit the
app rather than just use it, start in the private repo.

## Install it as an app

This app is installable — a real window, a taskbar/dock/home-screen icon,
and offline use of everything except AI document reading:

- **Chrome / Edge (Windows/Mac/Linux):** open the Pages link, click the
  install icon in the address bar (or ⋮ menu → "Install Matter Ops…"). It
  gets a Start Menu / Dock icon and opens in its own window, no browser
  chrome.
- **iPhone/iPad Safari:** Share → Add to Home Screen.
- **Android Chrome:** ⋮ menu → Add to Home Screen / Install app.

Find the live link under this repo's **Actions** tab (latest "Deploy to
Pages" run) or **Settings → Pages**.

**No install prompt, or want it fully offline from day one?** Just open
`index.html` directly (download this repo, or copy the files, and
double-click it). Everything works — matters, deadlines, letters, billing
scrub, handoff files — except the install prompt and service-worker
caching, which need `https://`. A browser's "Create shortcut… → Open as
window" option on the local file gets you an app-like window without
hosting it anywhere.

## Confidentiality

**This repo is public and ships with zero matters in it, on purpose.** The
app has no backend and no database — every matter you enter lives in your
own browser's local storage, never uploaded anywhere by the app itself.
Anyone who opens the public link gets a completely empty app; there's
nothing server-side for them to see, because there is no server. Verified:
the only network calls this app makes are loading two Google Fonts and,
only when you drop a document to read and only if you've entered your own
API key, a direct call to Anthropic with that document — nothing else,
checked by grepping the source for every `fetch`/`XMLHttpRequest`.

To share a matter list between people, either connect everyone to the same
**shared folder** (see below — no manual steps once it's connected) or use
**Settings → Save handoff file**, hand the resulting `.json` off some way
your firm already trusts with client data (your shared drive, OneDrive —
not this git repo), and the other person uses **Settings → Open handoff
file**. Matching docket numbers update in place instead of duplicating.
**Never save a handoff file into this repository, and never point the
shared-folder sync at a folder inside it** — that's the one way real data
could actually end up public here.

## Per-person setup

- **Settings → Timekeeper initials** — who's using this copy. Drives the
  "handling attorney" defaults and the letter-approval gate (only CJG
  approves outgoing letters).
- **Settings → Anthropic API key** — optional, only needed for the
  drag-and-drop document reader (Intake tab). Stored in that browser only,
  never included in a handoff file or synced anywhere. Everything else
  (deadlines, letters, matters, billing scrub, exports) works with no key.
  Get one at console.anthropic.com (pay-as-you-go; reading a document costs
  a small fraction of a cent to a few cents).

### What the document reader (Intake tab) understands

Drop a **PDF, PNG, or JPG** — Word/Excel files aren't readable directly; save
or print them to PDF first, and the app will tell you that plainly if you
try anyway rather than failing with a confusing error.

- **Court documents** — track assignment notices, orders extending
  discovery, arbitration/trial notices, complaints — get matched to an
  existing matter by docket number, or start a new matter with the fields
  pre-filled for you to check.
- **A medical providers chart** (the firm's own patient/provider tracking
  table) gets routed differently: it's read as a list of providers, you
  confirm which matter it belongs to (guessed for you when the patient's
  name matches a matter caption, but always yours to confirm or change),
  and confirmed rows are added straight to that matter's Records chase —
  no retyping. Rows the chart shows as not yet sent are listed but left
  unchecked by default, so nothing gets logged as "requested" before it
  actually was.

## Shared folder sync (S: drive, etc.)

**Settings → Shared folder sync** connects a folder — point it at a spot on
the firm's S: drive — and that browser keeps a shared file there up to date
automatically: on every change you make, and every couple of minutes in the
background, so you also pick up everyone else's edits without doing
anything. Everyone who wants to share data connects to the exact same
folder. Chrome or Edge only (uses the File System Access API); other
browsers fall back to the manual handoff-file workflow above.

**How it stays safe** — this is file-based sync between browsers, not a
real multi-user database, so it's built to fail safe rather than fail
silent:

- Every record carries its own timestamp. A sync only ever replaces a
  record with a **newer** one — an older or stale copy arriving late can
  never overwrite an edit that's already newer, in either direction.
- Deleting something leaves a tombstone. A sync will not resurrect a
  record someone deleted just because a machine that hadn't synced yet
  still has an old copy of it.
- Sync is always best-effort and never blocks local work — your own save
  to this browser always succeeds first; if the drive is slow, offline, or
  the connection needs re-confirming, you keep working locally and it
  catches up (or asks you to click **Resume syncing**) next time around.

**What it doesn't do**: this is not real-time — two people editing the
exact same field on the exact same record at literally the same moment
will have one edit win (whichever finishes syncing last), the same
limitation as two people editing one cell of a shared spreadsheet without
live collaboration. For how this firm actually works — different
timekeepers on different files, edits minutes or hours apart, not the same
field at the same second — that's not a real-world problem. **Erase
everything** in Settings only ever clears your own browser's view; if a
sync folder is connected, your next sync brings it right back from the
shared copy, which is the point — disconnect first if you actually want
data gone from the shared folder too.

## Rule citations — verification status

The Deadlines tab's "Rule reference" table tags every citation with how it
was checked, and the status line above the table gives current counts. As
of **9/1/2026**:

- A handful were previously hand-checked directly against the official
  Rules text (marked "checked — official text").
- The rest were freshly checked against secondary legal-research sources
  (marked "checked — secondary source") — that pass could not reach
  njcourts.gov or a citator directly from that environment, so treat that
  tier as "very likely right," not "confirmed." Have someone confirm
  against the official Rules PDF or Westlaw/Lexis before anything
  outcome-determinative rides on one of these.
- That pass found and fixed two real errors from the prior draft:
  - **Cross-motion timing (R. 1:6-3(b))** was computed on an incorrect
    independent 15-day schedule; a cross-motion is actually filed and
    served *with* the opposition papers (8 days before the return date).
  - **Subpoena duces tecum "14 days" (R. 1:9-2)** had no rule basis at all
    — R. 1:9-2 sets no fixed statewide response period; that 14 days looks
    like it was carried over from the federal rule (FRCP 45) by mistake.
    The app no longer auto-computes a due date for this item — it asks for
    the date printed on the subpoena instead.
- Statute-of-limitations dates (2-year personal injury, 6-year contract,
  6-month Tort Claims Act suit floor) now compute by calendar year/month
  instead of a fixed day count (730 / 2190 / 180 days) — the old fixed-day
  math silently landed a day early whenever a leap day fell inside the
  span. Confirmed with a live test: Jan 1, 2024 + "2 years" landed on Dec
  31, 2025 under the old math, one day short of the correct Jan 1, 2026.
- A few entries carry a `note` in the reference table flagging things worth
  a second look even where the citation itself checked out — a 2025 rule
  amendment adding grace time to the arbitration trial-de-novo deadline, a
  pending HHS rulemaking that could shorten the HIPAA 30-day access window,
  and the minor's-limitations statute not covering child sexual abuse or
  birth-injury claims (those run on separate, longer statutes).

None of this replaces a licensed attorney checking a filing deadline before
it's relied on. The app says so in the Deadlines tab; this note says so too.

## What's in this repo

```
index.html            the app
manifest.webmanifest  install metadata (name, icons, colors)
service-worker.js     offline cache for the app shell only —
                       never caches or intercepts calls to the
                       Anthropic API
icons/                app icons (192, 512, and a maskable 512)
.github/workflows/    deploy-pages.yml — publishes on every push to main
README.md             this file
```

## Updating this app

Edit the source in the private `legal` repo's `matter-ops/` folder, then
copy the changed files over here (`index.html`, `manifest.webmanifest`,
`service-worker.js`, `icons/`, `README.md` if it changed) and push to
`main` — the workflow redeploys automatically. Bump `CACHE_NAME` in
`service-worker.js` (e.g. `gbr-matter-ops-shell-v3`) on any change to
`index.html` so installed copies pick up it instead of serving a stale
cached version. Real matter data never belongs in this repo — see
Confidentiality above.
