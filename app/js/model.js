// Modello dati dell'app (logica pura, senza DOM: testabile con Node).
// Struttura fedele alle 4 schede originali (vedi analysis/REQUISITI.md sez. 1).

export const APP_ID = 'rugby-coach';
export const SCHEMA_VERSION = 3;

export const CATEGORIES = ['U6', 'U8', 'U10', 'U12', 'U14', 'U16'];

// Testi fissi come dati configurabili (R9)
export const ERRORS_QUESTIONS = [
  'Consegne iniziali poco chiare?',
  'Livello di attenzione adeguato?',
  'Livello di preparazione adeguato?',
  'Livello tecnico adeguato?',
  'Correzione degli errori giusta?',
  'Uso appropriato delle parole chiave?',
  'Ho fatto domande?',
];

export const OBSERVATION_LEVELS = [
  { value: 1, label: 'centrato sul pallone' },
  { value: 2, label: 'centrato sul pallone + sostegno vicino' },
  { value: 3, label: 'centrato sul pallone e sullo spazio' },
];
export const ERRORS_CORRECTED_LABEL = 'Errori corretti adeguatamente come tempo e tecnica?';

export const WORK_TIME_OPTIONS = [
  { value: 'suff', label: 'Sufficiente', short: 'suff.' },
  { value: 'insuff', label: 'Insufficiente', short: 'Insuff.' },
];
export const SOLICITATION_OPTIONS = [
  { value: 'adeguato', label: 'Adeguato', short: 'Adeguato' },
  { value: 'inadeguato', label: 'Inadeguato', short: 'inad.' },
];

export const MATCH_COLUMNS = [
  'PLACCAGGI ALLE GAMBE',
  'PLACCAGGI AL BUSTO',
  'PASSAGGI LUNGHI',
  'PASSAGGI VICINO',
  'RICERCA DELLO SPAZIO',
  'SALITA UNITA',
  'SOSTEGNO',
];
export const MATCH_COLUMN_COUNT = 8; // 7 fisse + 1 con etichetta personalizzabile

export const BLOCK_TYPES = {
  CHIACCHIERATA_INIZIALE: { label: 'Chiacchierata iniziale', defaultTitle: 'Chiacchierata sulle regole imparate la volta precedente' },
  RISCALDAMENTO: { label: 'Riscaldamento', defaultTitle: 'Riscaldamento' },
  PAUSA: { label: 'Pausa', defaultTitle: 'PAUSA' },
  GIOCO: { label: 'Gioco / esercizio', defaultTitle: '' },
  SPIEGAZIONE: { label: 'Spiegazione', defaultTitle: 'Spiegazione delle regole del gioco' },
  PARTITA: { label: 'Partita', defaultTitle: 'Partita' },
  CHIACCHIERATA_FINALE: { label: 'Chiacchierata finale', defaultTitle: 'Chiacchierata su cosa hanno imparato' },
};

// Liste dinamiche: si parte vuoti (o con il minimo) e si aggiunge con "+" (feedback utente, v1.4).
// Le righe fisse degli originali (4, 5, 6) restano solo come riferimento storico.
export const DEFAULT_ROWS = { observations: 0, planItems: 0, matchRows: 1 };

// Seduta modulare (v1.4): il coach compone la seduta con le sole sezioni che gli servono.
export const SESSION_MODULES = {
  program: { label: 'Programma', desc: 'Esercizi con durata, materiale, obiettivi, parole chiave, cosa osservo.' },
  attendance: { label: 'Presenze', desc: 'Quanti bambini per categoria (U6…U16), con il totale.' },
  observation: { label: 'Osservazione esercizi', desc: 'Per ogni esercizio: obiettivo, cosa va bene, cosa no, miglioramenti.' },
  review: { label: 'Bilancio della seduta', desc: 'Da solo, prima del saluto finale: com\'è andato ogni esercizio e i singoli bambini.' },
  errors: { label: 'Errori e cause', desc: 'Le 7 domande da fare insieme agli atleti, con Sì/No.' },
  selfeval: { label: 'Autovalutazione dell\'osservazione', desc: 'Il tuo livello di osservazione (meglio se qualcuno ti guarda).' },
  trainer: { label: 'Preparatore atletico', desc: 'Tempo di lavoro e numero di sollecitazioni.' },
};
export const MODULE_ORDER = Object.keys(SESSION_MODULES);
export const DEFAULT_MODULES = ['program'];

export const KINDS = ['session', 'match', 'plan', 'exercise', 'player'];
export const STORE_OF_KIND = { session: 'sessions', match: 'matches', plan: 'plans', exercise: 'exercises', player: 'players' };
export const SYNCABLE_KINDS = ['session', 'match', 'plan'];
// Libreria esercizi e rosa vanno su Drive come raccolte (un .json di backup + un .docx per la libreria)
export const COLLECTION_OF_KIND = { exercise: 'library', player: 'roster' };
export const SEED_TIME = '2000-01-01T00:00:00.000Z'; // gli esempi sono "più vecchi" di qualunque modifica reale

