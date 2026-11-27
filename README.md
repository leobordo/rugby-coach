# Rugby Coach

A just-for-fun side project I built to help me coach youth and mini rugby. It turns my paper training and match sheets into an installable web app (PWA), lets me draw drills on a tactic board, and saves everything to Google Drive as Word documents.

**Try it:** <https://leobordo.github.io/rugby-coach/> (the interface is in Italian)

## Features

- **Training sessions built from modules**: every session starts with the *Programme* (the list of drills), and you add only the sections you need: attendance by age group, drill observations, session review, errors and causes, self-assessment, strength & conditioning. Sections can be removed and reordered.
- **Match sheets** with large +/− counters for tackles, passes, support and more, and **term plans** that generate pre-filled sessions.
- **Tactic board**: full pitch, half pitch or custom grid; players for two teams, ball, cones, poles, shields; run, pass and kick arrows; freehand and text; undo/redo, resize and rotate; multi-phase plays that can be watched as an animation. Works with touch, mouse and pen.
- **Drill library and squad list** by age group, reusable across sessions.
- **Offline first**: data lives on the device (IndexedDB) and a service worker keeps the app working pitch-side without a connection.
- **Google Drive in one tap**: sign in once and a *Rugby Coach* folder is created (or found again). Each sheet is saved as a `.docx` that mirrors the paper original, and app data is kept in a separate *File per l'app* subfolder. Files are updated in place and never duplicated.
- **Multi-device sync**: changes made on another phone or computer arrive automatically. Concurrent edits are merged per item, an open sheet is never overwritten, and conflicting versions are kept as copies instead of being lost. Deletions go to the Drive trash and propagate to every device.
- **Coach groups**: create a group (e.g. "U12 squad"), invite other coaches with a link, and share drills, plans, sessions, matches and the squad list. Invites can be closed, members removed, and changes from other coaches show up with their name. When a teammate adds a drill or a plan, the others get a short notice in the app.
- **Share** any sheet or the drill library as a Word document through the phone's share sheet (WhatsApp, email, Drive…), even without Drive connected.
- **Designed for phones and for non-technical coaches**: big buttons, plain language, advanced options tucked away. It also adapts to tablets and desktops, where pages sit in a single centred column aligned with the top bar.

## What's new

**1.8.0** — read mode
- Tapping a session, match, plan or library drill now opens a clean **read-only page**: no input fields, only what was written, empty sections hidden, big readable text, animated drawings. On phones the match numbers become one card per row.
- "✎ Modifica" (edit) opens the editing page; "✓ Fine" (done) and "← Indietro" (back) return to the read page. New items open directly in edit mode.
- The "⋯" menu of every card (in the lists and on the read page) always offers Edit and Delete; library drills now have it too.
- The read page refreshes by itself when the item changes on another device or in a group.

**1.7.0** — animated plays on the tactic board
- A drawing can now have up to 8 **phases**: tap "+ Fase", drag the players to where they go next, and repeat. In each phase a faded copy and a dotted trail show where the players were in the previous one.
- "▶ Guarda" (watch) animates the play inside the board editor, with smooth movement from one phase to the next.
- Arrows, freehand lines and text stay the same in every phase. Drawings without phases are unchanged, and the thumbnail and Word document show phase 1.

**1.7.1** — animated GIF of the play
- When a drawing with phases is saved, the app builds an animated GIF of the play and shows it wherever the drawing appears: in the session sheet, in the drill library and in the "from library" picker. With "reduce motion" turned on, the still image is shown instead.
- The GIF also goes into the Word document. Word on a computer plays it; print, PDF and apps without animation support show the first phase.
- "Scarica animazione" (download animation) in the board editor saves the GIF to share it on WhatsApp or by email.
- The GIF encoder is a small dependency-free module (`app/js/board/gif.js`): one shared palette and, after the first frame, only the area that changes. A typical play weighs 10–30 KB (hard limit 350 KB, retried at a smaller size).

