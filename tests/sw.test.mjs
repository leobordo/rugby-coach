// L'elenco PRECACHE del service worker deve contenere tutti i file necessari offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './fixtures.mjs';

const APP = path.join(ROOT, 'app');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

test('il service worker mette in cache tutti i file dell\'app', () => {
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  const list = JSON.parse('[' + /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  const needed = walk(APP).map((f) => './' + path.relative(APP, f).split(path.sep).join('/'))
    .filter((f) => !/\.txt$/.test(f) && !['./sw.js', './config.example.js', './icons/maskable.svg', './.nojekyll'].includes(f));
  const missing = needed.filter((f) => !list.includes(f));
  assert.deepEqual(missing, [], 'file mancanti nel precache');
  const extra = list.filter((f) => f !== './' && !fs.existsSync(path.join(APP, f)));
  assert.deepEqual(extra, [], 'file inesistenti nel precache');
});

test('manifest PWA valido con icone esistenti', () => {
  const m = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.lang, 'it');
  assert.equal(m.start_url, './');
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(APP, i.src)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('nessuna risorsa da CDN nel codice dell\'app (eccetto gli script Google caricati su richiesta)', () => {
  const files = walk(path.join(APP, 'js')).concat([path.join(APP, 'index.html'), path.join(APP, 'css', 'app.css')]);
  const allowed = /^http:\/\/www\.w3\.org\/2000\/svg$|https:\/\/(accounts\.google\.com\/gsi\/client|apis\.google\.com\/js\/api\.js|www\.googleapis\.com\/(upload\/)?drive\/v3|www\.googleapis\.com\/auth\/drive\.file|drive\.google\.com\/drive\/folders\/|www\.w3\.org\/2000\/svg)/;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      assert.ok(allowed.test(m[0]), `URL esterno non consentito in ${path.relative(APP, f)}: ${m[0]}`);
    }
  }
});