export function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function todayISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowISO() { return new Date().toISOString(); }

export function formatDateIT(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(n) {
  let out = '';
  let v = Math.max(0, Math.floor(n));
  if (v >= 40) return String(n);
  for (const [k, s] of ROMAN) while (v >= k) { out += s; v -= k; }
  return out;
}
export function ordinalRoman(n) { return toRoman(n) + '°'; }

export function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

// ---------- Factories ----------

function base(kind, extra = {}) {
  const t = nowISO();
  return { id: uid(), kind, schemaVersion: SCHEMA_VERSION, example: false, createdAt: t, updatedAt: t, ...extra };
}

export function emptyAttendance() {
  return Object.fromEntries(CATEGORIES.map((c) => [c, null]));
}

export function newPlanItem(extra = {}) {
  return { id: uid(), exerciseId: null, name: '', durationMin: null, description: '', drawing: null,
    materialsSpace: '', objectives: '', keywords: [], toObserve: '', ...extra };
}

export function newObservation(extra = {}) {
  return { id: uid(), exerciseId: null, planItemRef: null, name: '', description: '', drawing: null,
    objective: '', positive: '', negative: '', improvements: '', ...extra };
}

export function newReviewRow(extra = {}) {
  return { id: uid(), ref: null, label: '', overall: '', individual: '', ...extra };
}

export function newErrorsCauses() {
  return ERRORS_QUESTIONS.map((q, i) => ({ id: 'q' + (i + 1), question: q, answer: null, note: '' }));
}

export function newReview() {
  return {
    perExercise: [],
    errorsCauses: newErrorsCauses(),
    observationLevel: null,
    errorsCorrectedWell: null,
    observer: '',
    workTimeRatio: null,
    solicitations: null,
    solicitationsCount: null,
    trainer: '',
  };
}

export function newSession(extra = {}) {
  const s = base('session', {
    date: todayISO(),
    categories: [],
    location: '',
    modules: [...DEFAULT_MODULES],
    attendance: emptyAttendance(),
    planItems: [],
    observations: [],
    review: newReview(),
    termPlanRef: null,
    ...extra,
  });
  syncReviewRows(s);
  return s;
}

export function newMatchRow(extra = {}) {
  return { id: uid(), label: '', values: Array(MATCH_COLUMN_COUNT).fill(0), ...extra };
}

export function newMatch(extra = {}) {
  return base('match', {
    date: todayISO(),
    opponent: '',
    under: '',
    customColumnLabel: '',
    rows: [newMatchRow()],
    notes: '',
    numPlayers: null,
    result: '',
    location: '',
    tournament: '',
    drawing: null,
    ...extra,
  });
}

export function newBlock(type = 'GIOCO', extra = {}) {
  const def = BLOCK_TYPES[type] || BLOCK_TYPES.GIOCO;
  return { id: uid(), type, title: def.defaultTitle, subItems: [], exerciseId: null, durationMin: null, ...extra };
}

export function newPlanSession(extra = {}) {
  return { id: uid(), blocks: [], notes: '', ...extra };
}

export function templatePlanSession() {
  return newPlanSession({
    blocks: [
      newBlock('CHIACCHIERATA_INIZIALE'),
      newBlock('RISCALDAMENTO', { subItems: [] }),
      newBlock('PAUSA'), newBlock('GIOCO'),
      newBlock('PAUSA'), newBlock('GIOCO'),
      newBlock('PAUSA'), newBlock('PARTITA'),
      newBlock('CHIACCHIERATA_FINALE'),
    ],
  });
}

export function newPlan(extra = {}) {
  return base('plan', {
    title: 'I° TRIMESTRE',
    term: 1,
    season: defaultSeason(),
    category: '',
    educationalGoals: '',
    didacticGoals: '',
    sessions: [],
    ...extra,
  });
}

export function newExercise(extra = {}) {
  return base('exercise', {
    name: '', description: '', objectives: '', keywords: [], materials: '', space: '',
    durationMin: null, categories: [], drawing: null, ...extra,
  });
}

export function newPlayer(extra = {}) {
  return base('player', { category: 'U8', name: '', number: '', ...extra });
}

export function defaultSeason(d = new Date()) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 7 ? y : y - 1; // la stagione parte ad agosto/settembre
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

export const FACTORIES = { session: newSession, match: newMatch, plan: newPlan, exercise: newExercise, player: newPlayer };

// ---------- Campi calcolati (R8) ----------

export function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function totalAttendance(session) {
  const a = session.attendance || {};
  return CATEGORIES.reduce((s, c) => s + toInt(a[c]), 0);
}

export function totalDuration(session) {
  return (session.planItems || []).reduce((s, it) => s + toInt(it.durationMin), 0);
}

export function matchColumnTotals(match) {
  const tot = Array(MATCH_COLUMN_COUNT).fill(0);
  for (const r of match.rows || []) for (let i = 0; i < MATCH_COLUMN_COUNT; i++) tot[i] += toInt(r.values?.[i]);
  return tot;
}

export function matchColumnLabels(match) {
  return [...MATCH_COLUMNS, match.customColumnLabel || ''];
}

// Categorie della seduta: quelle scelte, altrimenti quelle con presenti > 0
export function sessionCategories(session) {
  if (session.categories && session.categories.length) return sortCategories(session.categories);
  const a = session.attendance || {};
  return CATEGORIES.filter((c) => toInt(a[c]) > 0);
}

export function sortCategories(list) {
  const known = CATEGORIES.filter((c) => list.includes(c));
  const other = list.filter((c) => !CATEGORIES.includes(c));
  return [...known, ...other];
}

// "Le mie categorie" (Impostazioni): quelle che l'allenatore allena. Nessuna scelta valida = tutte.
export function sanitizeMyCategories(list) {
  const mine = CATEGORIES.filter((c) => Array.isArray(list) && list.includes(c));
  return mine.length ? mine : [...CATEGORIES];
}
// Categorie da offrire in una scelta: le mie, più quelle già usate dalla scheda (non spariscono mai)
export function visibleCategories(mine, keep = []) {
  const k = [].concat(keep || []).filter(Boolean);
  return CATEGORIES.filter((c) => mine.includes(c) || k.includes(c));
}
// Un elemento resta negli elenchi se non ha categorie o se ne ha almeno una delle mie
export function inMyCategories(cats, mine) {
  const list = (cats || []).filter(Boolean);
  return !list.length || list.some((c) => mine.includes(c) || !CATEGORIES.includes(c));
}

// Righe del bilancio generate dagli esercizi del programma (R8, 1.2-C1).
// Una riga per esercizio (ref = id esercizio, in ordine), poi le righe libere (ref = null).
export function syncReviewRows(session) {
  const review = session.review || (session.review = newReview());
  const rows = review.perExercise || [];
  const byRef = new Map(rows.filter((r) => r.ref).map((r) => [r.ref, r]));
  const out = [];
  for (const it of session.planItems || []) {
    out.push(byRef.get(it.id) || newReviewRow({ ref: it.id }));
  }
  for (const r of rows) if (!r.ref) out.push(r);
  review.perExercise = out;
  return session;
}

// Numero e nome dell'esercizio a cui si riferisce una riga del bilancio
export function reviewRowLabel(session, row) {
  if (!row.ref) return { num: '', name: row.label || '' };
  const idx = (session.planItems || []).findIndex((p) => p.id === row.ref);
  if (idx < 0) return { num: '', name: row.label || '' };
  return { num: String(idx + 1), name: session.planItems[idx].name || '' };
}

// ---------- Liste dinamiche (R4) ----------

export function moveItem(arr, index, delta) {
  const j = index + delta;
  if (index < 0 || index >= arr.length || j < 0 || j >= arr.length) return false;
  const [x] = arr.splice(index, 1);
  arr.splice(j, 0, x);
  return true;
}

export function removeItem(arr, index) {
  if (index < 0 || index >= arr.length) return null;
  return arr.splice(index, 1)[0];
}

export function isBlankValue(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return v === 0;
  if (Array.isArray(v)) return v.every(isBlankValue);
  if (typeof v === 'object') return Object.entries(v).every(([k, x]) => k === 'id' || k === 'ref' || isBlankValue(x));
  return false;
}

// ---------- Precompilazione da libreria / piano (R3, R5) ----------

export function joinNonEmpty(parts, sep = '\n') { return parts.filter((p) => p && String(p).trim()).join(sep); }

export function planItemFromExercise(ex) {
  return {
    exerciseId: ex.id,
    name: ex.name || '',
    durationMin: ex.durationMin ?? null,
    description: ex.description || '',
    drawing: deepClone(ex.drawing),
    materialsSpace: joinNonEmpty([ex.materials, ex.space ? 'Spazio: ' + ex.space : '']),
    objectives: ex.objectives || '',
    keywords: [...(ex.keywords || [])],
  };
}

export function observationFromExercise(ex) {
  return {
    exerciseId: ex.id, name: ex.name || '', description: ex.description || '',
    drawing: deepClone(ex.drawing), objective: ex.objectives || '',
  };
}

export function observationFromPlanItem(it) {
  return {
    exerciseId: it.exerciseId || null, planItemRef: it.id, name: it.name || '',
    description: it.description || '', drawing: deepClone(it.drawing), objective: it.objectives || '',
  };
}

export function exerciseFromRow(row, extra = {}) {
  return newExercise({
    name: row.name || '',
    description: row.description || '',
    objectives: row.objectives ?? row.objective ?? '',
    keywords: [...(row.keywords || [])],
    materials: row.materialsSpace || '',
    durationMin: row.durationMin ?? null,
    drawing: deepClone(row.drawing),
    ...extra,
  });
}

export function normName(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export function findExerciseByName(exercises, name) {
  const n = normName(name);
  if (!n) return null;
  return exercises.find((e) => normName(e.name) === n) || null;
}

// Da una seduta del piano trimestrale crea un Foglio allenamento precompilato (R3)
export function sessionFromPlanSession(plan, sessionIndex, exercises = [], extra = {}) {
  const ps = plan.sessions[sessionIndex];
  if (!ps) throw new Error('Seduta del piano inesistente');
  const items = [];
  for (const b of ps.blocks) {
    if (b.type === 'RISCALDAMENTO') {
      const subs = (b.subItems || []).filter((x) => x && x.trim());
      items.push(newPlanItem({ name: b.title || 'Riscaldamento', durationMin: b.durationMin ?? null,
        description: subs.map((x) => '- ' + x).join('\n') }));
    } else if (b.type === 'GIOCO') {
      const ex = (b.exerciseId && exercises.find((e) => e.id === b.exerciseId)) || findExerciseByName(exercises, b.title);
      const fromEx = ex ? planItemFromExercise(ex) : {};
      items.push(newPlanItem({ ...fromEx, name: b.title || fromEx.name || '', durationMin: b.durationMin ?? fromEx.durationMin ?? null }));
    } else if (b.type === 'PARTITA') {
      items.push(newPlanItem({ name: b.title || 'Partita', durationMin: b.durationMin ?? null }));
    }
  }
  const cats = plan.category ? [plan.category] : [];
  const s = newSession({ categories: cats, planItems: items,
    termPlanRef: { termPlanId: plan.id, sessionIndex }, ...extra });
  if (s.modules.includes('observation')) s.observations = s.planItems.filter((p) => p.name).map((p) => newObservation(observationFromPlanItem(p)));
  syncReviewRows(s);
  return s;
}

// Duplica un record con nuovi id (R2)
export function duplicateRecord(rec) {
  const c = deepClone(rec);
  const t = nowISO();
  c.id = uid();
  c.createdAt = t; c.updatedAt = t; c.example = false;
  if (c.kind === 'session') {
    const map = new Map();
    for (const p of c.planItems || []) { const n = uid(); map.set(p.id, n); p.id = n; }
    for (const o of c.observations || []) { o.id = uid(); if (o.planItemRef) o.planItemRef = map.get(o.planItemRef) || null; }
    for (const r of c.review?.perExercise || []) { r.id = uid(); if (r.ref) r.ref = map.get(r.ref) || null; }
  }
  if (c.kind === 'match') for (const r of c.rows || []) r.id = uid();
  if (c.kind === 'plan') for (const s of c.sessions || []) { s.id = uid(); for (const b of s.blocks || []) b.id = uid(); }
  if (c.title && c.kind === 'plan') c.title = c.title + ' (copia)';
  if (c.name && c.kind === 'exercise') c.name = c.name + ' (copia)';
  return c;
}

// ---------- Nomi file Drive (default: "2026-11-24 Allenamento U8.docx") ----------

export function sanitizeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|\n\r\t]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function recordTitle(rec) {
  const t = recordTitleRaw(rec);
  return rec && rec.conflict && rec.kind !== 'plan' ? t + ' (' + rec.conflict + ')' : t;
}
function recordTitleRaw(rec) {
  switch (rec.kind) {
    case 'session': {
      const cats = sessionCategories(rec).join('-');
      return joinNonEmpty(['Allenamento', cats], ' ');
    }
    case 'match': return joinNonEmpty(['Partita', rec.under ? normalizeUnder(rec.under) : '', rec.opponent ? 'vs ' + rec.opponent : ''], ' ');
    case 'plan': return joinNonEmpty([rec.title || 'Piano trimestrale', rec.category], ' ');
    case 'exercise': return rec.name || 'Esercizio';
    case 'player': return rec.name || 'Giocatore';
    case 'library': return 'Libreria esercizi';
    case 'roster': return 'Rosa giocatori';
    case 'deleted': return 'Eliminati';
    default: return 'Scheda';
  }
}

export function normalizeUnder(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return 'U' + s;
  return s.toUpperCase().replace(/^UNDER\s*/, 'U');
}

// Copia di conflitto: stesso contenuto, nome distinto ("… (conflitto del 25/11/2026 10:32)")
export function fileBaseName(rec, variant = 'main') {
  const base = fileBaseNameRaw(rec, variant);
  return rec && rec.conflict ? sanitizeFileName(base + ' (' + rec.conflict + ')') : base;
}
function fileBaseNameRaw(rec, variant = 'main') {
  if (rec.kind === 'session') {
    const cats = sessionCategories(rec).join('-');
    const label = variant === 'observation' ? 'Scheda di allenamento' : 'Allenamento';
    return sanitizeFileName(joinNonEmpty([rec.date, label, cats], ' '));
  }
  if (rec.kind === 'match') return sanitizeFileName(joinNonEmpty([rec.date, recordTitle(rec)], ' '));
  if (rec.kind === 'plan') {
    const season = rec.season ? String(rec.season).replace('/', '-') : '';
    return sanitizeFileName(joinNonEmpty(['Piano', rec.title || 'trimestrale', rec.category, season], ' '));
  }
  if (rec.kind === 'library' || rec.kind === 'roster' || rec.kind === 'deleted') return 'Rugby Coach - ' + recordTitle(rec);
  return sanitizeFileName(recordTitle(rec));
}

// ---------- moduli della seduta ----------
const OBS_FIELDS = ['name', 'description', 'objective', 'positive', 'negative', 'improvements'];
export const isBlankObservation = (o) => !o.drawing && OBS_FIELDS.every((f) => isBlankValue(o[f]));
export const isBlankPlanItem = (p) => !p.drawing && ['name', 'description', 'materialsSpace', 'objectives', 'toObserve'].every((f) => isBlankValue(p[f]))
  && !toInt(p.durationMin) && !(p.keywords || []).length;
export const isBlankReviewRow = (r) => ['label', 'overall', 'individual'].every((f) => isBlankValue(r[f]));

// Il modulo contiene dati inseriti dall'utente?
export function moduleHasData(session, mod) {
  const rv = session.review || {};
  switch (mod) {
    case 'program': return (session.planItems || []).some((p) => !isBlankPlanItem(p));
    case 'attendance': return totalAttendance(session) > 0 || Object.values(session.attendance || {}).some((v) => v === 0);
    case 'observation': return (session.observations || []).some((o) => !isBlankObservation(o));
    case 'review': return (rv.perExercise || []).some((r) => !isBlankReviewRow(r));
    case 'errors': return (rv.errorsCauses || []).some((q) => q.answer || (q.note && q.note.trim()));
    case 'selfeval': return !!(rv.observationLevel || rv.errorsCorrectedWell || (rv.observer && rv.observer.trim()));
    case 'trainer': return !!(rv.workTimeRatio || rv.solicitations || toInt(rv.solicitationsCount) || (rv.trainer && rv.trainer.trim()));
    default: return false;
  }
}

// Seduta senza nulla inserito dall'utente? La data proposta, l'elenco delle sezioni e il gruppo non contano.
export function isEmptySession(session) {
  if (!session) return true;
  if ((session.categories || []).length || !isBlankValue(session.location) || session.termPlanRef) return false;
  return !MODULE_ORDER.some((m) => moduleHasData(session, m));
}

// Svuota i dati di un modulo (quando l'utente lo rimuove)
export function clearModule(session, mod) {
  const rv = session.review || (session.review = newReview());
  switch (mod) {
    case 'attendance': session.attendance = emptyAttendance(); break;
    case 'observation': session.observations = []; break;
    case 'review': rv.perExercise = []; syncReviewRows(session); break;
    case 'errors': rv.errorsCauses = newErrorsCauses(); break;
    case 'selfeval': rv.observationLevel = null; rv.errorsCorrectedWell = null; rv.observer = ''; break;
    case 'trainer': rv.workTimeRatio = null; rv.solicitations = null; rv.solicitationsCount = null; rv.trainer = ''; break;
    default: break;
  }
  return session;
}

export function sanitizeModules(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) if (SESSION_MODULES[m] && !out.includes(m)) out.push(m);
  return out.length ? out : [...DEFAULT_MODULES];
}

