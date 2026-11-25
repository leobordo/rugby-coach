# Rugby Coach

Web app installabile (PWA) per allenatori di minirugby e rugby giovanile. Riproduce le schede cartacee di allenamento e partita, permette di disegnare gli esercizi su una Tactic Board e salva tutto sul proprio Google Drive come documenti Word.

**App:** <https://leobordo.github.io/rugby-coach/>

## Funzionalità

- **Schede compilabili**: foglio allenamento (programma, bilancio, errori e cause, autovalutazione, preparatore atletico), scheda di osservazione, scheda della partita con contatori +/−, piano trimestrale da cui generare le sedute.
- **Tactic Board**: campo intero, metà campo o griglia; pedine di due squadre, palla, coni, paletti, scudi, frecce di corsa, passaggio e calcio, mano libera e testo; annulla/ripeti, ridimensiona e ruota.
- **Libreria esercizi** riutilizzabile e **rosa** per categoria.
- **Offline e persistente**: dati in IndexedDB sul dispositivo, service worker per l'uso a bordo campo senza rete.
- **Google Drive in un tocco**: "Collega Google Drive" → accesso Google → la cartella **Rugby Coach** viene ritrovata o creata da sola. Ogni scheda diventa un `.docx` fedele all'originale più un `.json` di backup, salvati in automatico; i file vengono aggiornati, mai duplicati, anche cambiando telefono (recupero automatico). Accesso limitato ai soli file creati dall'app (scope `drive.file`).
- **Condividi**: ogni scheda (e la libreria esercizi) si manda come documento Word a WhatsApp, Mail, Drive o File, anche senza Drive collegato.
- **Pensata per il telefono** e per allenatori non informatici: pulsanti grandi, linguaggio semplice, opzioni tecniche nascoste in Impostazioni → Avanzate.

Senza Client ID configurato l'app funziona solo sul telefono (condivisione compresa).

## Struttura del repository

```
app/                 web app statica pubblicata su GitHub Pages (nessun build step)
  js/                moduli ES: modello dati, IndexedDB, Drive, sync, Tactic Board, viste
  vendor/            librerie runtime copiate localmente (nessun CDN)
  README.md          aiuto per l'allenatore (visibile nell'app: Impostazioni → Come si usa)
docs/
  SETUP_GOOGLE.md    configurazione Google una tantum per lo sviluppatore (Client ID)
  ARCHITETTURA.md    moduli, dati, integrazione Drive, test
tests/               test unitari (node --test) ed end-to-end (Playwright)
scripts/vendor.mjs   aggiorna le librerie in app/vendor/
.github/workflows/   test e pubblicazione automatica su GitHub Pages
```

L'architettura è descritta in [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md).

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

## Configurare Google Drive (sviluppatore, una volta sola)

È già fatta (progetto `rugby-coach-515808`, Client ID in `app/config.js`, informativa in [`app/privacy.html`](app/privacy.html)). Serve solo un **Client ID OAuth** di tipo "Applicazione web" in `app/config.js`: la procedura (progetto, Drive API, Google Auth Platform pubblicata in produzione, origini autorizzate) è in [`docs/SETUP_GOOGLE.md`](docs/SETUP_GOOGLE.md). Gli allenatori non vedono mai campi di configurazione.

## Privacy

Informativa: <https://leobordo.github.io/rugby-coach/privacy.html>.

I dati, compresi i nomi dei giocatori, restano sul dispositivo e, se collegato, nel Google Drive di chi usa l'app. Non ci sono server di terze parti né analytics; gli unici script esterni sono quelli di Google per l'accesso, caricati solo quando si usa Drive.

## Licenza

[MIT](LICENSE) © 2026 Leonardo Bordoni
