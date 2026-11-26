// Impostazioni e prima schermata (R17, R21, R22, R24).
// Per l'allenatore: solo "Google Drive" in parole semplici e "Aiuto". Tutto il resto (copie di sicurezza su file,
// recupero, disconnessione, configurazione per sviluppatori...) sta in "Avanzate", chiuso di default.
import { h, clear, toast, confirmDialog, downloadBlob, pickFile, debounce } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { recordTitle, STORE_OF_KIND, todayISO, SESSION_MODULES, DEFAULT_MODULES, MODULE_ORDER, sanitizeModules } from '../model.js';
import { pageHeader } from './common.js';

export const APP_VERSION = '1.5.1';

const folderUrl = (f) => 'https://drive.google.com/drive/folders/' + encodeURIComponent(f.folderId);

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } catch (e) { toast(sync.friendlyError(e), 'error', 6000); return null; } finally { btn.disabled = false; }
}

export function connectedMessage(f) {
  return h('p.ok.big-ok', '✓ Le schede si salvano in Drive › ', h('a.folder-link', { href: folderUrl(f), target: '_blank', rel: 'noopener' }, f.folderName || 'Rugby Coach'));
}

// Pulsante grande "Collega Google Drive": login + cartella "Rugby Coach" trovata o creata in automatico
export function connectButton(onDone, { label = 'Collega Google Drive' } = {}) {
  // la richiesta di accesso parte subito nel tocco (connectDrive non attende nulla prima): serve su iPhone/Safari
  const btn = h('button.btn.primary.big.connect-btn', { type: 'button', on: { click: () => withBusy(btn, async () => {
    if (!navigator.onLine) throw new Error('Non riesco a raggiungere Google. Riprova quando sei connesso.');
    const res = await sync.connectDrive();
    onDone && onDone(res);
  }) } }, label);
  sync.preloadGoogle(); // l'app propone di collegare Drive: prepara subito l'accesso Google
  return btn;
}

const privacyLink = () => h('a.privacy-link', { href: './privacy.html' }, 'Informativa sulla privacy');

const recovered = (res) => (res && res.restored && res.restored.inserted ? `Abbiamo recuperato ${res.restored.inserted} ${res.restored.inserted === 1 ? 'scheda' : 'schede'} dal tuo Drive.` : '');

export async function settingsView(root) {
  const body = h('div.settings');
  root.append(pageHeader('Impostazioni'), body);
  const render = async () => {
    // "Sezioni della seduta" e "Aiuto" compaiono subito; Drive e Avanzate appena pronti (in parallelo)
    clear(body);
    const sections = sectionsCard(render);
    const help = helpCard();
    body.append(sections, help);
    const [drive, adv] = await Promise.all([driveCard(render), advancedSection(render)]);
    if (!sections.isConnected) return; // pagina già ridisegnata
    body.prepend(drive);
    body.append(adv);
  };
  await render();
}

async function driveCard(rerender) {
  const st = sync.state;
  const sec = h('section.card#drive', h('h2', 'Google Drive'));
  if (!st.configured) {
    sec.append(h('p', 'In questa versione dell\'app il salvataggio su Google Drive non è attivo. Le schede restano sul telefono e puoi inviarle a chi vuoi con il pulsante ', h('strong', '↗ Condividi'), '.'));
    return sec;
  }
  if (!st.folder) {
    sec.append(h('p', 'Collega Google Drive per avere una copia di tutte le schede nel tuo Drive, anche se cambi telefono.'),
      connectButton((res) => { toast('Fatto! Le schede si salvano in Drive › Rugby Coach. ' + recovered(res), 'ok', 6000); rerender(); }));
    return sec;
  }
  sec.append(connectedMessage(st.folder));
  if (st.account) sec.append(h('p.hint', 'Account: ' + st.account));
  const pend = (await sync.pendingEntries()).length;
  if (st.lastError) sec.append(h('p.banner.warn', st.lastError), connectButton(() => rerender(), { label: 'Collega di nuovo Google Drive' }));
  if (pend) {
    const b = h('button.btn.primary.big', { type: 'button', on: { click: () => withBusy(b, async () => { await sync.syncNow(); toast('Salvato su Drive ✓', 'ok'); rerender(); }) } }, '☁ Salva su Drive adesso');
    sec.append(h('p', `${pend === 1 ? '1 scheda da salvare' : pend + ' schede da salvare'} su Drive.`), b);
  } else {
    sec.append(h('p', 'Tutto salvato su Drive ✓'));
  }
  return sec;
}