export function observationHasContent(session) {
  const fields = ['name', 'description', 'objective', 'positive', 'negative', 'improvements'];
  return (session.observations || []).some((o) => o.drawing || fields.some((f) => !isBlankValue(o[f])))
    || totalAttendance(session) > 0;
}

// ---------- Migrazioni e normalizzazione ----------

// Migrazioni per schemaVersion: ognuna porta un record da v a v+1.
export const MIGRATIONS = {
  // v1 -> v2: presenze con le chiavi dell'originale ("N12", "N14", "N16", "N.U8"...) -> "U12"...
  //           righe partita con 7 valori -> 8 (colonna personalizzabile); keywords stringa -> array
  1: (rec) => {
    if (rec.kind === 'session') {
      const a = rec.attendance || {};
      const out = emptyAttendance();
      for (const [k, v] of Object.entries(a)) {
        const m = String(k).toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^N?U?(\d+)$/);
        if (m && out.hasOwnProperty('U' + m[1])) out['U' + m[1]] = v;
      }
      rec.attendance = out;
      for (const p of rec.planItems || []) {
        if (typeof p.keywords === 'string') p.keywords = splitTags(p.keywords);
      }
    }
    if (rec.kind === 'exercise' && typeof rec.keywords === 'string') rec.keywords = splitTags(rec.keywords);
    if (rec.kind === 'match') {
      for (const r of rec.rows || []) {
        const v = Array.isArray(r.values) ? r.values.slice(0, MATCH_COLUMN_COUNT) : [];
        while (v.length < MATCH_COLUMN_COUNT) v.push(0);
        r.values = v;
      }
    }
    return rec;
  },
  // v2 -> v3: seduta modulare. I moduli sono Programma + quelli che contengono dati, nell'ordine standard.
  //           Le righe completamente vuote (dei vecchi numeri fissi) vengono tolte; nessun dato perso.
  2: (rec) => {
    if (rec.kind === 'session') {
      rec.planItems = (rec.planItems || []).filter((p) => !isBlankPlanItem(fillPlanItemDefaults(p)));
      const kept = new Set(rec.planItems.map((p) => p.id));
      rec.observations = (rec.observations || []).filter((o) => !isBlankObservation({ ...newObservation(), ...o }));
      if (rec.review && Array.isArray(rec.review.perExercise)) {
        rec.review.perExercise = rec.review.perExercise.filter((r) => (r.ref ? kept.has(r.ref) || !isBlankReviewRow({ label: '', overall: '', individual: '', ...r }) : !isBlankReviewRow({ label: '', overall: '', individual: '', ...r })));
      }
      const probe = { ...rec, review: { ...newReview(), ...(rec.review || {}) }, attendance: { ...emptyAttendance(), ...(rec.attendance || {}) } };
      rec.modules = MODULE_ORDER.filter((m) => m === 'program' || moduleHasData(probe, m));
    }
    if (rec.kind === 'match') {
      const rows = (rec.rows || []).filter((r) => (r.label && r.label.trim()) || (r.values || []).some((v) => toInt(v)));
      rec.rows = rows.length ? rows : (rec.rows || []).slice(0, 1);
    }
    return rec;
  },
};
const fillPlanItemDefaults = (p) => ({ ...newPlanItem(), ...p });