**1.6.3** — desktop layout
- One content width for every page (up to 1360 px), with the logo and menu in the top bar aligned to the same column; no more pages stretched edge to edge on some screens and centred on others.
- Empty-state messages ("no sessions yet", "not found") centred on the page together with their button.
- Drill editor: when there is no drawing yet, the right-hand column shows a large green "Draw" area instead of a small button.
- Smaller fixes: banner buttons no longer wrap, "Search" matches the height of "+ New", the card menu stays on the same line, and the squad list uses several columns.
- The phone layout is unchanged (the new rules only apply above 700 px).

**1.6.2**
- A new training session left empty is discarded when you leave it: it no longer appears in the list or creates useless files on Drive. Sessions that were saved at least once are never discarded.
- Coach groups: in-app notice when a teammate adds a drill or a plan (not on the first sync after joining, not for your own items or for edits).

Installed apps pick up a new version the next time they are opened: a yellow bar offers **"Aggiorna"** (update), or the update applies after closing every window of the app.

## Technical notes

- No build step and no backend: static HTML, CSS and ES modules served by GitHub Pages. Runtime libraries (such as [`docx`](https://github.com/dolanmiu/docx)) are vendored, so nothing is loaded from a CDN.
- Google access uses only the `drive.file` scope, so the app can only see the files it created or the user explicitly picked, and it needs no Google security assessment.
- Sync merges data per item using timestamps and tombstones, checks Drive file versions before each upload, and treats "most recent event wins" consistently for edits versus deletions.
- Groups work within the `drive.file` limits: each group keeps a fixed set of shared data files, and joining coaches select them once with Google Picker.
- Tests: unit tests (`node --test`) plus end-to-end tests in a real browser (Playwright) against a fake Google Drive that enforces the same access rules, covering multiple devices and multiple users.

## Repository structure

```
app/                 static web app published on GitHub Pages
  js/                ES modules: data model, IndexedDB, Drive, sync, groups, tactic board, views
  vendor/            runtime libraries vendored locally
  README.md          in-app help for coaches (Italian)
  privacy.html       privacy notice
docs/
  SETUP_GOOGLE.md    one-time Google Cloud setup (Italian)
  ARCHITETTURA.md    architecture, data model, Drive integration, tests (Italian)
tests/               unit and end-to-end tests
scripts/vendor.mjs   refreshes the libraries in app/vendor/
.github/workflows/   tests and automatic deployment to GitHub Pages
```

## Development

Requires Node.js 20+ and Python 3 (for the local static server).

```bash
npm install
npm run serve      # http://localhost:8080
npm test           # unit tests
npm run e2e        # end-to-end tests, needs Chrome/Chromium (set CHROME=... for a custom path)
```

On Windows, run the tests from Git Bash (the `.docx` tests need `unzip`); `tests/e2e-datafolder.mjs` also needs a GNU `tar` that accepts Windows paths.

To update a runtime library, bump the dependency and run `npm run vendor`.

## Deployment

Every push to `main` runs the tests and, if they pass, publishes the `app/` folder to GitHub Pages through [GitHub Actions](.github/workflows/pages.yml). Bump `VERSION` in `app/sw.js` before a release so installed apps offer the update.

## Google Drive configuration

Already set up: the OAuth Client ID and the Picker API key are in `app/config.js` (both are meant to be public in a web app; the key is restricted to this site and to the Picker API). To run your own copy, follow [`docs/SETUP_GOOGLE.md`](docs/SETUP_GOOGLE.md). Coaches never see any configuration.

## Privacy

Privacy notice: <https://leobordo.github.io/rugby-coach/privacy.html>

All data, including players' names, stays on the user's device and, when connected, in their own Google Drive (and in the shared folder of any group they join). There are no servers of my own, no third parties and no analytics; the only external scripts are Google's, loaded only when Drive is used.

## License

[MIT](LICENSE) © 2026 Leonardo Bordoni
