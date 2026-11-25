// Costruisce i file da salvare su Drive per un record: uno o due .docx + un .json di backup.
import { createBuilder, docVariants, buildDocument } from './docx-build.js';
import { DOCX_MIME, JSON_MIME } from './drive.js';
import { fileBaseName, buildRecordBackup, buildBackup, observationHasContent } from './model.js';

let docxPromise = null;
export function loadDocx(url = new URL('../vendor/docx.mjs', import.meta.url).href) {
  if (!docxPromise) docxPromise = import(url).catch((e) => { docxPromise = null; throw e; });
  return docxPromise;
}

export async function packDocument(docx, document) {
  if (typeof window !== 'undefined' && docx.Packer.toBlob) return docx.Packer.toBlob(document);
  const buf = await docx.Packer.toBuffer(document);
  return new Uint8Array(buf);
}

export async function buildDocxFiles(docx, rec, ctx = {}) {
  const builder = createBuilder(docx, ctx);
  const variants = docVariants(rec, rec.kind === 'session' ? observationHasContent(rec) : false);
  const out = [];
  for (const v of variants) {
    const document = buildDocument(builder, rec, v);
    const data = await packDocument(docx, document);
    const name = fileBaseName(rec, v === 'observation' ? 'observation' : 'main') + '.docx';
    if (!data || (data.size ?? data.length) === 0) continue;
    out.push({ key: 'docx-' + v, name, mimeType: DOCX_MIME, data });
  }
  return out;
}

export function buildJsonFile(rec) {
  // raccolte (libreria, rosa): backup completo ri-importabile con "Importa backup" o "Ripristina da Drive"
  // le raccolte portano anche le cancellazioni (tombstone) per il merge tra dispositivi
  const payload = rec.kind === 'library' ? { ...buildBackup({ exercises: rec.exercises }), tombstones: { exercise: rec.tombstones || {} } }
    : rec.kind === 'roster' ? { ...buildBackup({ players: rec.players }), tombstones: { player: rec.tombstones || {} } } : buildRecordBackup(rec);
  const json = JSON.stringify(payload, null, 2);
  return { key: 'json', name: fileBaseName(rec) + '.json', mimeType: JSON_MIME, data: json };
}

export async function buildArtifacts(docx, rec, ctx = {}) {
  const docs = await buildDocxFiles(docx, rec, ctx);
  return [...docs, buildJsonFile(rec)];
}