export function splitTags(s) {
  return String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

export function migrateRecord(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('Record non valido');
  if (!KINDS.includes(rec.kind)) throw new Error('Tipo di record sconosciuto: ' + rec.kind);
  let v = Number(rec.schemaVersion) || 1;
  if (v > SCHEMA_VERSION) throw new Error(`Dati creati da una versione più recente dell'app (schema ${v})`);
  let r = deepClone(rec);
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (m) r = m(r) || r;
    v++;
  }
  r.schemaVersion = SCHEMA_VERSION;
  // data di modifica mancante o non valida = la più vecchia possibile (mai "adesso"): nei merge e negli import
  // un elemento senza data non deve prevalere su una modifica reale
  const validTs = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const hadUpdated = validTs(r.updatedAt) ? r.updatedAt : null;
  const hadCreated = validTs(r.createdAt) ? r.createdAt : null;
  const out = normalizeRecord(r);
  out.updatedAt = hadUpdated || EPOCH;
  out.createdAt = hadCreated || out.updatedAt;
  return out;
}

export const EPOCH = '1970-01-01T00:00:00.000Z';

// Completa i campi mancanti con i valori predefiniti (robustezza verso dati vecchi/importati)
function fillDefaults(target, defaults) {
  for (const [k, dv] of Object.entries(defaults)) {
    if (!(k in target) || target[k] === undefined) target[k] = deepClone(dv);
    else if (dv && typeof dv === 'object' && !Array.isArray(dv) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      fillDefaults(target[k], dv);
    }
  }
  return target;
}

