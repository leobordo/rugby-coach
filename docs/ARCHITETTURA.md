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
    views/                   home, read (schede in sola lettura), session, match, plan, library, roster, settings (+ prima schermata), docs
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
- **Fasi della Tactic Board** (v1.7.0, `board/model.js`): un disegno può avere `phases` (al massimo 7 oltre la fase 1,
  `MAX_PHASES` = 8). La fase 1 sono le posizioni in `items`; ogni fase dopo salva solo le pedine che si spostano
  (`{ id, pos: { idElemento: [x, y] } }`) e le altre restano dove erano (`positionsAt` è cumulativo). Si spostano
  giocatori, palla, coni, paletti e scudi; frecce, tratti e testi sono uguali in tutte le fasi. `boardBetween` interpola
  (partenza/arrivo morbidi) per "▶ Guarda" nell'editor; `removePhase` passa le posizioni della fase tolta alla
  successiva, così le fasi dopo non cambiano. `normalizeBoard` sanifica le fasi (solo id di pedine esistenti, numeri
  validi) e non aggiunge la chiave ai disegni senza fasi; `prunePhases` al salvataggio. Miniatura PNG: fase 1.
- **GIF dell'azione** (v1.7.1): al "✓ Salva" di un disegno con più fasi l'editor (`boardAnimation`) disegna i
  fotogrammi di `animationFrames` (pausa sulla fase 1, 8 passi per passaggio, pausa su ogni fase) con lo stesso
  percorso SVG → canvas della miniatura e li codifica con `board/gif.js` (puro, testato con un decodificatore
  indipendente): tavolozza unica da 256 colori (i 128 più usati esatti, gli altri per taglio sulla mediana), LZW,
  dal secondo fotogramma solo il rettangolo che cambia, fotogrammi uguali uniti. 480 px, se supera 350 KB si riprova
  a 360 px, altrimenti niente animazione (avviso). Salvata nel disegno come `anim` (data URL GIF, `safeAnim`: solo
  `data:image/gif;base64`, al massimo 600 000 caratteri; tenuta da `normalizeBoard` solo con le fasi). Nell'app
  `drawingSrc` (common.js) mostra la GIF nella riga dell'esercizio, nella libreria e nella scelta dalla libreria
  (immagine ferma con `prefers-reduced-motion`). Nel Word `defaultImageFor` usa la GIF (`ImageRun` tipo `gif`)
  se c'è, altrimenti il PNG. Viaggia nei `.json` su Drive e nei file del gruppo come il resto del disegno.
