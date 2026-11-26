// Gruppi di allenatori: Impostazioni › Gruppi, pagina del gruppo (#/gruppo/<id>) e ingresso dal link (#/unisciti).
// Tutto in parole semplici; login e finestra di Google sempre dentro il tocco.
import { h, clear, toast, confirmDialog, modal } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { CATEGORIES, authorName, formatDateIT } from '../model.js';
import { parseInvite, activeMembers, normEmail, validEmail } from '../groups.js';
import { pageHeader } from './common.js';

const folderUrl = (id) => 'https://drive.google.com/drive/folders/' + encodeURIComponent(id);
const dateIT = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('it-IT') : ''; };

async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } catch (e) { toast(sync.groupErrorMessage(e), 'error', 7000); return null; } finally { btn.disabled = false; }
}

// Promemoria per chi ha creato il gruppo: qualcuno è entrato, o gli inviti sono aperti da 3 giorni
function invitesReminder(g) {
  const m = g.manifest || {};
  if (m.invites === 'closed') return false;
  return activeMembers(m).length > 1 || Date.now() - (Date.parse(m.invitesAt || m.createdAt) || Date.now()) > 3 * 86400e3;
}

// ---------- Impostazioni › Gruppi ----------
export function groupsCard(rerender) {
  const st = sync.state;
  const sec = h('section.card#gruppi', h('h2', 'Gruppi di allenatori'));
  if (!st.configured) return null;
  sec.append(h('p', 'Condividi esercizi, piani, schede e rosa con gli altri allenatori della tua categoria (per esempio "Squadra U12").'));
  if (!st.folder) {
    sec.append(h('p.hint', 'Per creare un gruppo o entrare in un gruppo collega prima Google Drive (qui sopra).'));
    return sec;
  }
  const groups = sync.groupsNow();
  if (groups.length) {
    sec.append(h('ul.group-list', groups.map((g) => h('li', h('a.group-item', { href: '#/gruppo/' + encodeURIComponent(g.id) },
      h('strong', g.name || 'Gruppo'),
      h('small', g.status === 'ok'
        ? [g.category, `${activeMembers(g.manifest || {}).length} allenatori`, g.role === 'admin' ? 'lo hai creato tu' : ''].filter(Boolean).join(' · ')
        : g.status === 'deleted' ? `Il gruppo è stato eliminato da ${g.manifest && g.manifest.createdBy ? authorName(g.manifest.createdBy) : 'chi lo aveva creato'}`
          : 'Non fai più parte di questo gruppo'),
      g.status === 'ok' && g.role === 'admin' && invitesReminder(g) ? h('small.reminder', 'Tutti dentro? Chiudi gli inviti') : null)))));
  } else {
    sec.append(h('p.hint', 'Non sei ancora in nessun gruppo. Se un collega ti ha mandato un link di invito, aprilo da qui sul telefono.'));
  }
  const btn = h('button.btn.primary.big', { type: 'button', on: { click: () => createGroupDialog(rerender) } }, '+ Crea un gruppo');
  sec.append(btn);
  return sec;
}

async function createGroupDialog() {
  const name = h('input.input', { type: 'text', maxlength: 60, placeholder: 'Squadra U12', 'aria-label': 'Nome del gruppo', autocomplete: 'off' });
  const cat = h('select.input', { 'aria-label': 'Categoria' }, h('option', { value: '' }, 'Categoria (facoltativa)'), CATEGORIES.map((c) => h('option', { value: c }, c)));
  const ok = await modal({ title: 'Crea un gruppo', focus: name, content: h('div',
    h('label.field', h('span.field-label', 'Nome del gruppo'), name),
    h('label.field', h('span.field-label', 'Categoria'), cat),
    h('p.hint', 'Nel tuo Google Drive verrà creata la cartella "Rugby Coach – ' + '…' + '": i documenti del gruppo staranno lì e li vedranno tutti gli allenatori che inviterai.')),
  actions: [{ label: 'Annulla', value: false }, { label: 'Crea', value: true, primary: true }] });
  if (!ok) return;
  if (!name.value.trim()) { toast('Scrivi il nome del gruppo.', 'error'); return; }
  try {
    // l'accesso a Google (se serve) parte subito dentro createGroup, ancora nel tocco su "Crea"
    const g = await sync.createGroup({ name: name.value, category: cat.value });
    toast(`Gruppo "${g.name}" creato. Ora invita i colleghi.`, 'ok', 5000);
    location.hash = '#/gruppo/' + encodeURIComponent(g.id);
  } catch (e) { toast(sync.groupErrorMessage(e), 'error', 7000); }
}

