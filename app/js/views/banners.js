// Avvisi in home, pochi e brevi: collegare Drive (se disponibile), installare l'app, recupero schede.
// L'invito a "Salvare su Drive" quando l'accesso è scaduto è UNO solo ed è globale (main.js).
import { h, toast } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { connectButton } from './settings.js';

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
  const dismiss = (key, el) => h('button.btn.small', { type: 'button', on: { click: async () => { await repo.setSetting('prefs', { ...prefs, [key]: true }); el.remove(); } } }, 'Non ora');

  if (st.configured && !st.folder && !prefs.connectHintDismissed) {
    const b = h('div.banner.info');
    b.append(h('p', h('strong', 'Salva le schede su Google Drive'), ' — così hai sempre una copia.'),
      h('div.banner-actions', connectButton(() => { toast('Fatto! Le schede si salvano in Drive › Rugby Coach', 'ok', 5000); location.reload(); }, { label: 'Collega' }), dismiss('connectHintDismissed', b)));
    box.append(b);
  }
  const hint = await repo.getSetting('restoreHint', null);
  if (hint && st.folder && hint.folderId === st.folder.folderId) {
    const b = h('div.banner.info', h('p', h('strong', 'Schede trovate su Drive: '), `${hint.count === 1 ? '1 scheda non è' : hint.count + ' schede non sono'} su questo telefono.`),
      h('div.banner-actions',
        h('button.btn.primary', { type: 'button', on: { click: async (e) => {
          e.currentTarget.disabled = true;
          try { const r = await sync.restoreFromDrive(); toast(`Recuperate ${r.inserted} schede.`, 'ok', 6000); location.reload(); } catch (err) { toast(sync.friendlyError(err), 'error', 6000); e.currentTarget.disabled = false; }
        } } }, '⇩ Recupera'),
        h('button.btn.small', { type: 'button', on: { click: async () => { await repo.setSetting('restoreHint', null); b.remove(); } } }, 'No')));
    box.append(b);
  }
  if (isIOS() && !isStandalone() && !prefs.iosHintDismissed) {
    const b = h('div.banner.ios', h('p', h('strong', 'Metti l\'app sul telefono: '), 'tocca ', h('span.kbd', 'Condividi ⬆'), ' e poi ', h('span.kbd', 'Aggiungi alla schermata Home'), '.'));
    b.append(dismiss('iosHintDismissed', b));
    box.append(b);
  }
  if (window.__installPrompt && !isStandalone() && !prefs.installHintDismissed) {
    const b = h('div.banner.info', h('p', h('strong', 'Metti l\'app sul telefono'), ' per usarla anche senza rete.'));
    b.append(h('div.banner-actions',
      h('button.btn.primary', { type: 'button', on: { click: async () => { const ev = window.__installPrompt; window.__installPrompt = null; ev.prompt(); await ev.userChoice; b.remove(); } } }, 'Installa'),
      dismiss('installHintDismissed', b)));
    box.append(b);
  }
  return box;
}
