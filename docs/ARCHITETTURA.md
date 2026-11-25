# Architettura

PWA statica (HTML + moduli ES + CSS), nessun build step. Pubblicata su GitHub Pages dalla cartella `app/`.

```
app/
  index.html, manifest.webmanifest, sw.js, config.js, config.example.js, .nojekyll
  README.md                  aiuto per l'allenatore (mostrato nell'app in #/info, anche offline)
  css/app.css
  icons/                     icone PWA (SVG + PNG)
  vendor/docx.mjs            libreria "docx" 9.x (MIT) vendorizzata, nessun CDN (npm run vendor)
  js/
    main.js                  avvio, router (#/...), barra in alto/in basso, invito "salva su Drive", service worker
    model.js                 modello dati, testi fissi, campi calcolati, migrazioni, backup, merge raccolte
    seed.js                  dati di esempio con id stabili (piano I° trimestre + 16 giochi)
    db.js, repo.js           IndexedDB, CRUD, tombstone di libreria/rosa
    docx-build.js            documenti Word fedeli agli originali (+ libreria esercizi)
    artifacts.js             file per Drive / condivisione (.docx + .json)
    share.js                 Condividi: Web Share API con file, altrimenti download
    drive.js                 Drive REST v3 via fetch (iniettabile), cartella app trovata/creata
    sync.js                  coda persistente verso Drive, ricerca file esistenti, regole esempi
    google.js                Google Identity Services (token) + Picker (solo avanzato)
    app-sync.js              collega coda, Drive, login e UI; collegamento in un tocco; ripristino
    ui.js, markdown.js       componenti UI; rendering sicuro del markdown
    board/                   Tactic Board: model.js (sanificazione), render.js (SVG), editor.js
    views/                   home, session, match, plan, library, roster, settings (+ prima schermata), docs
```

## Dati

- Tutto in IndexedDB sul dispositivo; `navigator.storage.persist()` richiesto all'avvio.
- Un record per seduta, partita, piano, esercizio, giocatore; `schemaVersion` (ora 3) con migrazioni.
- **Seduta modulare** (schema 3): `session.modules` è l'elenco ordinato delle sezioni presenti tra
  `program, attendance, observation, review, errors, selfeval, trainer` (`SESSION_MODULES` in `model.js`).
  Una seduta nuova ha `['program']` (o le sezioni ricordate in `prefs.defaultModules`). La migrazione 2 → 3 imposta
  Programma + le sezioni che contengono dati e toglie le righe completamente vuote dei vecchi numeri fissi.
  Il `.docx` è uno solo per seduta e contiene solo le sezioni presenti, nell'ordine scelto (chiave Drive
  `docx-plan`, così si aggiorna lo stesso file; il vecchio `.docx` dell'osservazione viene messo nel cestino).
- Liste dinamiche che partono vuote (esercizi, righe di osservazione, righe libere del bilancio, attività del piano;
  la partita parte con una riga) e si allungano con "+".

## Google Drive (monodirezionale app → Drive)

- Scope solo `drive.file`. Token GIS in `localStorage` (~1 ora). Senza token valido le schede restano "Da salvare
  su Drive" e un unico invito non bloccante chiede un tocco (`requestAccessToken` con `prompt: ''`).
- **Collegamento in un tocco** (`connectDrive`): accesso → `findOrCreateAppFolder` cerca una cartella con
  `appProperties rcApp=rugby-coach, rcKind=folder` (con `drive.file` l'app vede le cartelle che ha creato) e,
  se non c'è, crea "Rugby Coach" nella radice. Se la cartella esisteva, le schede vengono recuperate subito.
- **Nessun duplicato**: ogni file ha `appProperties { rcApp, rcKind, rcId, rcVariant }`; il `.json` elenca gli id dei
  suoi `.docx`. Prima di creare un file la coda fa `files.list` nella cartella e aggiorna (PATCH) quelli esistenti.
- **Esempi** con id stabili: creati su Drive solo se mancano, mai sovrascritti finché non modificati.
- **Libreria e rosa**: un `.json` (e un `.docx` per la libreria) per raccolta. Prima di ogni invio si scarica il
  remoto e si unisce per elemento (vince `updatedAt` più recente, cancellazioni come tombstone), controllando la
  `version` del file per ridurre le corse (Drive non offre upload condizionati).
- **Eliminazioni**: eliminare una seduta/partita/piano mette una voce `deleted` nella coda persistente (anche
  offline): al prossimo giro tutti i suoi file (ritrovati da id noti o `appProperties`) vanno nel **cestino** di Drive
  (`files.update {trashed:true}`; 404 = già fatto). Una tombstone `{id: deletedAt}` finisce in
  "Rugby Coach - Eliminati.json" (raccolta `deleted`, unita come libreria/rosa): il recupero su altri telefoni non
  reimporta le schede eliminate e le toglie anche lì (se non modificate dopo l'eliminazione). Regola unica: vince
  l'evento più recente (`resolveDeletions` in model.js). Se una scheda è modificata DOPO l'eliminazione, la modifica
  vince: la tombstone è superata da una voce `alive {id: updatedAt}` nello stesso indice (così non torna dai telefoni
  che la scheda non l'hanno) e il PATCH dei file manda `trashed:false` (tutti i file escono dal cestino). Se
  l'eliminazione è più recente, la scheda si toglie in locale e non viene rimandata: l'indice è letto prima di ogni
  giro con schede da inviare. Dopo un aggiornamento dello schema le schede migrate tornano in coda una volta. Esercizi e giocatori
  eliminati: tombstone nella raccolta e libreria/rosa rigenerate senza l'elemento. Documenti non più prodotti
  (es. il `.docx` della libreria vuota) vanno nel cestino.
- `supportsAllDrives=true` su tutte le chiamate.

## Sicurezza

- Valori della Tactic Board sanificati (colori `#hex`, numeri, testi con escape) in render ed editor; miniature solo
  `data:image/png`. Markdown con escape completo. Nessun dato a server di terzi.

## Test

```bash
npm test        # node --test: modello, migrazioni, merge, Tactic Board, XSS, .docx (+ LibreOffice), Drive/coda con fetch finto, condivisione, PWA
npm run e2e     # Playwright + Chrome: pagine, persistenza, Tactic Board, offline, Drive finto (collegamento in un tocco,
                # cartella ritrovata, invito al rinnovo), Condividi con canShare finto, assenza di gergo; più dispositivi
```
