// Avvisi in home: modalità Drive, accesso necessario, installazione iOS, dati di esempio, persistenza.
import { h, toast } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export async function banners() {
  const box = h('div.banners');
  const prefs = (await repo.getSetting('prefs', {})) || {};
  const st = sync.state;
  if (!st.configured) {
    box.append(h('div.banner.info', h('p', h('strong', 'Modalità solo locale. '), 'I dati sono salvati su questo dispositivo. Per salvarli anche su Google Drive configura l\'accesso.'),
      h('a.btn', { href: '#/impostazioni' }, 'Configura Google Drive')));
  } else if (!st.folder) {
    box.append(h('div.banner.warn', h('p', h('strong', 'Google Drive non collegato. '), 'Scegli una cartella esistente o crea la cartella "Rugby Coach".'),
      h('a.btn.primary', { href: '#/benvenuto' }, 'Collega Drive')));
  } else {
    const pend = await sync.pendingEntries();
    if (pend.length && !sync.hasToken()) {
      box.append(h('div.banner.warn', h('p', `${pend.length} ${pend.length === 1 ? 'scheda in attesa' : 'schede in attesa'} di sincronizzazione. `, navigator.onLine ? 'Accedi a Google per inviarle.' : 'Partiranno al ritorno della rete.'),
        navigator.onLine ? h('button.btn.primary', { type: 'button', on: { click: async (e) => {
          e.currentTarget.disabled = true;
          try { const s = await sync.syncNow(); toast(s && s.synced ? `${s.synced} schede inviate a Drive.` : 'Sincronizzazione completata.', 'ok'); location.reload(); } catch (err) { toast(err.message, 'error', 6000); e.currentTarget.disabled = false; }
        } } }, 'Accedi e sincronizza') : null));
    }
  }
  const hint = await repo.getSetting('restoreHint', null);
  if (hint && st.folder && hint.folderId === st.folder.folderId) {
    const b = h('div.banner.info', h('p', h('strong', 'Backup trovati su Drive: '), `la cartella contiene ${hint.count === 1 ? '1 scheda che non è' : hint.count + ' schede che non sono'} su questo dispositivo (es. da un altro telefono o tablet).`),
      h('div.banner-actions',
        h('button.btn.primary', { type: 'button', on: { click: async (e) => {
          e.currentTarget.disabled = true;
          try { const r = await sync.restoreFromDrive(); toast(`Ripristino: ${r.inserted} nuove, ${r.updated} aggiornate.`, 'ok', 6000); location.reload(); } catch (err) { toast(err.message, 'error', 6000); e.currentTarget.disabled = false; }
        } } }, '⇩ Ripristina ora'),
        h('button.btn.small', { type: 'button', on: { click: async () => { await repo.setSetting('restoreHint', null); b.remove(); } } }, 'No, grazie')));
    box.append(b);
  }
  if (isIOS() && !isStandalone() && !prefs.iosHintDismissed) {
    const b = h('div.banner.ios', h('p', h('strong', 'Installa l\'app su iPhone/iPad: '), 'tocca ', h('span.kbd', 'Condividi ⬆'), ' e poi ', h('span.kbd', 'Aggiungi alla schermata Home'),
      '. Così funziona offline e Safari non cancella i dati.'),
    h('button.btn.small', { type: 'button', on: { click: async () => { await repo.setSetting('prefs', { ...prefs, iosHintDismissed: true }); b.remove(); } } }, 'Ho capito'));
    box.append(b);
  }
  if (window.__installPrompt && !isStandalone()) {
    const b = h('div.banner.info', h('p', 'Installa Rugby Coach sul dispositivo per usarlo offline a bordo campo.'),
      h('button.btn.primary', { type: 'button', on: { click: async () => { const ev = window.__installPrompt; window.__installPrompt = null; ev.prompt(); await ev.userChoice; b.remove(); } } }, 'Installa app'));
    box.append(b);
  }
  const ex = await repo.countExamples();
  if (ex && !prefs.examplesHintDismissed) {
    const b = h('div.banner.example', h('p', 'Sono presenti ', h('strong', 'dati di esempio'), ' (piano "I° trimestre" e giochi in libreria). Puoi usarli come modello o eliminarli.'),
      h('div.banner-actions',
        h('button.btn.small', { type: 'button', on: { click: async () => { await repo.setSetting('prefs', { ...prefs, examplesHintDismissed: true }); b.remove(); } } }, 'Tienili'),
        h('button.btn.small.danger', { type: 'button', on: { click: async () => { const n = await repo.deleteExamples(); toast(`${n} elementi di esempio eliminati.`, 'ok'); location.reload(); } } }, 'Elimina esempi')));
    box.append(b);
  }
  return box;
}
