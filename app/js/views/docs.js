// Aiuto per l'allenatore (app/README.md) mostrato come pagina dell'app, anche offline (il .md è nel precache).
import { h } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { pageHeader } from './common.js';

export const DOCS = {
  info: { file: './README.md', title: 'Come si usa' },
};
const LINKS = { 'README.md': '#/info' };

export async function docView(root, key) {
  const d = DOCS[key];
  root.append(pageHeader(d.title, { back: '#/impostazioni' }));
  const box = h('article.card.md-doc');
  root.append(box);
  try {
    const res = await fetch(d.file);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let md = await res.text();
    box.innerHTML = renderMarkdown(md, { linkMap: LINKS }); // renderMarkdown escapa tutto il testo
  } catch (e) {
    box.append(h('p.banner.error', 'Impossibile aprire il documento (' + e.message + '). Riprova quando sei online.'));
  }
}