export function normalizeRecord(rec) {
  const def = FACTORIES[rec.kind]();
  const keepId = rec.id || def.id;
  const { planItems: _p, observations: _o, rows: _r, ...defaults } = def;
  const r = fillDefaults(rec, defaults);
  r.id = keepId;
  if (rec.kind === 'session') {
    r.planItems = (Array.isArray(rec.planItems) ? rec.planItems : def.planItems).map((p) => fillDefaults(p, newPlanItem({ id: p.id || uid() })));
    r.observations = (Array.isArray(rec.observations) ? rec.observations : def.observations).map((o) => fillDefaults(o, newObservation({ id: o.id || uid() })));
    r.review.errorsCauses = ERRORS_QUESTIONS.map((q, i) => {
      const old = (r.review.errorsCauses || []).find((e) => e.id === 'q' + (i + 1)) || (r.review.errorsCauses || [])[i] || {};
      return { id: 'q' + (i + 1), question: q, answer: old.answer === 'yes' || old.answer === 'no' ? old.answer : null, note: old.note || '' };
    });
    r.review.perExercise = (r.review.perExercise || []).map((x) => fillDefaults(x, newReviewRow({ id: x.id || uid() })));
    r.modules = sanitizeModules(rec.modules);
    syncReviewRows(r);
  }
  if (rec.kind === 'match') {
    r.rows = (Array.isArray(rec.rows) ? rec.rows : def.rows).map((x) => {
      const row = fillDefaults(x, newMatchRow({ id: x.id || uid() }));
      row.values = Array.from({ length: MATCH_COLUMN_COUNT }, (_, i) => toInt(row.values[i]));
      return row;
    });
  }
  if (rec.kind === 'plan') {
    r.sessions = (r.sessions || []).map((s) => {
      const ps = fillDefaults(s, newPlanSession({ id: s.id || uid() }));
      ps.blocks = (ps.blocks || []).map((b) => fillDefaults(b, newBlock(b.type in BLOCK_TYPES ? b.type : 'GIOCO', { id: b.id || uid(), title: b.title ?? '' })));
      return ps;
    });
  }
  return r;
}