// Sezioni con cui partono i nuovi allenamenti (voce semplice, fuori da Avanzate)
function sectionsCard(rerender) {
  const prefs = repo.peekSetting('prefs', {}) || {};
  const mods = prefs.defaultModules ? sanitizeModules(prefs.defaultModules) : DEFAULT_MODULES;
  const sec = h('section.card#sezioni', h('h2', 'Sezioni della seduta'),
    h('p', 'I nuovi allenamenti partono con: ', h('strong', mods.map((m) => SESSION_MODULES[m].label).join(' · ')), '.'));
  const list = h('div.module-pick');
  for (const m of MODULE_ORDER) {
    const input = h('input', { type: 'checkbox', value: m, checked: mods.includes(m), disabled: m === 'program' });
    input.addEventListener('change', async () => {
      const chosen = MODULE_ORDER.filter((x) => x === 'program' || list.querySelector(`input[value="${x}"]`).checked);
      const cur = (await repo.getSetting('prefs', {})) || {};
      if (chosen.length === 1) { const { defaultModules, ...rest } = cur; await repo.setSetting('prefs', rest); } else await repo.setSetting('prefs', { ...cur, defaultModules: chosen });
      toast('Salvato: vale per i prossimi allenamenti.', 'ok');
      rerender();
    });
    list.append(h('label.module-option', input, h('span', h('strong', SESSION_MODULES[m].label), h('small', SESSION_MODULES[m].desc))));
  }
  sec.append(list);
  if (prefs.defaultModules) sec.append(h('button.btn', { type: 'button', on: { click: async () => { const { defaultModules, ...rest } = prefs; await repo.setSetting('prefs', rest); toast('I nuovi allenamenti partono con il solo Programma.', 'ok'); rerender(); } } }, 'Torna al solo Programma'));
  sec.append(h('p.hint', 'Gli allenamenti già fatti non cambiano. In un allenamento puoi sempre aggiungere o togliere sezioni.'));
  return sec;
}

function helpCard() {
  return h('section.card', h('h2', 'Aiuto'),
    h('p', 'Come installare l\'app sul telefono, condividere una scheda, cosa fare se cambi telefono.'),
    h('a.btn.big', { href: '#/info' }, '❓ Come si usa'));
}

