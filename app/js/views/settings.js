// Impostazioni (Drive, dati, app) e onboarding (R17, R21, R22, R24).
import { h, clear, toast, confirmDialog, downloadBlob, pickFile, debounce } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { recordTitle, STORE_OF_KIND, todayISO } from '../model.js';
import { pageHeader } from './common.js';

export const APP_VERSION = '1.2.0';

const guideLink = () => h('a.inline-btn', { href: '#/guida' }, 'guida passo passo');
const folderLink = (f) => h('a', { href: 'https://drive.google.com/drive/folders/' + encodeURIComponent(f.folderId), target: '_blank', rel: 'noopener' }, f.folderName || f.folderId);

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message || String(e), 'error', 7000); return null; } finally { btn.disabled = false; }
}

function folderChooser(onDone) {
  const nameIn = h('input.input', { type: 'text', value: sync.DEFAULT_FOLDER_NAME, 'aria-label': 'Nome della nuova cartella' });
  const pickBtn = h('button.btn.primary.big', { type: 'button', on: { click: () => withBusy(pickBtn, async () => {
    const f = await sync.pickExistingFolder();
    if (f) { toast(`Cartella "${f.name}" collegata.`, 'ok'); onDone && onDone(f); }
  }) } }, '📁 Scegli una cartella esistente');
  const createBtn = h('button.btn.primary.big', { type: 'button', on: { click: () => withBusy(createBtn, async () => {
    const f = await sync.createDedicatedFolder(nameIn.value);
    toast(`Cartella "${f.name}" creata nel tuo Drive.`, 'ok'); onDone && onDone(f);
  }) } }, '＋ Crea cartella dedicata');
  return h('div.folder-chooser',
    h('div.choice-card', h('h3', 'A. Cartella esistente'), h('p', 'Si apre Google Picker: mostra solo le cartelle. L\'app potrà creare i suoi file lì dentro.'), pickBtn),
    h('div.choice-card', h('h3', 'B. Nuova cartella'), h('label.field', h('span.field-label', 'Nome'), nameIn), createBtn));
}

export async function settingsView(root) {
  const body = h('div.settings');
  root.append(pageHeader('Impostazioni'), body);
  const render = async () => {
    clear(body);
    body.append(await driveSection(render), await dataSection(), appSection());
  };
  await render();
  const onState = () => { if (!body.isConnected) repo.bus.removeEventListener('sync-state', onState); };
  repo.bus.addEventListener('sync-state', onState);
}