// ---------- Backup completo (export/import, R24) ----------

export function buildBackup(data) {
  return {
    app: APP_ID,
    type: 'full-backup',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO(),
    data: {
      sessions: data.sessions || [], matches: data.matches || [], plans: data.plans || [],
      exercises: data.exercises || [], players: data.players || [],
    },
  };
}

export function buildRecordBackup(rec) {
  return { app: APP_ID, type: 'record', schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), kind: rec.kind, record: rec };
}

// Restituisce l'elenco dei record (migrati) contenuti in un backup (completo o singolo record)
export function parseBackup(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  if (!obj || obj.app !== APP_ID) throw new Error('Il file non è un backup di Rugby Coach');
  const out = [];
  if (obj.type === 'record') out.push(obj.record);
  else if (obj.data) for (const k of Object.keys(STORE_OF_KIND)) for (const r of obj.data[STORE_OF_KIND[k]] || []) out.push({ kind: k, ...r });
  else throw new Error('Formato di backup non riconosciuto');
  return out.map((r) => migrateRecord(r));
}

// Unione: per ogni id vince l'ultima modifica (updatedAt)
export function mergeDecision(existing, incoming) {
  if (!existing) return 'insert';
  const a = Date.parse(existing.updatedAt || 0) || 0;
  const b = Date.parse(incoming.updatedAt || 0) || 0;
  return b > a ? 'update' : 'skip';
}