- **Lettura e modifica** (v1.8.0): toccare una scheda apre la pagina di sola lettura (`views/read.js`: niente campi,
  solo i dati scritti, sezioni vuote nascoste, testi sempre via `h()`), che si ridisegna da sola su `saved`,
  `remote-update`, `remote-applied`, `removed`, `imported`. Indirizzi: lettura `#/seduta|partita|piano|esercizio/<id>`;
  modifica `#/seduta/<id>/foglio` e `#/partita|piano|esercizio/<id>/modifica` (`viewHref`/`editHref` in common.js).
  "+ Nuovo…" e "→ Crea foglio allenamento" aprono la modifica; "✓ Fine" e "← Indietro" della modifica tornano alla
  lettura (`backFromEdit`; un allenamento nuovo rimasto vuoto torna all'elenco). Menu ⋯ comune (`recordMenuItems`):
  Modifica, Duplica, Elimina. Bozza dell'allenamento nuovo: la copia in memoria resta finché `db.put` non è finito,
  così la lettura subito dopo "Fine" la trova; `setOpen(…, false)` scarta solo le bozze ancora vuote.
- **Le mie categorie** (v1.9.0): `prefs.myCategories` (solo su questo dispositivo, assente = tutte), letta in modo
  sincrono con `myCategories()` (common.js) da `peekSetting`. `visibleCategories(mine, keep)` dà le scelte da offrire
  (linguette della Rosa, filtri, Categorie di seduta ed esercizio, Under, categoria di piano e gruppo, righe delle
  Presenze) senza mai togliere un valore già usato dalla scheda; `inMyCategories(cats, mine)` nasconde dagli elenchi
  (Schede, Libreria, "Dalla libreria") solo gli elementi con categorie tutte fuori dalle mie: quelli senza categoria
  restano. Il filtro "Categoria" scelto a mano mostra comunque quella categoria. Il Word non cambia.
- **Rosa** (v1.9.0): righe con solo numero e nome; tocco sul nome o "⋯ › Modifica" apre sotto la riga nome, numero,
  categoria, "Dove si trova", Elimina e "✓ Fine".
- Liste dinamiche che partono vuote (esercizi, righe di osservazione, righe libere del bilancio, attività del piano;
  la partita parte con una riga) e si allungano con "+".

## Google Drive (monodirezionale app → Drive)

- Scope solo `drive.file`. Token GIS in `localStorage` (~1 ora). Senza token valido le schede restano "Da salvare
  su Drive" e un unico invito non bloccante chiede un tocco (`requestAccessToken` con `prompt: ''`).
- **Collegamento in un tocco** (`connectDrive`): accesso → `findOrCreateAppFolder` cerca una cartella con
  `appProperties rcApp=rugby-coach, rcKind=folder` (con `drive.file` l'app vede le cartelle che ha creato) e,
  se non c'è, crea "Rugby Coach" nella radice. Se la cartella esisteva, le schede vengono recuperate subito.
- **"File per l'app"** (v1.4.2): i `.json` personali (backup delle schede, libreria, rosa, "Rugby Coach -
  Eliminati.json") stanno nella sottocartella `Rugby Coach/File per l'app` (`appProperties rcKind=dataFolder`); nella
  cartella principale restano solo i `.docx`. `findOrCreateDataFolder` la ritrova o la crea; se due telefoni l'hanno
  creata insieme vince la più vecchia (createdTime, poi id) su tutti i telefoni, i file delle altre vengono spostati e
  le altre vanno nel cestino; a ogni giro un controllo leggero (`files.get`) verifica che esista ancora.
  Migrazione: `moveRootJson` SPOSTA i `.json` ancora nella cartella principale (`files.update addParents/removeParents`,
  stesso id), una volta per avvio finché ne trova; idempotente, ripresa al giro dopo se interrotta, non blocca la coda.
  Durante la transizione ricerca, ripristino, eliminazioni e controllo duplicati guardano entrambe le cartelle
  (`listPersonal`; a parità di scheda vale il `.json` in "File per l'app"). I `.json` nuovi nascono nella sottocartella.
- **Ricezione automatica** (v1.5.0, stesso account su più dispositivi): `pullFromDrive` fa UNA `files.list` su
  "File per l'app" (più la cartella principale finché la migrazione non è finita) e confronta la `version` Drive di
  ogni `.json` con `entry.jsonVersion` (versione comune, salvata dalla coda dopo ogni invio o ricezione): scarica solo
  i file cambiati, in ordine eliminazioni → libreria/rosa → schede. Quando: all'avvio, al ritorno in primo piano
  (visibilitychange/focus), al ritorno della rete, prima di ogni invio e ogni 2 minuti dal timer (a riposo: una sola
  `files.list`, nessun download). Mai senza accesso valido (nessuna finestra Google aperta da sola); backoff su 403/429.
  Un giro alla volta (`runNow` serializzato). Regola per scheda intera (`decideSheet`): vince la più recente; se
  modificata da entrambe le parti dopo la versione comune, la perdente resta come copia `conflictCopy`
  ("(conflitto del …)", nuovo id, nome file distinto). `beforeUpload`: prima di caricare una scheda con `.json` noto,
  `files.get(version)`; se diversa dalla comune si riceve prima. Scheda aperta (`repo.isOpen`): non si tocca; la
  pagina riceve `remote-update` e l'autosaver unisce campo per campo (`merge3`: i campi che si stanno scrivendo
  restano; stesso campo cambiato da entrambi → copia di conflitto) con l'avviso "Aggiorna". Eliminata altrove mentre è
  aperta: avviso con "Tienila" (stessi file, escono dal cestino) / "Chiudi".
- **Gruppi di allenatori** (v1.6.0, `groups.js` + `app-sync.js` + `views/groups.js`): con `drive.file` l'app vede solo
  i file creati da lei per quell'utente o scelti nel Picker, quindi ogni gruppo ha un INSIEME FISSO di file creati
  alla creazione nella cartella `Rugby Coach – <nome>` (radice del Drive di chi crea) › `File per l'app`: `gruppo.json`
  (manifest: nome, categoria, id dei file, membri, rimossi, invitati per email, inviti aperti/chiusi), `libreria.json`,
  `piani.json`, `schede.json` (sedute + partite), `rosa.json`. Ogni file porta elementi, tombstone e il registro
  "chi ha eliminato cosa". Sulla cartella: permesso `anyone/writer` (inviti aperti). Link di invito
  `#/unisciti?g=<manifest>&f=<4 file>&d=<sottocartella>&c=<cartella>&n=<nome>&a=<amministratore>`; chi entra apre
  il Picker (`DocsView.setFileIds`, multiselezione, cartelle incluse, dentro il tocco, dimensionato sullo schermo),
  seleziona i 7 elementi una volta; l'app scrive il membro nel manifest (unione per email, controllo `version`).
  Dalla v1.9.1 prima del Picker `groupMissingFiles` prova `files.get` sui 5 file dati: se si aprono tutti (stesso
  account di chi ha creato il gruppo, anche su un altro dispositivo, o file già scelti in passato) l'ingresso è
  diretto (`joinGroupDirect`), senza Picker. Altrimenti il Picker; dopo la scelta conta l'accesso reale, non gli id
  restituiti: se mancano file, "Apri i file che mancano (n)" riapre il Picker con solo quelli (sul telefono la
  multiselezione del Picker non funziona, così basta scegliere un file alla volta).
  Chiudi inviti: permessi `user/writer` per membri e invitati, poi via `anyone`; riapri: di nuovo `anyone`;
  togli membro: `removed` nel manifest + permesso tolto; esci: `removed` (left) e pulizia locale.
  Ricezione: stesso giro della v1.5 (`runOnce` → `runGroups` dopo la ricezione personale): per ogni gruppo
  `files.get(version)` del manifest e dei 4 file, download solo se cambiati, unione per elemento
  (`repo.mergeRemoteCollection` con ambito = gruppo: mai toccati elementi di altri ambiti), invio con controllo della
  versione prima del PATCH (`syncPart`), stato "da inviare" per file (`gdirty`). Conflitti sulle schede (stessa scheda
  cambiata qui e da un altro dopo l'ultima versione vista, `gbase`): vince la più recente, l'altra resta nel gruppo
  come copia "(conflitto del …)"; scheda aperta: unione campo per campo nella pagina, avviso "<nome> ha aggiornato
  questa scheda". Ambito di un elemento: `groupId` (`scopeOf`); `createdBy`/`updatedBy` {email, nome} per "di <nome>".
  Word: con drive.file solo chi ha creato un documento lo aggiorna, quindi il Word di una scheda del gruppo lo scrive
  il suo autore (lo rigenera quando riceve modifiche altrui), quello della libreria del gruppo l'amministratore;
  vanno nella cartella del gruppo (`targetFor`). Spostare tra Personale e gruppo = tombstone nel vecchio ambito +
  modifica recente nel nuovo; i file nella vecchia cartella vanno nel cestino. Eliminazioni: tutti i membri possono
  modificare ed eliminare tutto (scelta semplice); il registro mostra chi ha eliminato cosa ("Eliminati di recente").
  v1.6.1: un membro tolto (`removed`, non `left`) è rifiutato da `joinGroup` (`isBanned`) finché l'amministratore non
  lo invita di nuovo per email (`invited.at` > `removed.at`); togliere un membro con inviti aperti li chiude subito
  (permessi espliciti agli altri, via `anyone`) e toglie il suo permesso esplicito. Limite di Drive: a inviti
  riaperti chi è stato tolto potrebbe ancora aprire i file dal Picker; l'app non lo rimette tra i membri e non scrive.
  Cartella del gruppo nel cestino (manifest `trashed`) → stato `deleted`: "Il gruppo è stato eliminato da <nome>",
  con "Tieni una copia personale" (`keepGroupCopy`). Home: l'elenco non si ricarica mentre un menu ⋯ o una finestra
  è aperta (rimandato alla chiusura).
  v1.6.2: avviso ai compagni (solo dentro l'app, nessuna notifica di sistema): `groupLocal.merge` confronta gli id
  locali prima dell'unione e con `groupArrivals` sceglie esercizi e piani nuovi creati da un altro allenatore
  (`createdBy`); evento `group-news` → toast (`groupNewsText`). Alla prima ricezione di un file dopo l'ingresso
  (`syncPart` passa `first` quando `g.seen[part]` non esiste ancora) non si avvisa.
- **Allenamento nuovo vuoto** (v1.6.2): "+ Nuovo allenamento" usa `repo.startDraft` (solo in memoria); `repo.save` lo
  scrive e lo mette in coda solo quando `isEmptySession` diventa falsa; `setOpen(…, false)` alla chiusura della pagina
  lo scarta. Le schede già salvate non vengono mai scartate.
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
  e2e-groups.mjs       # gruppi: 4 utenti (crea/invita, ingresso al primo avvio e con app in uso, unione e ricezione,
                       # eliminazione, chiusura inviti, invito per email, rimozione, uscita, minori, XSS, gergo)
  groups.test.mjs      # nucleo dei gruppi con Drive finto multi-utente (drive.file + permessi: fake-drive.mjs)
  e2e-receive.mjs      # ricezione automatica su 3 dispositivi: timer, primo piano, scheda aperta, conflitto,
                       # eliminazione/Tienila, scheda nuova, libreria/rosa, carico a riposo, accesso scaduto
  e2e-datafolder.mjs   # "File per l'app": migrazione da 1.4.1 (due telefoni insieme, interrotta e ripresa,
                       # eliminazione durante lo spostamento), telefono nuovo, nessun .json nella cartella principale
```
