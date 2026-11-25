// Mini renderer Markdown -> HTML (sicuro: tutto il testo è escapato prima della formattazione).
// Serve a mostrare dentro l'app, anche offline, la guida Google Cloud e il README (punto 9).
// Supporta: titoli, paragrafi, **grassetto**, *corsivo*, `codice`, link, <autolink>, elenchi (anche annidati),
// citazioni, tabelle, blocchi di codice, linee orizzontali.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeHref(url, linkMap) {
  const u = String(url).trim();
  if (linkMap && linkMap[u]) return linkMap[u];
  if (/^https?:\/\//i.test(u) || u.startsWith('#') || /^[\w./-]+$/.test(u) || /^mailto:/i.test(u)) return u;
  return null;
}

function inline(text, opts) {
  // 1) estrae il codice inline, 2) escapa, 3) applica la formattazione sul testo già sicuro
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const raw = u.replace(/&amp;/g, '&');
    const href = safeHref(raw, opts.linkMap);
    if (!href) return t;
    const ext = /^https?:/i.test(href);
    return `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return s;
}

const slugify = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function renderMarkdown(md, opts = {}) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const listRe = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

  function renderList(start) {
    // costruisce elenchi annidati in base all'indentazione
    const stack = [];
    let html = '';
    let j = start;
    while (j < lines.length) {
      const m = listRe.exec(lines[j]);
      if (!m) {
        // riga di continuazione indentata
        if (/^\s{2,}\S/.test(lines[j]) && stack.length) { html += ' ' + inline(lines[j].trim(), opts); j++; continue; }
        break;
      }
      const indent = m[1].length;
      const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      while (stack.length && indent < stack[stack.length - 1].indent) { html += `</li></${stack.pop().tag}>`; }
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) { html += `<${tag}><li>`; stack.push({ indent, tag }); } else { html += '</li><li>'; }
      html += inline(m[3], opts);
      j++;
    }
    while (stack.length) html += `</li></${stack.pop().tag}>`;
    return { html, next: j };
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const txt = inline(h[2], opts);
      out.push(`<h${lvl} id="${slugify(h[2])}">${txt}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), opts)}</blockquote>`);
      continue;
    }
    if (listRe.test(line)) {
      const { html, next } = renderList(i);
      out.push(html);
      i = next;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*\|)/.test(lines[i]) && !listRe.test(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${buf.map((l) => inline(l, opts)).join(' ')}</p>`);
  }
  return out.join('\n');
}