async function advancedSection(rerender) {
  const st = sync.state;
  const adv = h('details.card.advanced', h('summary', h('strong', 'Avanzate')));
  adv.append(h('p.hint', 'Opzioni per esperti. Di solito non servono.'));

  // ----- Drive avanzato -----
  if (st.configured) {
    const box = h('div.adv-group', h('h3', 'Google Drive'));
    box.append(h('p.hint', 'Su Drive vanno un documento Word e un file di dati per ogni scheda, più la libreria esercizi e la rosa. Le modifiche fatte a mano sui documenti in Drive non tornano nell\'app.'));
    const prefs = (await repo.getSetting('prefs', { autoSync: true })) || { autoSync: true };
    const auto = h('input', { type: 'checkbox', checked: prefs.autoSync !== false, id: 'autosync' });
    auto.addEventListener('change', async () => { await repo.setSetting('prefs', { ...prefs, autoSync: auto.checked }); toast(auto.checked ? 'Salvataggio automatico su Drive attivo.' : 'Salvataggio su Drive solo con il pulsante.', 'ok'); });
    box.append(h('label.check', auto, ' Salva su Drive automaticamente'));
    if (st.folder) {
      const queueBox = h('div.queue-box');
      const fillQueue = async () => {
        const entries = await sync.allEntries();
        const qList = h('ul.queue');
        for (const e of entries.sort((a, b) => (b.dirtyAt || 0) - (a.dirtyAt || 0)).slice(0, 50)) {
          const isColl = e.kind === 'library' || e.kind === 'roster' || e.kind === 'deleted';
          const rec = isColl ? { kind: e.kind } : await repo.get(e.kind, e.id);
          if (!rec) continue;
          if (isColl && !Object.keys(e.files || {}).length && e.status === 'synced') continue;
          const lab = sync.statusLabel(e);
          const link = e.links && (e.links['docx-plan'] || e.links['docx-match'] || e.links['docx-termplan'] || e.links['docx-library']);
          qList.append(h('li', h('span', (isColl ? '📚 ' : '') + recordTitle(rec) + (rec.date ? ' — ' + rec.date : '')), h('span.status-pill.' + lab.cls, { title: lab.title }, lab.text),
            link ? h('a.small', { href: link, target: '_blank', rel: 'noopener' }, 'apri') : null));
        }
        clear(queueBox).append(entries.length ? qList : h('p.hint', 'Nessuna scheda ancora.'));
      };
      await fillQueue();
      const refresh = debounce(() => { if (queueBox.isConnected) fillQueue(); else { repo.bus.removeEventListener('sync-entry', refresh); repo.bus.removeEventListener('sync-state', refresh); } }, 300);
      repo.bus.addEventListener('sync-entry', refresh);
      repo.bus.addEventListener('sync-state', refresh);
      box.append(h('h4', 'Stato delle schede su Drive'), queueBox,
        h('div.btn-row',
          h('button.btn', { type: 'button', on: { click: (ev) => withBusy(ev.currentTarget, async () => {
            const s = await sync.restoreFromDrive();
            toast(`Recuperate da Drive: ${s.inserted} nuove, ${s.updated} aggiornate.`, 'ok', 6000);
          }) } }, '⇩ Recupera le schede da Drive'),
          h('button.btn', { type: 'button', on: { click: async () => { await sync.markAllDirty(); toast('Tutte le schede verranno salvate di nuovo su Drive.', 'ok'); rerender(); } } }, 'Salva di nuovo tutto su Drive'),
          st.pickerAvailable ? h('button.btn', { type: 'button', on: { click: (ev) => withBusy(ev.currentTarget, async () => {
            const f = await sync.pickExistingFolder();
            if (f) { toast(`Cartella "${f.name}" collegata.`, 'ok'); rerender(); }
          }) } }, '📁 Usa un\'altra cartella di Drive') : null,
          h('button.btn', { type: 'button', on: { click: (ev) => withBusy(ev.currentTarget, async () => {
            const forget = await confirmDialog('Scollegare Google Drive da questo telefono? Le schede restano sul telefono e i file su Drive non vengono cancellati.', { okText: 'Scollega', title: 'Scollega Drive' });
            if (!forget) return;
            await sync.signOut({ forgetFolder: true }); toast('Google Drive scollegato.', 'ok'); rerender();
          }) } }, 'Scollega Google Drive'),
          h('button.btn', { type: 'button', on: { click: (ev) => withBusy(ev.currentTarget, async () => {
            await sync.switchAccount();
            const res = await sync.connectDrive();
            toast('Account cambiato. ' + recovered(res), 'ok', 6000); rerender();
          }) } }, 'Usa un altro account Google')));
    }
    adv.append(box);
  }

  // ----- Copie di sicurezza su file -----
  const data = h('div.adv-group', h('h3', 'Copia di sicurezza su file'));
  const counts = [];
  const names = { session: 'allenamenti', match: 'partite', plan: 'piani', exercise: 'esercizi', player: 'giocatori' };
  for (const kind of Object.keys(STORE_OF_KIND)) counts.push(`${(await repo.list(kind)).length} ${names[kind]}`);
  data.append(h('p.hint', 'Sul telefono: ' + counts.join(', ') + '.'),
    h('div.btn-row',
      h('button.btn', { type: 'button', on: { click: async () => {
        const all = await repo.exportAll();
        downloadBlob(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }), `rugby-coach-backup-${todayISO()}.json`);
      } } }, '⬇ Esporta tutti i dati (file .json)'),
      h('button.btn', { type: 'button', on: { click: async () => {
        const f = await pickFile();
        if (!f) return;
        try { const r = await repo.importBackup(await f.text()); toast(`Importati: ${r.inserted} nuovi, ${r.updated} aggiornati, ${r.skipped} già aggiornati.`, 'ok', 6000); } catch (e) { toast('Importazione non riuscita: ' + e.message, 'error', 7000); }
      } } }, '⇪ Importa dati da file')),
    h('p.hint', 'L\'importazione unisce i dati: per ogni scheda vince la modifica più recente.'));
  const persistEl = h('span', '…');
  data.append(h('p.hint', 'Protezione dei dati sul telefono: ', persistEl));
  (async () => {
    if (!navigator.storage || !navigator.storage.persisted) { persistEl.textContent = 'non disponibile in questo browser'; return; }
    const p = await navigator.storage.persisted();
    persistEl.textContent = p ? 'attiva' : 'non concessa (installa l\'app sul telefono)';
    if (!p) persistEl.after(h('button.btn.small', { type: 'button', on: { click: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Protezione attivata.' : 'Il browser non l\'ha concessa.', ok ? 'ok' : 'info'); } } }, 'Richiedi'));
  })();
  adv.append(data);

  // ----- Esempi e cancellazione -----
  const nEx = await repo.countExamples();
  adv.append(h('div.adv-group', h('h3', 'Dati di esempio e pulizia'),
    h('div.btn-row',
      nEx ? h('button.btn', { type: 'button', on: { click: async () => {
        if (!(await confirmDialog(`Eliminare ${nEx} elementi di esempio (piano I° trimestre e giochi)?`, { okText: 'Elimina esempi', danger: true }))) return;
        const n = await repo.deleteExamples(); toast(`${n} elementi eliminati.`, 'ok'); location.reload();
      } } }, `Elimina dati di esempio (${nEx})`) : h('button.btn', { type: 'button', on: { click: async () => { await repo.reloadExamples(); toast('Esempi ricaricati.', 'ok'); location.reload(); } } }, 'Ricarica dati di esempio'),
      h('button.btn.danger', { type: 'button', on: { click: async () => {
        if (!(await confirmDialog('Cancellare TUTTI i dati da questo telefono? I file su Drive non vengono toccati.', { okText: 'Cancella tutto', danger: true }))) return;
        await repo.wipeAll(); toast('Dati cancellati.', 'ok'); location.hash = '#/'; location.reload();
      } } }, 'Cancella tutti i dati dal telefono'))));

  // ----- Configurazione per sviluppatori -----
  adv.append(await developerConfig(rerender));

  // ----- App -----
  const upd = h('button.btn', { type: 'button', on: { click: async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) { toast('Aggiornamenti automatici non attivi in questa pagina.', 'info'); return; }
    await reg.update(); toast('Controllo aggiornamenti eseguito.', 'ok');
  } } }, 'Controlla aggiornamenti');
  adv.append(h('div.adv-group', h('h3', 'App'), h('p.hint', `Rugby Coach versione ${APP_VERSION}`), h('div.btn-row', upd)));
  return adv;
}