// ---------- pagina del gruppo ----------
export async function groupView(root, { id }) {
  const render = async () => {
    clear(root);
    const g = sync.groupById(id);
    if (!g) { root.append(pageHeader('Gruppo', { back: '#/impostazioni' }), h('p.empty', 'Gruppo non trovato su questo dispositivo.')); return; }
    const me = sync.getMe();
    const m = g.manifest || {};
    const admin = g.role === 'admin';
    root.append(pageHeader(g.name || 'Gruppo', { back: '#/impostazioni', sub: [g.category, admin ? 'Lo hai creato tu' : (m.createdBy ? 'Creato da ' + authorName(m.createdBy) : '')].filter(Boolean).join(' · ') }));
    const body = h('div.settings.group-page');
    root.append(body);
    if (g.status === 'deleted') {
      const who = m.createdBy ? authorName(m.createdBy) : 'chi lo aveva creato';
      body.append(h('section.card', h('h2', `Il gruppo è stato eliminato da ${who}`),
        h('p', 'Su questo dispositivo ci sono ancora gli elementi del gruppo. Puoi tenerne una copia personale (diventano tuoi) oppure toglierli.'),
        h('div.btn-row',
          h('button.btn.primary', { type: 'button', on: { click: (ev) => busy(ev.currentTarget, async () => { const n = await sync.keepGroupCopy(g.id); toast(`${n} elementi ora sono tuoi (Personale).`, 'ok'); location.hash = '#/impostazioni'; }) } }, 'Tieni una copia personale'),
          h('button.btn', { type: 'button', on: { click: (ev) => busy(ev.currentTarget, async () => { await sync.forgetGroupLocally(g.id); toast('Gruppo tolto da questo dispositivo.', 'ok'); location.hash = '#/impostazioni'; }) } }, 'Togli dal dispositivo'))));
      return;
    }
    if (g.status !== 'ok') {
      body.append(h('section.card', h('h2', 'Non fai più parte di questo gruppo'),
        h('p', g.status === 'removed' ? 'Chi ha creato il gruppo ti ha tolto dal gruppo.' : 'I file del gruppo non si aprono più (il gruppo è stato chiuso o non hai più il permesso).'),
        h('p.hint', 'Le schede personali non cambiano. Puoi togliere da questo dispositivo gli elementi del gruppo.'),
        h('button.btn.primary', { type: 'button', on: { click: async (ev) => busy(ev.currentTarget, async () => { await sync.forgetGroupLocally(g.id); toast('Gruppo tolto da questo dispositivo.', 'ok'); location.hash = '#/impostazioni'; }) } }, 'Togli dal dispositivo')));
      return;
    }
    // invito
    const link = sync.inviteLinkFor(g);
    const inv = h('section.card', h('h2', 'Invita allenatori'));
    if (admin && m.invites !== 'closed' && invitesReminder(g)) {
      inv.append(h('div.banner.reminder', h('span', 'Tutti dentro? Chiudi gli inviti: il link non farà entrare nessun altro.'),
        h('button.btn.small', { type: 'button', on: { click: async (ev) => {
          const b = ev.currentTarget;
          if (!(await confirmDialog('Chiudere gli inviti? Potranno aprire il gruppo solo gli allenatori già entrati (e quelli invitati per email).', { okText: 'Chiudi gli inviti', title: 'Chiudi gli inviti' }))) return;
          busy(b, async () => { await sync.closeInvites(g.id); toast('Inviti chiusi.', 'ok'); render(); });
        } } }, 'Chiudi gli inviti')));
    }
    if (m.invites === 'closed') {
      inv.append(h('p', 'Gli inviti sono chiusi: possono aprire il gruppo solo gli allenatori qui sotto.'),
        h('p.hint', 'Usa questo link sugli altri tuoi dispositivi (stesso account Google):'),
        h('input.input.invite-link', { type: 'text', readonly: true, value: link, 'aria-label': 'Link del gruppo', on: { focus: (e) => e.target.select() } }));
    } else {
      inv.append(h('p', 'Manda questo link ai colleghi (WhatsApp, email…): lo aprono sul telefono ed entrano con il loro account Google.'));
      const share = h('button.btn.primary.big', { type: 'button', on: { click: async () => {
        const data = { title: 'Rugby Coach – ' + g.name, text: `Entra nel gruppo "${g.name}" su Rugby Coach:`, url: link };
        try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(link); toast('Link copiato: incollalo in un messaggio.', 'ok'); } catch { toast('Copia il link qui sotto.', 'info'); }
      } } }, '↗ Invita con un messaggio');
      const field = h('input.input.invite-link', { type: 'text', readonly: true, value: link, 'aria-label': 'Link di invito', on: { focus: (e) => e.target.select() } });
      inv.append(share, field, h('p.hint', 'Lo stesso link serve anche a te sugli altri tuoi dispositivi.'));
    }
    if (admin) {
      if (m.invites === 'closed') {
        inv.append(h('button.btn', { type: 'button', on: { click: async (ev) => {
          const b = ev.currentTarget;
          const hasRemoved = (m.removed || []).length > 0;
          const msg = 'Riaprire gli inviti? Chi ha già il link potrà di nuovo aprire i file del gruppo su Drive'
            + (hasRemoved ? ', anche chi hai tolto (pur senza poter rientrare nel gruppo)' : '')
            + '. Per far entrare una persona sola è meglio invitarla per email, qui sotto.';
          if (!(await confirmDialog(msg, { okText: 'Riapri comunque', title: 'Riapri gli inviti', focusCancel: true }))) return;
          busy(b, async () => { await sync.reopenInvites(g.id); toast('Inviti riaperti: chi ha il link può entrare.', 'ok'); render(); });
        } } }, 'Riapri gli inviti'));
      } else {
        inv.append(h('p.hint', 'Quando sono entrati tutti, chiudi gli inviti: il link non funzionerà più per nessun altro.'),
          h('button.btn', { type: 'button', on: { click: async (ev) => {
            const b = ev.currentTarget;
            if (!(await confirmDialog('Chiudere gli inviti? Potranno aprire il gruppo solo gli allenatori già entrati (e quelli invitati per email).', { okText: 'Chiudi gli inviti', title: 'Chiudi gli inviti' }))) return;
            busy(b, async () => { await sync.closeInvites(g.id); toast('Inviti chiusi.', 'ok'); render(); });
          } } }, 'Chiudi gli inviti'));
      }
      const email = h('input.input', { type: 'email', placeholder: 'nome@gmail.com', 'aria-label': 'Email del collega', autocomplete: 'off' });
      inv.append(h('h3', 'Invita per email'),
        h('p.hint', 'Se a un collega il link non basta (o gli inviti sono chiusi), scrivi qui la sua email Gmail; poi lui apre il link di invito.'),
        h('div.inline-form', email, h('button.btn', { type: 'button', on: { click: (ev) => busy(ev.currentTarget, async () => {
          if (!validEmail(email.value)) { toast('Scrivi un indirizzo email valido.', 'error'); return; }
          await sync.inviteByEmail(g.id, email.value); toast('Invitato: ora mandagli il link.', 'ok'); email.value = ''; render();
        }) } }, 'Invita')));
    }
    body.append(inv);
    // membri
    const mem = h('section.card', h('h2', 'Allenatori del gruppo'));
    const list = h('ul.member-list');
    for (const x of activeMembers(m)) {
      const isMe = me && normEmail(x.email) === me.email;
      const row = h('li', h('span', h('strong', authorName(x) + (isMe ? ' (tu)' : '')), h('small', ' ' + x.email + (x.role === 'admin' || normEmail(x.email) === normEmail(m.createdBy && m.createdBy.email) ? ' · ha creato il gruppo' : '') + (x.joinedAt ? ' · dal ' + dateIT(x.joinedAt) : ''))));
      if (admin && !isMe) row.append(h('button.btn.small.danger', { type: 'button', 'aria-label': 'Togli ' + authorName(x) + ' dal gruppo', on: { click: async (ev) => {
        const b = ev.currentTarget;
        if (!(await confirmDialog(`Togliere ${authorName(x)} dal gruppo? Non vedrà più le schede del gruppo; le sue schede personali restano sue.`, { okText: 'Togli', danger: true, title: 'Togli dal gruppo' }))) return;
        busy(b, async () => {
          const res = await sync.removeMember(g.id, x.email);
          toast(res && res.closedInvites ? `Gli inviti sono stati chiusi così ${authorName(x)} non può rientrare col vecchio link. Puoi riaprirli quando vuoi.` : 'Tolto dal gruppo.', 'ok', 8000);
          render();
        });
      } } }, 'Togli'));
      list.append(row);
    }
    mem.append(list);
    const invited = (m.invited || []).filter((x) => !activeMembers(m).some((y) => normEmail(y.email) === normEmail(x.email)));
    if (invited.length) mem.append(h('p.hint', 'Invitati per email, non ancora entrati: ' + invited.map((x) => x.email).join(', ')));
    body.append(mem);
    // cestino del gruppo
    const log = Object.values(await repo.getGroupDeletedLog(g.id)).filter((x) => x.how !== 'moved').sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15);
    if (log.length) {
      body.append(h('section.card', h('h2', 'Eliminati di recente'),
        h('ul.member-list', log.map((x) => h('li', h('span', h('strong', x.title || 'Elemento'), h('small', ` ${x.date ? formatDateIT(x.date) + ' · ' : ''}eliminato da ${x.by ? authorName(x.by) : 'un allenatore'} il ${dateIT(x.at)}`))))),
        h('p.hint', 'I documenti Word restano per 30 giorni nel cestino di Drive di chi li aveva creati.')));
    }
    // Drive, uscita
    body.append(h('section.card', h('h2', 'Documenti del gruppo'),
      h('p', 'I documenti Word del gruppo sono nella cartella ', h('a.folder-link', { href: folderUrl(g.folderId), target: '_blank', rel: 'noopener' }, 'Rugby Coach – ' + g.name), ' su Google Drive. La sottocartella "File per l\'app" serve all\'app: non aprirla e non modificarla.'),
      admin ? null : h('button.btn.danger', { type: 'button', on: { click: async (ev) => {
        const b = ev.currentTarget;
        if (!(await confirmDialog(`Uscire dal gruppo "${g.name}"? Le schede del gruppo spariranno da questo dispositivo (restano agli altri allenatori). Le tue schede personali non cambiano.`, { okText: 'Esci', danger: true, title: 'Esci dal gruppo' }))) return;
        busy(b, async () => { await sync.leaveGroup(g.id); toast('Sei uscito dal gruppo.', 'ok'); location.hash = '#/impostazioni'; });
      } } }, 'Esci dal gruppo')));
  };
  await render();
  const onGroups = () => { if (root.isConnected && !root.contains(document.activeElement)) render(); };
  repo.bus.addEventListener('groups', onGroups);
  return () => repo.bus.removeEventListener('groups', onGroups);
}

