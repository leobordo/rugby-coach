# Collegare Rugby Coach a Google Drive — guida passo passo

Questa guida è per chi **non** è uno sviluppatore. Serve **una volta sola** e richiede circa 15–20 minuti.
Alla fine avrai tre valori da incollare nell'app (**Impostazioni → Google Drive**):

| Valore | Esempio | A cosa serve |
|---|---|---|
| **Client ID** | `1234567890-abc123….apps.googleusercontent.com` | permette di fare "Accedi con Google" |
| **API key** | `AIzaSy…` | serve alla finestra di scelta della cartella (Google Picker) |
| **App ID** (numero del progetto) | `123456789012` | serve anch'esso al Google Picker |

> **È gratis.** Non serve inserire una carta di credito: le API usate (Drive e Picker) sono gratuite per questo uso.
>
> **È sicuro.** L'app chiede solo il permesso **"drive.file"**: vede e modifica **soltanto i file che crea lei** (o la cartella che scegli tu). Non può leggere il resto del tuo Drive. Questi tre valori non sono password: si possono scrivere nell'app senza rischi.
>
> I nomi dei menu possono cambiare leggermente nel tempo o in base alla lingua della console. Se non trovi una voce, usa la **barra di ricerca in alto** nella console e scrivi il nome della pagina (es. "Credenziali", "Google Auth Platform").

Prima di iniziare tieni a portata di mano **l'indirizzo dove è pubblicata l'app**, per esempio
`https://tuonome.github.io` (solo la parte iniziale, senza percorso finale). Lo trovi anche nell'app: **Impostazioni → Google Drive → Configurazione** mostra l'indirizzo esatto da usare.

---

## 1. Crea un progetto Google Cloud

1. Apri <https://console.cloud.google.com/> e accedi con il tuo account Google (quello del Drive dove vuoi salvare le schede).
2. Se è la prima volta, accetta i Termini di servizio.
3. In alto a sinistra, accanto al logo "Google Cloud", clicca sul **selettore dei progetti** → **Nuovo progetto**.
4. Nome del progetto: `Rugby Coach` (va bene qualsiasi nome). Lascia "Organizzazione/Posizione" come proposto.
5. Clicca **Crea** e attendi qualche secondo. Poi assicurati che in alto sia selezionato il progetto **Rugby Coach**.

## 2. Abilita le due API necessarie

1. Menu ☰ (in alto a sinistra) → **API e servizi** → **Libreria**.
2. Cerca **Google Drive API** → aprila → **Abilita**.
3. Torna alla Libreria, cerca **Google Picker API** → aprila → **Abilita**.

## 3. Configura la schermata di consenso (Google Auth Platform)

È la finestra che appare quando premi "Accedi con Google" nell'app.

1. Menu ☰ → **API e servizi** → **Schermata consenso OAuth** (nelle console recenti si apre la sezione **Google Auth Platform**). Clicca **Inizia** se richiesto.
2. **Informazioni sull'app**: nome dell'app `Rugby Coach`, e la tua email come "Email di assistenza utenti". → **Avanti**.
3. **Pubblico / Audience**: scegli **Esterno** (External). → **Avanti**.
4. **Dati di contatto**: la tua email. → **Avanti**.
5. Accetta le norme sui dati utente → **Continua** → **Crea**.

### Lasciala in modalità "Test" e aggiungi i colleghi come utenti di test

Per uso personale e per pochi colleghi **non serve** pubblicare l'app né farla verificare da Google.

1. In **Google Auth Platform** apri **Pubblico** (Audience). Lo "Stato di pubblicazione" deve essere **In fase di test** (Testing). Non premere "Pubblica app".
2. Nella sezione **Utenti di test** clicca **+ Add users / Aggiungi utenti**.
3. Inserisci **il tuo indirizzo Gmail** e quello di **ogni collega** che userà l'app (fino a 100 persone). → **Salva**.

Cose da sapere sulla modalità Test:
- Solo gli indirizzi in elenco possono accedere. Se un collega vede *"Accesso bloccato: l'app non ha completato la procedura di verifica"*, non è stato aggiunto agli utenti di test.
- Al primo accesso Google mostra l'avviso **"Google non ha verificato questa app"**: è normale. Clicca **Continua** (a volte prima su "Avanzate").
- Ogni collega salva le schede **sul proprio Drive**, nella cartella che sceglie lui.

### Permessi (scope)
Non serve aggiungere nulla nella sezione "Accesso ai dati": l'app chiede da sola solo `…/auth/drive.file`, che è un permesso **non sensibile**.

## 4. Crea il Client ID (tipo "Applicazione web")