async function driveSection(rerender) {
  const st = sync.state;
  const cfg = await sync.getConfig();
  const saved = (await repo.getSetting('google', {})) || {};
  const fileCfg = sync.getFileConfig();
  const prefs = (await repo.getSetting('prefs', { autoSync: true })) || { autoSync: true };
  const sec = h('section.card#google', h('h2', 'Google Drive'));

  sec.append(h('p.note', h('strong', 'Sincronizzazione monodirezionale: '), 'l\'app invia le schede a Drive (un documento Word .docx per scheda + un file .json di backup; libreria esercizi (con i disegni) e rosa vanno in "Rugby Coach - Libreria esercizi" (.docx + .json) e "Rugby Coach - Rosa giocatori.json"). Le modifiche fatte a mano sui file in Drive ',
    h('strong', 'non'), ' tornano nell\'app. Accesso limitato ai soli file creati dall\'app (permesso "drive.file"). Ricollegando la stessa cartella o da un altro dispositivo l\'app riconosce i suoi file e li aggiorna, senza duplicarli.'));

  // stato
  const rows = [
    ['Configurazione', st.configured ? `presente (da ${st.configSource})` : 'assente — l\'app funziona in solo-locale'],
    ['Account', st.account || (sync.hasToken() ? 'connesso' : 'non connesso')],
    ['Cartella', st.folder ? folderLink(st.folder) : 'non scelta'],
  ];
  if (st.lastError) rows.push(['Problema', st.lastError]);
  sec.append(h('dl.status-list', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)])));

  // configurazione
  const inputs = {
    clientId: h('input.input', { type: 'text', value: saved.clientId || '', placeholder: fileCfg.clientId ? '(da config.js) ' + fileCfg.clientId : '1234567890-abc….apps.googleusercontent.com', 'aria-label': 'Client ID OAuth', autocomplete: 'off', spellcheck: 'false' }),
    apiKey: h('input.input', { type: 'text', value: saved.apiKey || '', placeholder: fileCfg.apiKey ? '(da config.js)' : 'AIza…', 'aria-label': 'API key', autocomplete: 'off', spellcheck: 'false' }),
    appId: h('input.input', { type: 'text', inputmode: 'numeric', value: saved.appId || '', placeholder: fileCfg.appId ? '(da config.js) ' + fileCfg.appId : '123456789012', 'aria-label': 'App ID (numero progetto)', autocomplete: 'off' }),
  };
  const saveBtn = h('button.btn.primary', { type: 'button', on: { click: () => withBusy(saveBtn, async () => {
    await sync.saveConfig({ clientId: inputs.clientId.value, apiKey: inputs.apiKey.value, appId: inputs.appId.value });
    toast('Configurazione salvata.', 'ok');
    rerender();
  }) } }, 'Salva configurazione');
  sec.append(h('details.config', { open: !st.configured },
    h('summary', 'Configurazione Google Cloud (Client ID, API key, App ID)'),
    h('p', 'Crea gratuitamente un progetto Google Cloud seguendo la ', guideLink(), ' e incolla qui i tre valori. Tra le "Origini JavaScript autorizzate" del Client ID inserisci:'),
    h('p', h('code.origin', location.origin)),
    h('label.field', h('span.field-label', 'Client ID OAuth (Applicazione web)'), inputs.clientId),
    h('label.field', h('span.field-label', 'API key (per Google Picker)'), inputs.apiKey),
    h('label.field', h('span.field-label', 'App ID = numero del progetto'), inputs.appId),
    h('div.btn-row', saveBtn,
      saved.clientId || saved.apiKey || saved.appId ? h('button.btn', { type: 'button', on: { click: async () => { await sync.saveConfig({}); toast('Configurazione rimossa dalle impostazioni.', 'ok'); rerender(); } } }, 'Rimuovi') : null)));

  if (!st.configured) return sec;
  if (!navigator.onLine) sec.append(h('p.banner.warn', 'Sei offline: login e scelta della cartella saranno disponibili al ritorno della rete.'));

  // accesso
  const signBtn = h('button.btn', { type: 'button', on: { click: () => withBusy(signBtn, async () => { await sync.signIn(); toast('Accesso effettuato.', 'ok'); rerender(); }) } }, sync.hasToken() ? 'Rinnova accesso' : 'Accedi con Google');
  const syncBtn = h('button.btn.primary', { type: 'button', disabled: !st.folder, on: { click: () => withBusy(syncBtn, async () => {
    const s = await sync.syncNow();
    toast(s ? `Sincronizzazione: ${s.synced} inviate${s.errors ? ', ' + s.errors + ' errori' : ''}.` : 'Niente da sincronizzare.', s && s.errors ? 'error' : 'ok');
    rerender();
  }) } }, '☁ Sincronizza ora');
  const outBtn = h('button.btn', { type: 'button', on: { click: () => withBusy(outBtn, async () => {
    const forget = await confirmDialog('Disconnettere Google? Vuoi anche dimenticare la cartella scelta (consigliato se cambierai account)?', { okText: 'Disconnetti e dimentica cartella', title: 'Disconnetti' });
    await sync.signOut({ forgetFolder: !!forget }); toast('Disconnesso da Google.', 'ok'); rerender();
  }) } }, 'Disconnetti');
  const switchBtn = h('button.btn', { type: 'button', on: { click: () => withBusy(switchBtn, async () => { await sync.switchAccount(); toast('Account cambiato: scegli la cartella.', 'ok'); rerender(); }) } }, 'Cambia account');
  sec.append(h('div.btn-row', signBtn, syncBtn, outBtn, switchBtn));

  const auto = h('input', { type: 'checkbox', checked: prefs.autoSync !== false, id: 'autosync' });
  auto.addEventListener('change', async () => { await repo.setSetting('prefs', { ...prefs, autoSync: auto.checked }); toast(auto.checked ? 'Sincronizzazione automatica attiva.' : 'Sincronizzazione solo manuale.', 'ok'); });
  sec.append(h('label.check', auto, ' Sincronizza automaticamente quando c\'è rete e l\'accesso è valido'));

  // cartella
  sec.append(h('h3', st.folder ? 'Cambia cartella' : 'Scegli dove salvare'), folderChooser(() => rerender()));

  // coda (aggiornata dal vivo con gli eventi di sincronizzazione)
  const queueBox = h('div.queue-box');
  const fillQueue = async () => {
    const entries = await sync.allEntries();
    const qList = h('ul.queue');
    for (const e of entries.sort((a, b) => (b.dirtyAt || 0) - (a.dirtyAt || 0)).slice(0, 50)) {
      const isColl = e.kind === 'library' || e.kind === 'roster';
      const rec = isColl ? { kind: e.kind } : await repo.get(e.kind, e.id);
      if (!rec) continue;
      if (isColl && !Object.keys(e.files || {}).length && e.status === 'synced') continue; // raccolta vuota: niente su Drive
      const lab = sync.statusLabel(e);
      qList.append(h('li', h('span', (isColl ? '📚 ' : '') + recordTitle(rec) + (rec.date ? ' — ' + rec.date : '')), h('span.status-pill.' + lab.cls, { title: lab.title }, lab.text),
        e.links && (e.links['docx-plan'] || e.links['docx-match'] || e.links['docx-termplan'] || e.links['docx-library']) ? h('a.small', { href: e.links['docx-plan'] || e.links['docx-match'] || e.links['docx-termplan'] || e.links['docx-library'], target: '_blank', rel: 'noopener' }, 'apri') : null));
    }
    clear(queueBox).append(entries.length ? qList : h('p.hint', 'Nessuna scheda ancora in coda.'));
  };
  await fillQueue();
  const refreshQueue = debounce(() => { if (queueBox.isConnected) fillQueue(); else { repo.bus.removeEventListener('sync-entry', refreshQueue); repo.bus.removeEventListener('sync-state', refreshQueue); } }, 300);
  repo.bus.addEventListener('sync-entry', refreshQueue);
  repo.bus.addEventListener('sync-state', refreshQueue);
  sec.append(h('h3', 'Stato delle schede'), queueBox,
    h('div.btn-row',
      h('button.btn', { type: 'button', on: { click: async () => { await sync.markAllDirty(); toast('Tutte le schede messe in coda.', 'ok'); rerender(); } } }, 'Rimetti in coda tutte le schede'),
      h('button.btn', { type: 'button', on: { click: (ev) => withBusy(ev.currentTarget, async () => {
        const s = await sync.restoreFromDrive();
        toast(`Ripristino: ${s.files} file letti, ${s.inserted} nuovi, ${s.updated} aggiornati.`, 'ok', 6000);
      }) } }, '⇩ Ripristina dai backup .json su Drive')));
  return sec;
}