// ---------- Merge delle raccolte (libreria esercizi, rosa) tra dispositivi ----------
// Per elemento: id stabile, vince l'updatedAt più recente. Le cancellazioni sono "tombstone" { id: deletedAt }:
// un elemento cancellato resta cancellato a meno che sia stato modificato DOPO la cancellazione.
const ts = (v) => Date.parse(v || 0) || 0;

export function mergeTombstones(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, d] of Object.entries(b || {})) if (!out[id] || ts(d) > ts(out[id])) out[id] = d;
  return out;
}

export function mergeCollection({ local = [], localTombs = {}, remote = [], remoteTombs = {} }) {
  const tombs = mergeTombstones(localTombs, remoteTombs);
  const byId = new Map();
  for (const r of remote) byId.set(r.id, r);
  for (const l of local) {
    const cur = byId.get(l.id);
    if (!cur || ts(l.updatedAt) > ts(cur.updatedAt)) byId.set(l.id, l);
  }
  const items = [];
  for (const [id, item] of byId) {
    if (tombs[id] && ts(tombs[id]) >= ts(item.updatedAt)) continue; // cancellato dopo l'ultima modifica
    if (tombs[id]) delete tombs[id]; // modificato dopo la cancellazione: l'elemento torna
    items.push(item);
  }
  const localMap = new Map(local.map((x) => [x.id, x]));
  const remoteMap = new Map(remote.map((x) => [x.id, x]));
  const kept = new Set(items.map((x) => x.id));
  const upserts = items.filter((x) => !localMap.has(x.id) || ts(localMap.get(x.id).updatedAt) < ts(x.updatedAt));
  const deletes = local.filter((x) => !kept.has(x.id)).map((x) => x.id);
  // il remoto va aggiornato se il risultato differisce da ciò che contiene
  const remoteChanged = items.some((x) => !remoteMap.has(x.id) || ts(remoteMap.get(x.id).updatedAt) < ts(x.updatedAt))
    || remote.some((x) => !kept.has(x.id))
    || Object.keys(tombs).some((id) => !remoteTombs[id] || ts(remoteTombs[id]) < ts(tombs[id]));
  return { items, tombs, upserts, deletes, remoteChanged };
}

// ---------- Eliminazioni delle schede tra dispositivi: vince l'evento più recente ----------
// localTombs/remoteTombs: { id: deletedAt }; localAlive/remoteAlive: { id: updatedAt della modifica che ha superato
// un'eliminazione }; updatedOf(id): updatedAt della scheda locale, o null se qui non c'è.
// Restituisce le tombstone e gli "alive" risultanti, le schede da togliere in locale (eliminazione più recente)
// e quelle da rimandare su Drive (modifica locale più recente: i loro file escono dal cestino).
export function resolveDeletions({ localTombs = {}, remoteTombs = {}, localAlive = {}, remoteAlive = {}, updatedOf = () => null }) {
  const alive = mergeTombstones(localAlive, remoteAlive);
  const tombs = mergeTombstones(localTombs, remoteTombs);
  const remove = [];
  const revive = [];
  for (const [id, at] of Object.entries(tombs)) {
    if (alive[id] && ts(alive[id]) > ts(at)) { delete tombs[id]; continue; } // già superata da una modifica
    const upd = updatedOf(id);
    if (upd == null) continue;
    if (ts(at) >= ts(upd)) { remove.push(id); continue; }
    alive[id] = upd; delete tombs[id]; revive.push(id);
  }
  return { tombs, alive, remove, revive };
}