1. In **Google Auth Platform** apri **Client** → **+ Crea client** (oppure: **API e servizi → Credenziali → + Crea credenziali → ID client OAuth**).
2. **Tipo di applicazione**: **Applicazione web**.
3. **Nome**: `Rugby Coach web`.
4. **Origini JavaScript autorizzate** → **+ Aggiungi URI**, e inserisci **uno per riga**:
   - l'indirizzo dove è ospitata l'app, per esempio `https://tuonome.github.io`
     (solo `https://` + dominio, **senza** `/` finale e senza percorso: anche se l'app è in `https://tuonome.github.io/rugby-coach/`, qui va `https://tuonome.github.io`);
   - `http://localhost:8080` (per provarla sul computer, vedi README).
5. **URI di reindirizzamento autorizzati**: lasciali vuoti.
6. Clicca **Crea**. Compare una finestra con l'**ID client**: copialo (finisce con `.apps.googleusercontent.com`).
   Il "client secret" **non serve** e non va inserito da nessuna parte.

> **Drive condivisi**: puoi scegliere anche una cartella in un Drive condiviso (della società): l'app lo supporta.

> Le modifiche alle origini possono impiegare da 5 minuti a qualche ora per avere effetto. Se all'accesso compare l'errore `origin_mismatch` o `redirect_uri_mismatch`, ricontrolla l'indirizzo (https, nessuna barra finale, porta corretta) e attendi qualche minuto.

## 5. Crea la API key (e limitala)

1. Menu ☰ → **API e servizi** → **Credenziali** → **+ Crea credenziali** → **Chiave API**.
2. Copia la chiave (inizia con `AIza`). Poi clicca **Modifica chiave API** (o sul nome della chiave) per limitarla:
   - **Restrizioni delle applicazioni** → **Siti web (referrer HTTP)** → aggiungi:
     - `https://tuonome.github.io/*` (il tuo indirizzo, seguito da `/*`)
     - `http://localhost:8080/*`
     - `https://docs.google.com/*` ← **necessario**: senza questa riga il Picker mostra l'errore "API developer key is invalid".
   - **Restrizioni delle API** → **Limita chiave** → seleziona **Google Picker API** e **Google Drive API**.
3. **Salva**.

## 6. Trova il numero del progetto (App ID)

1. Menu ☰ → **IAM e amministrazione** → **Impostazioni** (oppure la scheda "Informazioni sul progetto" nella **Dashboard / Pagina iniziale** del progetto).
2. Copia il **Numero progetto**: sono solo cifre, per esempio `123456789012`.
   Attenzione: **non** è l'"ID progetto" (che contiene lettere, es. `rugby-coach-123456`).

## 7. Incolla i valori nell'app

1. Apri Rugby Coach → **Impostazioni** → **Google Drive** → **Configurazione Google Cloud**.
2. Incolla **Client ID**, **API key** e **App ID (numero del progetto)** → **Salva configurazione**.
3. Premi **Accedi con Google**, scegli il tuo account e concedi l'accesso.
4. Scegli dove salvare:
   - **A. Cartella esistente** → si apre Google Picker che mostra solo le cartelle: scegline una;
   - **B. Nuova cartella** → l'app crea nel tuo Drive la cartella **"Rugby Coach"** (puoi cambiare il nome).
5. Fatto. Da ora ogni scheda viene salvata su Drive come documento **Word (.docx)** più un file **.json** di backup, nella cartella scelta. Ogni volta che modifichi una scheda, l'app aggiorna **lo stesso file** (non crea copie).

In alternativa (per chi gestisce l'hosting) i tre valori si possono scrivere nel file `config.js` dell'app, partendo da `config.example.js`: così i colleghi non devono inserirli. I valori inseriti dalle Impostazioni hanno la precedenza.

---

## Domande frequenti

**Ogni quanto devo rifare l'accesso?**
L'accesso dura circa un'ora (è una regola di Google per le app senza server) e, per sicurezza, l'app lo dimentica quando la chiudi. Quando scade, le schede restano salvate sul dispositivo con lo stato *"In attesa di sincronizzazione"*; in home compare il pulsante **Accedi e sincronizza**. Non devi mai rifare l'accesso per compilare le schede: serve solo per inviarle a Drive.

**Se modifico il documento Word su Drive, la modifica torna nell'app?**
No. La sincronizzazione è **monodirezionale** (app → Drive). Se poi modifichi la stessa scheda nell'app, il file su Drive viene sovrascritto. Per tenere una versione modificata a mano, fai una copia del file su Drive.

**Ho cambiato telefono / ho cancellato i dati del browser.**
1. Apri l'app sul nuovo dispositivo, inserisci gli stessi tre valori (se non sono già in `config.js`) e premi **Accedi con Google** con lo stesso account.
2. Scegli **la stessa cartella** di prima (A. Cartella esistente).
3. In home compare **"Backup trovati su Drive" → Ripristina ora** (oppure **Impostazioni → Ripristina dai backup .json su Drive**).

Le schede tornano nell'app già collegate ai loro file su Drive (stato *Sincronizzato*): **non vengono caricate di nuovo e non si creano doppioni**. Tornano anche la **libreria esercizi** (con i disegni) e la **rosa**, che l'app salva in Drive nei file *Rugby Coach - Libreria esercizi* (.docx e .json) e *Rugby Coach - Rosa giocatori.json*.
In alternativa usa **Esporta tutto (JSON)** / **Importa backup** dalle Impostazioni.

**Ho scollegato la cartella / ho cambiato account e poi l'ho scelta di nuovo: avrò file doppi?**
No. Ogni file creato dall'app porta un'etichetta nascosta con il codice della scheda: prima di creare un file l'app cerca nella cartella quelli che esistono già e li aggiorna.

**I dati di esempio (piano "I° trimestre", giochi) finiscono su Drive?**
Vengono creati una sola volta nella cartella, se non ci sono già; un dispositivo con gli esempi non modificati non sovrascrive mai i file su Drive. Quando modifichi un esempio diventa tuo e viene aggiornato come le altre schede.

**Un collega vuole usare l'app.**
Aggiungi la sua email in **Google Auth Platform → Pubblico → Utenti di test** (punto 3). Lui usa lo stesso indirizzo dell'app; se `config.js` non contiene i valori, li incolla nelle sue Impostazioni.

**Errore "Il browser ha bloccato la finestra di accesso".**
Consenti i popup per l'indirizzo dell'app e premi di nuovo "Accedi con Google".

**Privacy dei bambini.**
I nomi dei bambini restano sul dispositivo e nel **tuo** Drive. L'app non li invia ad altri servizi.