async function dataSection() {
  const sec = h('section.card', h('h2', 'Dati e backup'));
  const counts = [];
  for (const [kind, store] of Object.entries(STORE_OF_KIND)) counts.push(`${(await repo.list(kind)).length} ${store}`);
  sec.append(h('p.hint', 'Sul dispositivo: ' + counts.join(', ').replace('sessions', 'sedute').replace('matches', 'partite').replace('plans', 'piani').replace('exercises', 'esercizi').replace('players', 'giocatori')));
  const persistEl = h('span', '…');
  sec.append(h('p', 'Archiviazione persistente: ', persistEl));
  (async () => {
    if (!navigator.storage || !navigator.storage.persisted) { persistEl.textContent = 'non supportata da questo browser'; return; }
    const p = await navigator.storage.persisted();
    let est = '';
    try { const e = await navigator.storage.estimate(); est = ` — usati ${(e.usage / 1e6).toFixed(1)} MB`; } catch { /* */ }
    persistEl.textContent = (p ? 'attiva (il browser non cancellerà i dati)' : 'non concessa: installa l\'app e/o tieni il backup') + est;
    if (!p) persistEl.after(h('button.btn.small', { type: 'button', on: { click: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Archiviazione persistente attivata.' : 'Il browser non ha concesso la persistenza.', ok ? 'ok' : 'info'); } } }, 'Richiedi'));
  })();
  sec.append(h('div.btn-row',
    h('button.btn.primary', { type: 'button', on: { click: async () => {
      const data = await repo.exportAll();
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `rugby-coach-backup-${todayISO()}.json`);
    } } }, '⬇ Esporta tutto (JSON)'),
    h('button.btn', { type: 'button', on: { click: async () => {
      const f = await pickFile();
      if (!f) return;
      try { const r = await repo.importBackup(await f.text()); toast(`Importati: ${r.inserted} nuovi, ${r.updated} aggiornati, ${r.skipped} già aggiornati.`, 'ok', 6000); } catch (e) { toast('Importazione non riuscita: ' + e.message, 'error', 7000); }
    } } }, '⇪ Importa backup (JSON)')));
  sec.append(h('p.hint', 'L\'importazione unisce i dati: per ogni scheda vince la modifica più recente.'));
  const nEx = await repo.countExamples();
  sec.append(h('div.btn-row',
    nEx ? h('button.btn', { type: 'button', on: { click: async () => {
      if (!(await confirmDialog(`Eliminare ${nEx} elementi di esempio (piano I° trimestre e giochi)?`, { okText: 'Elimina esempi', danger: true }))) return;
      const n = await repo.deleteExamples(); toast(`${n} elementi eliminati.`, 'ok'); location.reload();
    } } }, `Elimina dati di esempio (${nEx})`) : h('button.btn', { type: 'button', on: { click: async () => { await repo.reloadExamples(); toast('Esempi ricaricati.', 'ok'); location.reload(); } } }, 'Ricarica dati di esempio'),
    h('button.btn.danger', { type: 'button', on: { click: async () => {
      if (!(await confirmDialog('Cancellare TUTTI i dati da questo dispositivo? Fai prima un backup. I file su Drive non vengono toccati.', { okText: 'Cancella tutto', danger: true }))) return;
      await repo.wipeAll(); toast('Dati cancellati.', 'ok'); location.hash = '#/'; location.reload();
    } } }, 'Cancella tutti i dati locali')));
  return sec;
}

function appSection() {
  const sec = h('section.card', h('h2', 'App'));
  sec.append(h('p', `Rugby Coach v${APP_VERSION} — funziona offline; i dati restano sul dispositivo e (se collegato) sul tuo Google Drive.`));
  sec.append(h('p.hint', 'Installazione: su Android/Chrome usa "Installa app" o il menu ⋮ → "Aggiungi a schermata Home"; su iPhone/iPad in Safari tocca Condividi → "Aggiungi alla schermata Home".'));
  const upd = h('button.btn', { type: 'button', on: { click: async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) { toast('Service worker non attivo.', 'info'); return; }
    await reg.update(); toast('Controllo aggiornamenti eseguito.', 'ok');
  } } }, 'Controlla aggiornamenti');
  sec.append(h('div.btn-row', upd, h('a.btn', { href: '#/info' }, 'Informazioni e installazione'), h('a.btn', { href: '#/guida' }, 'Guida Google Drive')));
  return sec;
}

// ---------- Onboarding ----------
export async function onboardingView(root) {
  const meta = (await repo.getSetting('meta', {})) || {};
  const done = async () => { await repo.setSetting('meta', { ...meta, onboarded: true }); location.hash = '#/'; };
  const st = sync.state;
  const box = h('div.onboarding');
  root.append(box);
  box.append(h('h1', 'Benvenuto in Rugby Coach'),
    h('p.lead', 'Le tue schede di allenamento, partita e programmazione, compilabili a bordo campo anche senza rete, con la Tactic Board per disegnare gli esercizi.'));
  if (!st.configured) {
    box.append(h('div.card',
      h('h2', 'Dove vuoi salvare i dati?'),
      h('p', 'Le schede sono sempre salvate su questo dispositivo. Puoi anche salvarle su Google Drive come documenti Word: serve una configurazione una tantum (circa 15 minuti) seguendo la ', guideLink(), '.'),
      h('div.btn-row',
        h('button.btn.primary.big', { type: 'button', on: { click: async () => { await repo.setSetting('meta', { ...meta, onboarded: true }); location.hash = '#/impostazioni'; } } }, 'Configura Google Drive'),
        h('button.btn.big', { type: 'button', on: { click: done } }, 'Usa solo in locale per ora'))));
    return;
  }
  const step1 = h('div.card', h('h2', '1. Accedi con Google'),
    h('p', 'Si apre la finestra di Google: concedi l\'accesso ai soli file creati dall\'app.'),
    sync.hasToken() ? h('p.ok', '✓ Accesso effettuato' + (st.account ? ' come ' + st.account : '')) : h('button.btn.primary.big', { type: 'button', on: { click: (e) => withBusy(e.currentTarget, async () => { await sync.signIn(); clear(root); onboardingView(root); }) } }, 'Accedi con Google'));
  const step2 = h('div.card', h('h2', '2. Scegli la cartella su Drive'),
    st.folder ? h('p.ok', '✓ Cartella: ', folderLink(st.folder)) : null,
    folderChooser(async () => { await done(); }));
  box.append(step1, step2, h('div.btn-row', h('button.btn', { type: 'button', on: { click: done } }, st.folder ? 'Vai alla home' : 'Salta per ora (solo locale)')));
}
