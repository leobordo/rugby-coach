// Generazione dei documenti Word (.docx) fedeli agli originali (D1/D3: tabelle, orientamento, disegni).
// Modulo puro: riceve la libreria `docx` (vendor/docx.mjs) come parametro, quindi gira nel browser e in Node.
import {
  formatDateIT, totalAttendance, totalDuration, matchColumnTotals, matchColumnLabels, reviewRowLabel,
  CATEGORIES, OBSERVATION_LEVELS, ERRORS_CORRECTED_LABEL, WORK_TIME_OPTIONS, SOLICITATION_OPTIONS,
  BLOCK_TYPES, ordinalRoman, normalizeUnder, sortCategories, toInt, sanitizeModules,
} from './model.js';

const CM = 567; // twip per cm
const A4_W = 11906, A4_H = 16838;
const SERIF = 'Times New Roman';
const SANS = 'Arial';
const SYMBOL = 'Segoe UI Symbol';
const CHECK_ON = '☒';  // ☒
const CHECK_OFF = '☐'; // ☐

// ---------- utilità immagini ----------

export function dataUrlToBytes(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  if (!m[2]) return new TextEncoder().encode(decodeURIComponent(m[3]));
  const bin = atob(m[3]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47];
  for (let i = 0; i < 4; i++) if (bytes[i] !== sig[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export function gifSize(bytes) {
  if (!bytes || bytes.length < 10) return null;
  const sig = [0x47, 0x49, 0x46, 0x38]; // GIF8
  for (let i = 0; i < 4; i++) if (bytes[i] !== sig[i]) return null;
  return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
}

const GIF_RE = /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/;
// Azione animata (GIF) se c'è: Word sul PC la mostra animata, in stampa si vede il primo fotogramma (la fase 1)
export function defaultImageFor(drawing) {
  if (!drawing) return null;
  if (typeof drawing.anim === 'string' && GIF_RE.test(drawing.anim)) {
    const data = dataUrlToBytes(drawing.anim);
    const size = gifSize(data);
    if (size && size.width && size.height) return { data, type: 'gif', ...size };
  }
  if (!drawing.thumb) return null;
  const data = dataUrlToBytes(drawing.thumb);
  const size = pngSize(data);
  if (!size) return null;
  return { data, type: 'png', ...size };
}

// ---------- builder ----------

export function createBuilder(docx, ctx = {}) {
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation,
    HeightRule, VerticalAlign, BorderStyle, ImageRun, TableLayoutType, PageBreak,
  } = docx;
  const imageFor = ctx.imageFor || defaultImageFor;

  const runs = (text, o = {}) => {
    const lines = String(text ?? '').split(/\r?\n/);
    return lines.map((t, i) => new TextRun({ text: t, break: i ? 1 : 0, font: o.font || SERIF, size: o.size || 20,
      bold: o.bold, italics: o.italics, underline: o.underline ? {} : undefined, color: o.color }));
  };
  const P = (text, o = {}) => new Paragraph({ children: Array.isArray(text) ? text : runs(text, o), alignment: o.align,
    spacing: { before: o.before ?? 0, after: o.after ?? 40 }, indent: o.indent, keepNext: o.keepNext, pageBreakBefore: o.pageBreakBefore });
  const R = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: o.font || SERIF, size: o.size || 20, bold: o.bold,
    italics: o.italics, underline: o.underline ? {} : undefined, color: o.color });
  const check = (on, size = 22) => new TextRun({ text: on ? CHECK_ON : CHECK_OFF, font: SYMBOL, size });
  const blank = (v, len = 12) => (v === null || v === undefined || String(v).trim() === '' ? '_'.repeat(len) : String(v));

  const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };
  const LINE = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
  const allBorders = { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE };

  const cell = (children, width, o = {}) => new TableCell({
    children: children.length ? children : [P('')],
    width: { size: width, type: WidthType.DXA },
    verticalAlign: o.vAlign || VerticalAlign.TOP,
    columnSpan: o.span,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    borders: o.borders,
  });

  const headerCell = (label, width, o = {}) => cell([P(label, { bold: true, size: o.size || 16, align: AlignmentType.CENTER, font: SERIF, after: 0 })], width, { vAlign: VerticalAlign.TOP });

  const table = (rows, widths, o = {}) => new Table({
    rows, columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED, borders: o.borders || allBorders, alignment: o.align || AlignmentType.CENTER,
  });

  const row = (cells, o = {}) => new TableRow({ children: cells, tableHeader: o.header,
    height: o.minHeight ? { value: o.minHeight, rule: HeightRule.ATLEAST } : undefined, cantSplit: o.cantSplit ?? true });

  const scaleWidths = (cmList, maxTw) => {
    const tw = cmList.map((c) => Math.round(c * CM));
    const sum = tw.reduce((a, b) => a + b, 0);
    if (sum <= maxTw) return tw;
    return tw.map((w) => Math.floor(w * maxTw / sum));
  };

  const image = (drawing, maxWidthCm, maxHeightCm) => {
    const img = imageFor(drawing);
    if (!img) return null;
    const maxW = maxWidthCm * 37.8, maxH = maxHeightCm * 37.8; // px a 96 dpi
    const k = Math.min(maxW / img.width, maxH / img.height);
    return new Paragraph({ children: [new ImageRun({ type: img.type || 'png', data: img.data, transformation: { width: Math.round(img.width * k), height: Math.round(img.height * k) } })], spacing: { before: 40, after: 40 } });
  };

  const section = (children, { landscape, margins }) => ({
    properties: {
      page: {
        size: landscape ? { width: A4_W, height: A4_H, orientation: PageOrientation.LANDSCAPE } : { width: A4_W, height: A4_H, orientation: PageOrientation.PORTRAIT },
        margin: margins,
      },
    },
    children,
  });

  const doc = (title, sections) => new Document({
    creator: 'Rugby Coach', title, description: 'Generato da Rugby Coach (app per allenatori di minirugby)',
    styles: { default: { document: { run: { font: SERIF, size: 20 } } } },
    sections,
  });

  const exerciseCell = (it, width, imgCm, withDuration) => {
    const out = [];
    const head = [R(it.name || '', { bold: true, size: 20 })];
    if (withDuration && toInt(it.durationMin) > 0) head.push(R(`  (${toInt(it.durationMin)} min)`, { size: 18 }));
    out.push(P(head));
    if (it.description) out.push(P(it.description, { size: 18 }));
    const img = image(it.drawing, imgCm, imgCm * 0.75);
    if (img) out.push(img);
    return cell(out, width);
  };

  const textCell = (text, width, o = {}) => cell(text ? [P(text, { size: o.size || 18 })] : [], width);

  // ---------------- Seduta modulare: UN documento con le sole sezioni presenti, nell'ordine scelto ----------------
  // Ogni sezione riprende la grafica dell'originale (foglio allenamento, scheda di osservazione), A4 orizzontale.
  function session(s) {
    const margins = { top: Math.round(1.5 * CM), bottom: Math.round(1.5 * CM), left: Math.round(1.8 * CM), right: Math.round(1.8 * CM) };
    const usable = A4_H - margins.left - margins.right;
    const half = Math.floor(usable / 2);
    const mods = sanitizeModules(s.modules);
    const rv = s.review || {};
    const children = [];

    // intestazione: "ALLENAMENTO DEL ___" (+ presenze se il modulo c'è ed è il primo, come nella scheda originale)
    const H = { font: SANS, size: 22, bold: true, italics: true };
    const attendanceRuns = () => {
      const att = s.attendance || {};
      const out = [];
      for (const c of CATEGORIES) {
        out.push(R(' N.' + c, H));
        out.push(R(' ' + (att[c] === null || att[c] === undefined || att[c] === '' ? '____' : String(att[c])) + ' ', { ...H, underline: true }));
      }
      const tot = totalAttendance(s);
      if (tot) out.push(R('   TOT. ' + tot, H));
      return out;
    };
    const head = [R('ALLENAMENTO DEL', H), R(' ' + (formatDateIT(s.date) || '________________') + ' ', { ...H, underline: true })];
    const attInHead = mods[0] === 'attendance';
    if (attInHead) head.push(...attendanceRuns());
    children.push(P(head, { align: AlignmentType.CENTER, after: 80, before: 0 }));
    const extra = [];
    const cats = sortCategories(s.categories || []);
    if (cats.length) extra.push('Categorie: ' + cats.join(', '));
    if (s.location) extra.push('Luogo: ' + s.location);
    if (extra.length) children.push(P(extra.join('   ·   '), { align: AlignmentType.CENTER, size: 18, italics: true, after: 120 }));

    const thin = { style: BorderStyle.SINGLE, size: 2, color: '999999' };
    const thinBorders = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };
    const blankRow = (widths, h) => row(widths.map((w) => cell([], w)), { minHeight: Math.round(h * CM) });

    const programBlock = () => {
      const w = scaleWidths([6.9, 3.3, 5.9, 3.8, 5.6], usable);
      const rows = [row(['ESERCIZIO E DURATA', 'MATERIALE\nE SPAZIO', 'OBIETTIVI', 'PAROLE\nCHIAVE', 'COSA OSSERVO']
        .map((l, i) => headerCell(l, w[i])), { header: true })];
      for (const it of s.planItems || []) {
        rows.push(row([
          exerciseCell(it, w[0], 6.0, true),
          textCell(it.materialsSpace, w[1]), textCell(it.objectives, w[2]),
          textCell((it.keywords || []).join(', '), w[3]), textCell(it.toObserve, w[4]),
        ], { minHeight: Math.round(3.5 * CM) }));
      }
      if (!(s.planItems || []).length) rows.push(blankRow(w, 3.5));
      const td = totalDuration(s);
      return [table(rows, w), P([R('Durata totale: ', { bold: true }), R(td ? td + ' min' : '—')], { align: AlignmentType.RIGHT, before: 80, after: 160 })];
    };
    const attendanceBlock = () => [P([R('PRESENTI ', H), ...attendanceRuns()], { align: AlignmentType.CENTER, before: 120, after: 160 })];
    const observationBlock = () => {
      const widths = scaleWidths([5.1, 5.4, 5.7, 5.7, 5.7], usable);
      const rows = [row(['ESERCIZIO', 'OBIETTIVO', 'COSA OSSERVO\nPOSITIVO', 'COSA OSSERVO\nNEGATIVO', 'MIGLIORAMENTI DA\nAPPORTARE']
        .map((l, i) => headerCell(l, widths[i])), { header: true })];
      for (const o of s.observations || []) {
        rows.push(row([
          exerciseCell(o, widths[0], 4.4, false),
          textCell(o.objective, widths[1]), textCell(o.positive, widths[2]), textCell(o.negative, widths[3]), textCell(o.improvements, widths[4]),
        ], { minHeight: Math.round(3.1 * CM) }));
      }
      if (!(s.observations || []).length) rows.push(blankRow(widths, 3.1));
      return [table(rows, widths), P('', { after: 160 })];
    };
    const reviewContent = (width) => {
      const inner = [Math.round(2.3 * CM), Math.round((width - 2.3 * CM - 200) * 0.45), 0];
      inner[2] = width - 200 - inner[0] - inner[1];
      const innerRows = [row(['Eser.', 'Complessivamente', 'individualmente (nomi)'].map((l, i) => cell([P(l, { size: 18 })], inner[i])), { header: true })];
      for (const r of rv.perExercise || []) {
        const lab = reviewRowLabel(s, r);
        innerRows.push(row([
          cell([P(lab.num || '·', { size: 18, bold: true }), ...(lab.name ? [P(lab.name, { size: 14, italics: true })] : [])], inner[0]),
          textCell(r.overall, inner[1]), textCell(r.individual, inner[2]),
        ], { minHeight: Math.round(0.8 * CM) }));
      }
      if (!(rv.perExercise || []).length) innerRows.push(blankRow(inner, 0.8));
      return [table(innerRows, inner, { borders: thinBorders }), P('')];
    };
    const errorsContent = () => (rv.errorsCauses || []).map((q, i) => {
      const parts = [R(`${i + 1}.  ${q.question}  `, { size: 18 }), R('Sì ', { size: 18 }), check(q.answer === 'yes', 20), R('  No ', { size: 18 }), check(q.answer === 'no', 20)];
      if (q.note) parts.push(R('  — ' + q.note, { size: 18, italics: true }));
      return P(parts, { after: 100 });
    });
    const REVIEW_H = 'BILANCIO DELLA SEDUTA (da solo prima del briefing finale)';
    const ERRORS_H = 'ERRORI E CAUSE (insieme agli atleti)';
    // bilancio + errori affiancati come nell'originale (pagina 3), se consecutivi; altrimenti ognuno da solo
    const reviewErrorsBlock = (both, first) => {
      if (both) {
        return [table([
          row([headerCell(REVIEW_H, half, { size: 18 }), headerCell(ERRORS_H, usable - half, { size: 18 })], { header: true }),
          row([cell(reviewContent(half), half), cell(errorsContent(), usable - half)], { minHeight: Math.round(5 * CM), cantSplit: false }),
        ], [half, usable - half]), P('', { after: 200 })];
      }
      const title = first === 'review' ? REVIEW_H : ERRORS_H;
      const content = first === 'review' ? reviewContent(usable) : errorsContent();
      return [table([row([headerCell(title, usable, { size: 18 })], { header: true }), row([cell(content, usable)], { cantSplit: false })], [usable]), P('', { after: 200 })];
    };
    const S = { font: SANS, size: 16 };
    const selfevalContent = () => [
      P([R('La seduta di allenamento', { font: SANS, size: 22, bold: true })], { indent: { left: 600 }, after: 0 }),
      P([R('x me', { font: SANS, size: 22, bold: true }), R('        ( meglio se altro mi vede)', { font: SANS, size: 16, bold: true })], { after: 0 }),
      P([R("L'osservazione", { font: SANS, size: 16, bold: true })], { after: 120 }),
      ...OBSERVATION_LEVELS.map((l) => P([check(rv.observationLevel === l.value, 18), R(`  ${l.value}  `, { ...S, bold: true }), R(l.label, S)], { after: 30 })),
      P([R('4  ', { ...S, bold: true }), R(ERRORS_CORRECTED_LABEL + '   ', S), R('Sì ', S), check(rv.errorsCorrectedWell === 'yes', 18), R('  No ', S), check(rv.errorsCorrectedWell === 'no', 18)], { after: 80 }),
      P([R('Osservatore: ', { ...S, bold: true }), R(blank(rv.observer, 20), S)]),
    ];
    const trainerContent = () => [
      P([R('Con preparatore atletico', { size: 20, bold: true })], { align: AlignmentType.CENTER, after: 160 }),
      P([R('rapporto tempo di lavoro   ', S), ...WORK_TIME_OPTIONS.flatMap((o) => [check(rv.workTimeRatio === o.value, 20), R(' ' + o.short + '   ', S)])], { after: 80 }),
      P([R('N° di sollecitazioni ', S), R(rv.solicitationsCount != null && rv.solicitationsCount !== '' ? `(${rv.solicitationsCount})   ` : '   ', { ...S, bold: true }),
        ...SOLICITATION_OPTIONS.flatMap((o) => [check(rv.solicitations === o.value, 20), R(' ' + o.short + '   ', S)])], { after: 80 }),
      P([R('Preparatore atletico: ', { ...S, bold: true }), R(blank(rv.trainer, 20), S)]),
    ];
    // autovalutazione + preparatore affiancati come nell'originale, se consecutivi
    const sideBySide = (l, r) => [table([row([cell(l, half, { borders: noBorders }), cell(r, usable - half, { borders: noBorders })])], [half, usable - half], { borders: noBorders }), P('', { after: 160 })];

    let started = false;
    const breakIfNeeded = () => { if (started) children.push(P('', { pageBreakBefore: true, after: 0 })); };
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i], next = mods[i + 1];
      if (m === 'attendance' && attInHead && i === 0) continue;
      if (m === 'program') children.push(...programBlock());
      else if (m === 'attendance') children.push(...attendanceBlock());
      else if (m === 'observation') { breakIfNeeded(); children.push(...observationBlock()); }
      else if (m === 'review' || m === 'errors') {
        breakIfNeeded();
        const pair = (m === 'review' && next === 'errors') || (m === 'errors' && next === 'review');
        if (pair && m === 'errors') {
          // ordine scelto: errori prima del bilancio
          children.push(table([
            row([headerCell(ERRORS_H, half, { size: 18 }), headerCell(REVIEW_H, usable - half, { size: 18 })], { header: true }),
            row([cell(errorsContent(), half), cell(reviewContent(usable - half), usable - half)], { minHeight: Math.round(5 * CM), cantSplit: false }),
          ], [half, usable - half]), P('', { after: 200 }));
        } else children.push(...reviewErrorsBlock(pair, m));
        if (pair) i++;
      } else if (m === 'selfeval' || m === 'trainer') {
        const pair = (m === 'selfeval' && next === 'trainer') || (m === 'trainer' && next === 'selfeval');
        const a = m === 'selfeval' ? selfevalContent() : trainerContent();
        if (pair) { children.push(...sideBySide(a, next === 'trainer' ? trainerContent() : selfevalContent())); i++; } else children.push(...sideBySide(a, [P('')]));
      }
      started = true;
    }
    return doc('Allenamento ' + (s.date || ''), [section(children, { landscape: true, margins })]);
  }

  // ---------------- 1.3 Scheda della partita ----------------
  function match(m) {
    const margins = { top: 227, bottom: 227, left: 227, right: 227 };
    const usable = A4_H - 454;
    const H = { font: SANS, size: 22, bold: true, italics: true };
    const head = [R('PARTITA DEL', H), R(' ' + (formatDateIT(m.date) || '_________________') + ' ', { ...H, underline: !!m.date }),
      R(' CONTRO', H), R(' ' + blank(m.opponent, 26) + ' ', { ...H, underline: !!m.opponent }),
      R('UNDER', H), R(' ' + (m.under ? normalizeUnder(m.under).replace(/^U/, '') : '___'), { ...H, underline: !!m.under })];
    const children = [P(head, { align: AlignmentType.CENTER, before: 120, after: m.result || m.location || m.tournament ? 40 : 200 })];
    const extra = [];
    if (m.tournament) extra.push('Torneo/concentramento: ' + m.tournament);
    if (m.location) extra.push('Luogo: ' + m.location);
    if (m.result) extra.push('Risultato: ' + m.result);
    if (extra.length) children.push(P(extra.join('    ·    '), { align: AlignmentType.CENTER, size: 18, italics: true, after: 160 }));

    const labels = matchColumnLabels(m);
    const labW = Math.round(3.4 * CM);
    const colW = Math.floor((Math.min(usable, Math.round(27.6 * CM)) - labW) / 8);
    const widths = [labW, ...Array(8).fill(colW)];
    const total = widths.reduce((a, b) => a + b, 0);
    const big = { size: 26, bold: true, align: AlignmentType.CENTER, after: 0 };
    const rows = [row([headerCell('', labW), ...labels.map((l) => headerCell(l.replace(/^(\S+) /, '$1\n'), colW))], { header: true })];
    for (const r of m.rows || []) {
      rows.push(row([cell([P(r.label || '', { size: 18, bold: true })], labW, { vAlign: VerticalAlign.CENTER }),
        ...r.values.map((v) => cell([P(String(toInt(v)), big)], colW, { vAlign: VerticalAlign.CENTER }))], { minHeight: Math.round(1.7 * CM) }));
    }
    const tot = matchColumnTotals(m);
    rows.push(row([cell([P('TOTALE', { size: 16, bold: true })], labW, { vAlign: VerticalAlign.CENTER }),
      ...tot.map((v) => cell([P(String(v), { ...big, size: 22 })], colW, { vAlign: VerticalAlign.CENTER }))], { minHeight: Math.round(0.9 * CM) }));
    rows.push(row([cell(m.notes ? [P(m.notes, { size: 18 })] : [P('')], total, { span: 9 })], { minHeight: Math.round(4 * 0.85 * CM) }));
    rows.push(row([cell([P([R('NUM. GIOCATORI   ', { bold: true, size: 16 }), R(m.numPlayers != null && m.numPlayers !== '' ? String(m.numPlayers) : '', { bold: true, size: 22 })], { align: AlignmentType.RIGHT, after: 0 })], total, { span: 9 })]));
    children.push(table(rows, widths));
    const img = image(m.drawing, 16, 9);
    if (img) {
      children.push(P('Schema / situazione di gioco', { bold: true, pageBreakBefore: true, after: 100 }));
      children.push(img);
    }
    return doc('Scheda della partita ' + (m.date || ''), [section(children, { landscape: true, margins })]);
  }

  // ---------------- 1.4 Obiettivi / piano trimestrale ----------------
  function plan(p) {
    const margins = { top: 2 * CM, bottom: 2 * CM, left: 2 * CM, right: 2 * CM };
    const C = AlignmentType.CENTER;
    const S = 24;
    const children = [
      P(p.title || 'TRIMESTRE', { bold: true, align: C, size: S, before: 600, after: 240 }),
    ];
    const meta = [];
    if (p.category) meta.push('Categoria: ' + p.category);
    if (p.season) meta.push('Stagione: ' + p.season);
    if (meta.length) children.push(P(meta.join('   ·   '), { align: C, italics: true, size: 20, after: 240 }));
    children.push(P('OBIETTIVI EDUCATIVI:', { italics: true, underline: true, size: S, after: 160 }));
    children.push(P(p.educationalGoals || '', { bold: true, size: S, after: 240 }));
    children.push(P('OBIETTIVI DIDATTICI:', { italics: true, underline: true, size: S, after: 160 }));
    children.push(P(p.didacticGoals || '', { bold: true, size: S, after: 480 }));
    children.push(P('ALLENAMENTI', { bold: true, align: C, size: S, after: 360, keepNext: true }));
    (p.sessions || []).forEach((ps, i) => {
      children.push(P(ordinalRoman(i + 1), { bold: true, align: C, size: S, before: 240, after: 200, keepNext: true }));
      for (const b of ps.blocks || []) {
        const dur = toInt(b.durationMin) ? ` (${toInt(b.durationMin)} min)` : '';
        const title = b.title || BLOCK_TYPES[b.type]?.defaultTitle || '';
        if (b.type === 'RISCALDAMENTO') {
          children.push(P((title || 'Riscaldamento') + ':' + dur, { size: S, after: 0, keepNext: true }));
          for (const sub of (b.subItems || []).filter((x) => x && x.trim())) {
            children.push(P([R('-    ', { size: S }), R(sub, { size: S, italics: true })], { indent: { left: 720, hanging: 360 }, after: 0 }));
          }
        } else if (b.type === 'PAUSA') {
          children.push(P('PAUSA', { size: S, after: 0 }));
        } else {
          children.push(P(title + dur, { size: S, after: 0 }));
        }
      }
      if (ps.notes) children.push(P(ps.notes, { size: 20, italics: true, before: 80 }));
    });
    return doc(p.title || 'Piano trimestrale', [section(children, { landscape: false, margins })]);
  }

  // ---------------- Libreria esercizi (con i disegni della Tactic Board) ----------------
  function library(lib) {
    const margins = { top: 2 * CM, bottom: 2 * CM, left: 2 * CM, right: 2 * CM };
    const C = AlignmentType.CENTER;
    const children = [P('LIBRERIA ESERCIZI', { bold: true, align: C, size: 28, before: 200, after: 120 }),
      P(`${(lib.exercises || []).length} esercizi`, { align: C, italics: true, size: 18, after: 240 })];
    const exs = [...(lib.exercises || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
    exs.forEach((e, i) => {
      const meta = [(e.categories || []).join(' '), toInt(e.durationMin) ? toInt(e.durationMin) + ' min' : '', e.space ? 'Spazio: ' + e.space : ''].filter(Boolean).join('   ·   ');
      children.push(P(e.name || '(senza nome)', { bold: true, size: 26, before: i ? 360 : 0, after: 60, keepNext: true }));
      if (meta) children.push(P(meta, { italics: true, size: 18, after: 80, keepNext: true }));
      const img = image(e.drawing, 15, 9);
      if (img) children.push(img);
      const line = (label, text) => { if (text && String(text).trim()) children.push(P([R(label + ': ', { bold: true }), ...runs(text)], { after: 60 })); };
      line('Descrizione', e.description);
      line('Obiettivi', e.objectives);
      line('Parole chiave', (e.keywords || []).join(', '));
      line('Materiale', e.materials);
    });
    return doc('Libreria esercizi', [section(children, { landscape: false, margins })]);
  }

  return { session, match, plan, library };
}

// Elenco dei documenti da produrre per un record (chiave stabile -> per aggiornare lo stesso file su Drive)
export function docVariants(rec, hasObservation) {
  // seduta: un solo documento con i moduli presenti (chiave 'plan' come prima, così si aggiorna lo stesso file su Drive)
  if (rec.kind === 'session') return ['plan'];
  if (rec.kind === 'match') return ['match'];
  if (rec.kind === 'plan') return ['termplan'];
  if (rec.kind === 'library') return (rec.exercises || []).length ? ['library'] : [];
  return [];
}

export function buildDocument(builder, rec, variant) {
  switch (variant) {
    case 'plan': return builder.session(rec);
    case 'match': return builder.match(rec);
    case 'termplan': return builder.plan(rec);
    case 'library': return builder.library(rec);
    default: throw new Error('Variante documento sconosciuta: ' + variant);
  }
}
