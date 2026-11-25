# Rugby Coach — schede per allenatori di minirugby

Web app installabile (PWA) che riproduce le 4 schede cartacee:

- **Foglio allenamento**: programma della seduta (esercizio e durata, materiale e spazio, obiettivi, parole chiave, cosa osservo, durata totale) + bilancio (complessivamente / individualmente), **errori e cause** (Sì/No + nota), autovalutazione dell'osservazione, preparatore atletico;
- **Scheda di allenamento** (osservazione): presenti per categoria U6…U16 con totale, esercizio / obiettivo / positivo / negativo / miglioramenti;
- **Scheda della partita**: contatori +/− a tap grandi per 7 indicatori + 1 colonna con intestazione libera, righe con etichetta libera, totali, note, n. giocatori;
- **Obiettivi / piano trimestrale**: obiettivi educativi e didattici, allenamenti composti da blocchi; da ogni allenamento si crea un foglio precompilato.

In più: **Libreria esercizi** con **Tactic Board** (campo intero / metà campo / griglia, pedine di due squadre, palla, coni, paletti, scudi, frecce di corsa, passaggio e calcio, mano libera, testo, annulla/ripeti), **Rosa** per categoria, **Impostazioni** con Google Drive, export/import.

Funziona **offline** a bordo campo. I dati restano sul dispositivo (IndexedDB) e, se lo colleghi, vengono salvati sul **tuo Google Drive** come documenti **Word (.docx)** fedeli agli originali + un **.json** di backup per scheda (sincronizzazione monodirezionale app → Drive).

Senza configurazione Google l'app funziona in **modalità solo locale** (e lo dice). Per collegare Drive segui la [guida passo passo](GUIDA_GOOGLE_CLOUD.md) (nell'app: **Impostazioni → Guida Google Drive**, disponibile anche offline).

Su Drive vanno: un .docx + un .json per ogni seduta, partita e piano; *Rugby Coach - Libreria esercizi* (.docx con i disegni + .json) e *Rugby Coach - Rosa giocatori.json*. I file portano etichette nascoste (appProperties) con il codice della scheda: ricollegando la stessa cartella, cambiando account o ripristinando su un altro dispositivo l'app ritrova e aggiorna i suoi file invece di duplicarli.

Libreria e rosa si possono modificare da più dispositivi: prima di ogni invio l'app scarica il backup su Drive e unisce elemento per elemento (vince la modifica più recente; le cancellazioni viaggiano come "tombstone" e si propagano). Se nel frattempo un altro dispositivo aggiorna il file (controllo della `version` del file su Drive) l'unione si ripete; resta una piccola finestra tra controllo e invio, perché Drive non offre aggiornamenti condizionati: un elemento eventualmente perso torna al giro successivo del dispositivo che lo possiede.

## Avvio sul computer

Serve un server statico qualsiasi (i moduli ES non si aprono con doppio clic su `index.html`):

```bash
cd app
python3 -m http.server 8080
```

Poi apri <http://localhost:8080>. (In alternativa: `npx serve -l 8080` o qualsiasi altro server statico.)
Il service worker e Google login funzionano su `http://localhost` e su qualsiasi indirizzo `https://`.

## Pubblicazione

L'app è pubblicata su GitHub Pages: <https://leobordo.github.io/rugby-coach/>. Codice e istruzioni per sviluppatori: <https://github.com/leobordo/rugby-coach>.

Ogni modifica al branch `main` viene verificata (`npm test`) e pubblicata in automatico dalla GitHub Action `.github/workflows/pages.yml`, che pubblica il contenuto di questa cartella `app/`. Funziona allo stesso modo su qualsiasi hosting statico HTTPS (Netlify, Cloudflare Pages, Firebase Hosting…): tutti i percorsi sono relativi e il router usa `#/…`.

Dopo la pubblicazione aggiungi l'indirizzo dell'app tra le **Origini JavaScript autorizzate** del Client ID e tra i siti della API key (vedi la guida). Facoltativo: compila `config.js` (copiando `config.example.js`) così i colleghi non devono inserire i valori a mano.

**Aggiornamenti**: quando pubblichi una nuova versione, aumenta `VERSION` in `sw.js` (e aggiungi a `PRECACHE` eventuali file nuovi: `npm test` lo controlla); l'app mostrerà "È disponibile una nuova versione — Aggiorna".

## Installazione sul dispositivo

- **Android / Chrome**: pulsante "Installa app" in home, oppure menu ⋮ → *Installa app / Aggiungi a schermata Home*.
- **iPhone / iPad (Safari)**: Condividi ⬆ → *Aggiungi alla schermata Home*. Consigliato: Safari può cancellare i dati dei siti non installati e non usati per settimane.

L'app chiede al browser l'archiviazione persistente (`navigator.storage.persist()`); lo stato è visibile in Impostazioni. Fai comunque ogni tanto **Esporta tutto (JSON)** o collega Drive.

## Struttura

```
app/
  index.html, manifest.webmanifest, sw.js, config.js, config.example.js
  css/app.css
  icons/                     icone PWA (SVG + PNG generate)
  vendor/docx.mjs            libreria "docx" 9.x (MIT) vendorizzata, nessun CDN
  js/
    main.js                  avvio, router (#/...), service worker
    model.js                 modello dati, testi fissi, campi calcolati, migrazioni, backup
    seed.js                  dati di esempio (piano I° trimestre + 16 giochi)
    db.js, repo.js           IndexedDB e accesso ai dati
    docx-build.js            documenti Word fedeli agli originali
    artifacts.js             file da inviare a Drive (.docx + .json)
    drive.js                 Drive REST v3 via fetch (iniettabile, testabile)
    sync.js                  coda di sincronizzazione persistente (outbox)
    google.js                Google Identity Services (token) + Google Picker
    app-sync.js              collega coda, Drive, login e UI
    ui.js                    componenti (Sì/No, scelte, contatori, tag, liste)
    markdown.js              mostra guida e README come pagine dell'app (#/guida, #/info)
    board/                   Tactic Board: model.js, render.js (SVG), editor.js
    views/                   pagine: home, session, match, plan, library, roster, settings
```

## Test (sviluppo)

Dalla radice del repository, dopo `npm install`:

```bash
npm test          # node --test: modello, migrazioni, Tactic Board, .docx (+ conversione LibreOffice), Drive e coda con fetch finto, PWA
npm run e2e       # browser headless (Playwright + Chrome): tutte le pagine, persistenza, Tactic Board, offline, Drive simulato; più dispositivi che modificano libreria e rosa + un terzo che ripristina
```

Le dipendenze di sviluppo (playwright-core, docx) servono solo ai test e a `npm run vendor`, non a runtime.

## Privacy

Nessun dato dei bambini va a server di terzi: i dati stanno sul dispositivo e, se colleghi Drive, solo nel Drive di chi usa l'app. Gli unici script esterni sono quelli di Google (login e Picker), caricati solo quando si usa Drive.
