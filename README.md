# Rugby Coach

Web app installabile (PWA) per allenatori di minirugby e rugby giovanile. Riproduce le schede cartacee di allenamento e partita, permette di disegnare gli esercizi su una Tactic Board e salva tutto sul proprio Google Drive come documenti Word.

**App:** <https://leobordo.github.io/rugby-coach/>

## Funzionalità

- **Schede compilabili**: foglio allenamento (programma, bilancio, errori e cause, autovalutazione, preparatore atletico), scheda di osservazione, scheda della partita con contatori +/−, piano trimestrale da cui generare le sedute.
- **Tactic Board**: campo intero, metà campo o griglia; pedine di due squadre, palla, coni, paletti, scudi, frecce di corsa, passaggio e calcio, mano libera e testo; annulla/ripeti, ridimensiona e ruota.
- **Libreria esercizi** riutilizzabile e **rosa** per categoria.
- **Offline e persistente**: dati in IndexedDB sul dispositivo, service worker per l'uso a bordo campo senza rete.
- **Google Drive** (facoltativo): all'avvio si sceglie una cartella o se ne crea una dedicata; ogni scheda diventa un `.docx` fedele all'originale più un `.json` di backup. I file vengono aggiornati, mai duplicati, anche cambiando dispositivo. Accesso limitato ai soli file creati dall'app (scope `drive.file`).

Senza configurazione Google l'app funziona in modalità solo locale.

## Struttura del repository

```
app/                 web app statica pubblicata su GitHub Pages (nessun build step)
  js/                moduli ES: modello dati, IndexedDB, Drive, sync, Tactic Board, viste
  vendor/            librerie runtime copiate localmente (nessun CDN)
  GUIDA_GOOGLE_CLOUD.md   guida per collegare Drive (visibile anche nell'app)
  README.md          documentazione d'uso (visibile nell'app) e architettura dei moduli
tests/               test unitari (node --test) ed end-to-end (Playwright)
scripts/vendor.mjs   aggiorna le librerie in app/vendor/
.github/workflows/   test e pubblicazione automatica su GitHub Pages
```

L'architettura dei moduli è descritta in [`app/README.md`](app/README.md#struttura).

## Sviluppo

Richiede Node.js 20+ e Python 3 (per il server statico locale).

```bash
npm install
npm run serve      # http://localhost:8080
npm test           # test unitari
npm run e2e        # test end-to-end, richiede Chrome/Chromium (percorso con CHROME=...)
```

Per aggiornare una libreria runtime: aggiorna la dipendenza, poi `npm run vendor`.

## Pubblicazione

Ogni push su `main` esegue i test e pubblica la cartella `app/` su GitHub Pages tramite [GitHub Actions](.github/workflows/pages.yml). Prima di un rilascio aumenta `VERSION` in `app/sw.js`, così le app installate propongono l'aggiornamento.

## Collegare Google Drive

Serve un progetto Google Cloud gratuito con un Client ID OAuth: la [guida passo passo](app/GUIDA_GOOGLE_CLOUD.md) spiega come crearlo. I valori si inseriscono in **Impostazioni → Google Drive** oppure in `app/config.js` (vedi `app/config.example.js`).

## Privacy

I dati, compresi i nomi dei giocatori, restano sul dispositivo e, se collegato, nel Google Drive di chi usa l'app. Non ci sono server di terze parti né analytics; gli unici script esterni sono quelli di Google per login e selezione della cartella, caricati solo quando si usa Drive.

## Licenza

[MIT](LICENSE) © 2026 Leonardo Bordoni
