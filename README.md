# Rugby Coach

A just-for-fun side project I built to help me coach youth and mini rugby. It turns my paper training and match sheets into an installable web app (PWA), lets me draw drills on a tactic board, and saves everything to Google Drive as Word documents.

**Try it:** <https://leobordo.github.io/rugby-coach/> (the interface is in Italian)

## Features

- **Training sessions built from modules**: every session starts with the *Programme* (the list of drills), and you add only the sections you need: attendance by age group, drill observations, session review, errors and causes, self-assessment, strength & conditioning. Sections can be removed and reordered.
- **Match sheets** with large +/− counters for tackles, passes, support and more, and **term plans** that generate pre-filled sessions.
- **Tactic board**: full pitch, half pitch or custom grid; players for two teams, ball, cones, poles, shields; run, pass and kick arrows; freehand and text; undo/redo, resize and rotate. Works with touch, mouse and pen.
- **Drill library and squad list** by age group, reusable across sessions.
- **Offline first**: data lives on the device (IndexedDB) and a service worker keeps the app working pitch-side without a connection.
- **Google Drive in one tap**: sign in once and a *Rugby Coach* folder is created (or found again). Each sheet is saved as a `.docx` that mirrors the paper original, and app data is kept in a separate *File per l'app* subfolder. Files are updated in place and never duplicated.
- **Multi-device sync**: changes made on another phone or computer arrive automatically. Concurrent edits are merged per item, an open sheet is never overwritten, and conflicting versions are kept as copies instead of being lost. Deletions go to the Drive trash and propagate to every device.
- **Coach groups**: create a group (e.g. "U12 squad"), invite other coaches with a link, and share drills, plans, sessions, matches and the squad list. Invites can be closed, members removed, and changes from other coaches show up with their name.
- **Share** any sheet or the drill library as a Word document through the phone's share sheet (WhatsApp, email, Drive…), even without Drive connected.
- **Designed for phones and for non-technical coaches**: big buttons, plain language, advanced options tucked away. It also adapts to tablets and desktops.

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