async function developerConfig(rerender) {
  const st = sync.state;
  const saved = (await repo.getSetting('google', {})) || {};
  const fileCfg = sync.getFileConfig();
  const inputs = {
    clientId: h('input.input', { type: 'text', value: saved.clientId || '', placeholder: fileCfg.clientId ? '(da config.js) ' + fileCfg.clientId : '1234567890-abc….apps.googleusercontent.com', 'aria-label': 'Client ID OAuth', autocomplete: 'off', spellcheck: 'false' }),
    apiKey: h('input.input', { type: 'text', value: saved.apiKey || '', placeholder: 'facoltativa (solo per il Picker)', 'aria-label': 'API key', autocomplete: 'off', spellcheck: 'false' }),
    appId: h('input.input', { type: 'text', inputmode: 'numeric', value: saved.appId || '', placeholder: 'facoltativo (solo per il Picker)', 'aria-label': 'App ID (numero progetto)', autocomplete: 'off' }),
  };
  const saveBtn = h('button.btn.primary', { type: 'button', on: { click: () => withBusy(saveBtn, async () => {
    await sync.saveConfig({ clientId: inputs.clientId.value, apiKey: inputs.apiKey.value, appId: inputs.appId.value });
    toast('Configurazione salvata.', 'ok');
    rerender();
  }) } }, 'Salva configurazione');
  return h('details.adv-group.dev-config', h('summary', h('strong', 'Configurazione Google (sviluppatori)')),
    h('p.hint', 'Di norma il Client ID è già incluso nell\'app (app/config.js, vedi docs/SETUP_GOOGLE.md). Qui si può sostituire per prove. Origine da autorizzare: ', h('code.origin', location.origin)),
    h('p.hint', 'Stato: ' + (st.configured ? `configurato (da ${st.configSource})` : 'non configurato')),
    h('label.field', h('span.field-label', 'Client ID OAuth (Applicazione web)'), inputs.clientId),
    h('label.field', h('span.field-label', 'API key (facoltativa, Picker)'), inputs.apiKey),
    h('label.field', h('span.field-label', 'App ID = numero del progetto (facoltativo, Picker)'), inputs.appId),
    h('div.btn-row', saveBtn,
      saved.clientId || saved.apiKey || saved.appId ? h('button.btn', { type: 'button', on: { click: async () => { await sync.saveConfig({}); toast('Configurazione rimossa.', 'ok'); rerender(); } } }, 'Rimuovi') : null));
}

