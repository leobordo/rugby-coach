# Configurare Google Drive (una volta sola, a cura dello sviluppatore)

Gli allenatori non configurano nulla: toccano **Collega Google Drive** e l'app crea (o ritrova) la cartella
**Rugby Coach** nel loro Drive. Per farlo funzionare serve un solo valore, il **Client ID OAuth**, da inserire in
`app/config.js`. Tempo: circa 10 minuti.

## Configurazione attuale (già fatta)

| Voce | Valore |
|---|---|
| Progetto Google Cloud | `rugby-coach-515808` |
| API abilitate | Google Drive API |
| Google Auth Platform | pubblico **Esterno**, stato **In produzione** (scope solo `drive.file`, non sensibile) |
| Informativa privacy | <https://leobordo.github.io/rugby-coach/privacy.html> (`app/privacy.html`) |
| Client OAuth (Applicazione web) | `613972924268-728rj0ug6s50d6a5ursccrs16ug6fa6b.apps.googleusercontent.com` |
| Origini JavaScript autorizzate | `https://leobordo.github.io`, `http://localhost:8080` |
| Chiave API / App ID (Picker) | non usati |

Il Client ID è già in `app/config.js`. Le sezioni seguenti servono per rifare la configurazione da zero
(es. un nuovo progetto o un fork pubblicato su un altro dominio).

## 1. Progetto e API

1. <https://console.cloud.google.com/> → selettore progetti → **Nuovo progetto** (es. `Rugby Coach`).
2. **API e servizi → Libreria** → **Google Drive API** → **Abilita**.
   (Google Picker API serve solo per l'opzione avanzata "usa un'altra cartella": non abilitarla se non serve.)

## 2. Google Auth Platform

1. **Google Auth Platform → Branding**: nome app `Rugby Coach`, email di assistenza, email dello sviluppatore.
   Home page `https://leobordo.github.io/rugby-coach/`, informativa privacy
   `https://leobordo.github.io/rugby-coach/privacy.html` (titolare, contatti, dati trattati, revoca e cancellazione:
   se cambi qualcosa nell'app che riguarda i dati, aggiorna `app/privacy.html`).
2. **Pubblico (Audience)**: tipo utente **Esterno**, poi **Pubblica app** → stato **In produzione**.
   L'app chiede solo lo scope `https://www.googleapis.com/auth/drive.file` (accesso ai soli file creati
   dall'app), che è **non sensibile**: non serve la verifica dell'app e non servono utenti di test.
3. **Accesso ai dati**: non aggiungere scope (l'app richiede `drive.file` da sola).

Nota: mostrare nome e logo verificati sulla schermata di consenso richiede la *verifica del brand*
(home page pubblica, privacy policy sullo stesso dominio, dominio verificato in Search Console). È facoltativa:
senza, Google può mostrare meno informazioni sull'app nella schermata di consenso.

## 3. Client OAuth

1. **Google Auth Platform → Client → Crea client** → tipo **Applicazione web**, nome `Rugby Coach web`.
2. **Origini JavaScript autorizzate**:
   - `https://leobordo.github.io`
   - `http://localhost:8080` (sviluppo, `npm run serve`)
3. Nessun URI di reindirizzamento. Il client secret non serve e non va usato.
4. Copia l'**ID client** (`…apps.googleusercontent.com`).

Le modifiche alle origini possono richiedere da qualche minuto a qualche ora (`origin_mismatch` nel frattempo).

## 4. Nell'app

```js
// app/config.js
export default {
  clientId: '613972924268-728rj0ug6s50d6a5ursccrs16ug6fa6b.apps.googleusercontent.com',
};
```

I test non usano il config reale: `tests/e2e.mjs` sostituisce `config.js` con uno vuoto e
`tests/e2e-multidevice.mjs` con un Client ID di prova, e tutte le chiamate a Google vanno a un Drive finto.

Aumenta `VERSION` in `app/sw.js`, fai push su `main`: GitHub Actions esegue i test e pubblica.

Per le prove si può sostituire il Client ID senza ripubblicare: **Impostazioni → Avanzate → Configurazione Google
(sviluppatori)** (valore salvato solo su quel dispositivo).

### Facoltativo: scelta di una cartella esistente (Google Picker)

Solo se si vuole offrire in **Avanzate** il pulsante "Usa un'altra cartella di Drive": abilita la Google Picker API,
crea una **chiave API** limitata ai siti `https://leobordo.github.io/*`, `http://localhost:8080/*`,
`https://docs.google.com/*` e alle API Picker e Drive, e aggiungi in `config.js` `apiKey` e `appId`
(il **numero** del progetto, in *IAM e amministrazione → Impostazioni*).

## Come lavora l'app con Drive

- Accesso con Google Identity Services (token model, nessun server); il permesso dura circa un'ora ed è conservato
  sul dispositivo. Quando scade e c'è qualcosa da salvare, l'app mostra "Tocca per salvare su Drive" (o lo
  rinnova toccando "Fine allenamento"): la finestra di Google si chiude da sola.
- Dentro "Rugby Coach" l'app crea la sottocartella "File per l'app" (`rcKind=dataFolder`) per i suoi file `.json`;
  nella cartella principale restano solo i documenti Word. Nessun permesso aggiuntivo: tutto resta in `drive.file`.
- La cartella "Rugby Coach" ha `appProperties` `rcApp=rugby-coach, rcKind=folder`: su un nuovo telefono viene
  ritrovata e le schede recuperate in automatico. I file hanno etichette con il codice della scheda e vengono
  aggiornati, mai duplicati. Dettagli in [ARCHITETTURA.md](ARCHITETTURA.md).