// ---------- ingresso dal link di invito (funziona anche al primo avvio) ----------
export async function joinView(root, params, query) {
  const inv = parseInvite(query);
  const name = inv && inv.name ? inv.name : 'il gruppo';
  root.append(pageHeader('Entra nel gruppo', { sub: inv && inv.name ? inv.name : '' }));
  const box = h('section.card.join-card');
  root.append(h('div.settings', box));
  if (!inv) { box.append(h('p', 'Questo link non è un invito valido a un gruppo di Rugby Coach.'), h('a.btn', { href: '#/' }, 'Vai alle schede')); return; }
  const st = sync.state;
  const done = sync.groupForInvite(inv);
  const msg = h('p.join-msg', { role: 'status', 'aria-live': 'polite' });
  const render = () => {
    clear(box);
    box.append(h('h2', `Entra nel gruppo "${name}"`),
      h('p', 'Ti hanno invitato a condividere esercizi, piani, schede e rosa con gli altri allenatori del gruppo. Le tue schede personali restano tue.'));
    if (!st.configured) { box.append(h('p.banner.warn', 'In questa versione dell\'app Google Drive non è disponibile.')); return; }
    const g = sync.groupForInvite(inv);
    if (g || done) {
      const gg = g || done;
      box.append(h('p.ok.big-ok', done ? `Sei già nel gruppo "${gg.name}".` : `✓ Sei nel gruppo "${gg.name}".`),
        h('a.btn.primary.big', { href: '#/?gruppo=' + encodeURIComponent(gg.id) }, done ? 'Apri' : 'Vai alle schede del gruppo'));
      return;
    }
    if (!navigator.onLine) { box.append(h('p.banner.warn', 'Serve la connessione a Internet per entrare nel gruppo.')); return; }
    if (!st.folder || !sync.hasToken()) {
      box.append(h('h3', '1. Accedi con Google'), h('p.hint', 'Usa l\'account Google con cui vuoi lavorare nel gruppo.'));
      const b = h('button.btn.primary.big', { type: 'button', on: { click: () => busy(b, async () => {
        // un tocco: accesso (dentro il tocco) e, se serve, collegamento della propria cartella "Rugby Coach"
        if (!st.folder) await sync.connectDrive(); else await sync.signIn();
        const meta = (await repo.getSetting('meta', {})) || {};
        if (!meta.onboarded) await repo.setSetting('meta', { ...meta, onboarded: true });
        render();
      }) } }, 'Accedi con Google');
      sync.preloadGoogle();
      box.append(b, msg);
      return;
    }
    box.append(h('h3', '2. Scegli i file del gruppo'),
      h('p', 'Si apre una finestra di Google con i file del gruppo: selezionali ', h('strong', 'tutti'), ' e tocca ', h('strong', 'Seleziona'), '.'));
    const b = h('button.btn.primary.big', { type: 'button', disabled: !sync.pickerReady(), on: { click: () => {
      let p;
      try { p = sync.joinGroupNow(inv); } catch (e) { msg.textContent = sync.groupErrorMessage(e, inv.admin); return; } // subito, dentro il tocco
      b.disabled = true; msg.textContent = 'Entro nel gruppo…';
      p.then((res) => {
        if (res && res.cancelled) { msg.textContent = `Se nella finestra non vedevi nessun file, chiedi a ${inv.admin || 'chi ha creato il gruppo'} di invitarti con la tua email Gmail, poi riapri il link.`; return; }
        toast(`Sei nel gruppo "${res.group.name}".`, 'ok', 5000);
        render();
      }, (e) => { msg.textContent = sync.groupErrorMessage(e, inv.admin); }).finally(() => { b.disabled = false; });
    } } }, sync.pickerReady() ? 'Apri i file del gruppo' : 'Preparazione…');
    if (!sync.pickerReady()) sync.preparePicker().then(() => { b.disabled = false; b.textContent = 'Apri i file del gruppo'; }, () => { msg.textContent = 'Non riesco a raggiungere Google. Riprova tra poco.'; });
    box.append(b, msg);
  };
  render();
}
