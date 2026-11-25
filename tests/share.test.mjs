// Condividi: Web Share API con file se disponibile, altrimenti download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shareOrDownload, DOCX_TYPE } from '../app/js/share.js';

const files = [{ name: '2026-11-24 Allenamento U8.docx', mimeType: DOCX_TYPE, data: new Uint8Array([80, 75, 3, 4]) }];

test('telefono con condivisione file: usa navigator.share con i .docx', async () => {
  const shared = [];
  const nav = { canShare: (d) => Array.isArray(d.files) && d.files.every((f) => f instanceof File), share: async (d) => { shared.push(d); } };
  const downloads = [];
  const r = await shareOrDownload(files, { title: 'Allenamento', nav, download: (f, n) => downloads.push(n) });
  assert.equal(r, 'shared');
  assert.equal(downloads.length, 0);
  assert.equal(shared[0].files[0].name, '2026-11-24 Allenamento U8.docx');
  assert.equal(shared[0].files[0].type, DOCX_TYPE);
  assert.equal(shared[0].files[0].size, 4);
});

test("l'utente annulla la condivisione: nessun download", async () => {
  const nav = { canShare: () => true, share: async () => { const e = new Error('annullato'); e.name = 'AbortError'; throw e; } };
  const downloads = [];
  assert.equal(await shareOrDownload(files, { nav, download: (f, n) => downloads.push(n) }), 'cancelled');
  assert.equal(downloads.length, 0);
});

test('senza Web Share con file (o se fallisce): scarica i documenti', async () => {
  for (const nav of [{}, { share: async () => {}, canShare: () => false }, { canShare: () => true, share: async () => { throw new Error('NotAllowedError'); } }]) {
    const downloads = [];
    assert.equal(await shareOrDownload(files, { nav, download: (f, n) => downloads.push(n) }), 'downloaded');
    assert.deepEqual(downloads, ['2026-11-24 Allenamento U8.docx']);
  }
});