// ---------- Ricezione automatica da Drive (stesso utente, più dispositivi) ----------
// Decisione per una scheda intera arrivata da Drive. local/remote: { updatedAt }; localChanged: modificata qui dopo
// l'ultima versione comune (ancora da inviare); remoteChanged: su Drive c'è una versione diversa da quella comune
// (Drive "version"); knownBase: la versione comune è nota (altrimenti decide solo la data).
// Esito: 'skip' | 'insert' | 'takeRemote' | 'keepLocal' | 'conflictRemoteWins' | 'conflictLocalWins'
export function decideSheet({ local, remote, localChanged, remoteChanged, knownBase = true, sameContent = false }) {
  if (!remote) return 'skip';
  if (!local) return 'insert';
  if (!remoteChanged) return 'skip';
  const tL = ts(local.updatedAt); const tR = ts(remote.updatedAt);
  if (sameContent) return 'skip';
  if (!localChanged || !knownBase) return tR >= tL ? 'takeRemote' : 'keepLocal';
  // modificata da entrambe le parti dopo l'ultima versione comune: vince la più recente, l'altra resta come copia
  return tR > tL ? 'conflictRemoteWins' : 'conflictLocalWins';
}

// Copia di una scheda "persa" in un conflitto: nuovo id, etichetta con data e ora
export function conflictCopy(rec, when = new Date()) {
  const c = deepClone(rec);
  c.id = uid();
  c.example = false;
  const d = new Date(when);
  const p2 = (n) => String(n).padStart(2, '0');
  c.conflict = `conflitto del ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}.${p2(d.getMinutes())}`;
  if (c.kind === 'plan') c.title = (c.title || 'Piano') + ' (' + c.conflict + ')';
  // nuovi id anche alle righe interne non servono: sono dentro un'altra scheda
  return c;
}

// Contenuto uguale (senza contare data di modifica e campi tecnici)
export function sameRecordContent(a, b) {
  const strip = (r) => { const { updatedAt, createdAt, schemaVersion, ...rest } = r || {}; return JSON.stringify(rest); };
  return strip(a) === strip(b);
}

// Unione a tre vie della scheda aperta sullo schermo: base = versione caricata, local = quella sullo schermo,
// remote = quella arrivata. I campi cambiati qui restano come li si sta scrivendo, quelli cambiati solo altrove
// arrivano; le liste con id (esercizi, righe) si uniscono per elemento. conflicts = campi cambiati da entrambi
// (vince quello che si sta scrivendo; chi chiama conserva l'altra versione come copia).
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const sameV = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byIdList = (arr) => Array.isArray(arr) && arr.every((x) => isObj(x) && x.id != null);
export function merge3(base, local, remote) {
  const st = { conflicts: 0 };
  const value = m3(base, local, remote, st);
  return { value, conflicts: st.conflicts };
}
function m3(base, local, remote, st) {
  if (sameV(local, base)) return deepClone(remote);
  if (sameV(remote, base) || sameV(remote, local)) return deepClone(local);
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      if (k === 'updatedAt') { out[k] = local[k]; continue; }
      const inL = k in local; const inR = k in remote; const inB = k in b;
      if (inL && inR) out[k] = m3(b[k], local[k], remote[k], st);
      else if (inL) { if (!(inB && sameV(b[k], local[k]))) out[k] = deepClone(local[k]); }
      else if (inR) { if (!(inB && sameV(b[k], remote[k]))) out[k] = deepClone(remote[k]); }
    }
    return out;
  }
  if (byIdList(local) && byIdList(remote)) {
    const b = byIdList(base) ? base : [];
    const bMap = new Map(b.map((x) => [x.id, x]));
    const rMap = new Map(remote.map((x) => [x.id, x]));
    const lMap = new Map(local.map((x) => [x.id, x]));
    const out = [];
    for (const l of local) {
      const r = rMap.get(l.id);
      if (r) out.push(m3(bMap.get(l.id), l, r, st));
      else if (!bMap.has(l.id) || !sameV(bMap.get(l.id), l)) out.push(deepClone(l)); // nuovo qui o cambiato qui
    }
    remote.forEach((r, i) => {
      if (lMap.has(r.id) || bMap.has(r.id)) return;
      const prev = i > 0 ? out.findIndex((x) => x.id === remote[i - 1].id) : -1;
      out.splice(prev + 1, 0, deepClone(r));
    });
    return out;
  }
  st.conflicts++;
  return deepClone(local);
}

// ---------- Gruppi di allenatori ----------
export const isGroupId = (id) => typeof id === 'string' && /^g_[A-Za-z0-9]{6,40}$/.test(id);
// ambito di un elemento: null = personale, altrimenti l'id del gruppo
export const scopeOf = (rec) => (rec && isGroupId(rec.groupId) ? rec.groupId : null);
// "Marco" per gli elementi di un gruppo (nome, o la parte prima della @)
export function authorName(who) {
  if (!who) return '';
  const n = String(who.name || '').trim();
  return (n || String(who.email || '').split('@')[0]).slice(0, 60);
}
