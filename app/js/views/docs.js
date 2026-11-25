// Guida Google Cloud e README mostrati come pagine dell'app (funzionano offline: i .md sono nel precache).
import { h } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { pageHeader } from './common.js';

export const DOCS = {
  guida: { file: './GUIDA_GOOGLE_CLOUD.md', title: 'Guida: collegare Google Drive' },
  info: { file: './README.md', title: 'Informazioni sull\'app' },
};
const LINKS = { 'GUIDA_GOOGLE_CLOUD.md': '#/guida', 'README.md': '#/info' };

export async function docView(root, key) {
  const d = DOCS[key];
  root.append(pageHeader(d.title, { back: '#/impostazioni', actions: [h('button.btn', { type: 'button', on: { click: () => window.print() } }, '🖶 Stampa')] }));
  const box = h('article.card.md-doc');
  root.append(box);
  try {
    const res = await fetch(d.file);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let md = await res.text();
    if (key === 'guida') md = md.replace(/`https:\/\/tuonome\.github\.io`/, (m) => m + ` (per questa installazione: \`${location.origin}\`)`);
    box.innerHTML = renderMarkdown(md, { linkMap: LINKS }); // renderMarkdown escapa tutto il testo
  } catch (e) {
    box.append(h('p.banner.error', 'Impossibile aprire il documento (' + e.message + '). Riprova quando sei online.'));
  }
}