// ---------- Prima schermata: collegamento a Drive in un tocco ----------
export async function onboardingView(root) {
  const meta = (await repo.getSetting('meta', {})) || {};
  const done = async () => { await repo.setSetting('meta', { ...meta, onboarded: true }); location.hash = '#/'; };
  const st = sync.state;
  const box = h('div.onboarding');
  root.append(box);
  if (!st.configured) {
    box.append(h('div.onb-hero', h('img', { src: './icons/icon.svg', alt: '', width: 96, height: 96 }),
      h('h1', 'Benvenuto in Rugby Coach'),
      h('p.lead', 'Compila le schede di allenamento e partita anche senza rete. Puoi inviarle a chi vuoi con ↗ Condividi.'),
      h('button.btn.primary.big.connect-btn', { type: 'button', on: { click: done } }, 'Inizia'),
      privacyLink()));
    return;
  }
  if (st.folder) { box.append(h('div.onb-hero', h('h1', 'Google Drive è collegato'), connectedMessage(st.folder), h('button.btn.primary.big', { type: 'button', on: { click: done } }, 'Inizia'))); return; }
  const hero = h('div.onb-hero',
    h('img', { src: './icons/icon.svg', alt: '', width: 96, height: 96 }),
    h('h1', 'Salva le tue schede su Google Drive'),
    h('p.lead', 'Così hai sempre una copia delle schede, anche se cambi telefono.'),
    connectButton(async (res) => {
      await repo.setSetting('meta', { ...meta, onboarded: true });
      clear(hero).append(...[h('div.done-check', { 'aria-hidden': 'true' }, '✓'), h('h1', 'Fatto!'),
        h('p.lead', 'Le schede si salvano in Drive › Rugby Coach'),
        recovered(res) ? h('p', recovered(res)) : null,
        h('button.btn.primary.big', { type: 'button', on: { click: done } }, 'Inizia')].filter(Boolean));
    }),
    h('button.link-btn', { type: 'button', on: { click: done } }, 'Più tardi'),
    privacyLink());
  box.append(hero);
}
