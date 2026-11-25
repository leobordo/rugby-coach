// Copia in app/vendor/ le librerie usate a runtime, così l'app non dipende da CDN
// e funziona offline. Da eseguire dopo aver aggiornato le dipendenze: npm run vendor
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'app', 'vendor');
const require = createRequire(import.meta.url);

const docxDir = path.dirname(require.resolve('docx/package.json'));
const { version } = JSON.parse(readFileSync(path.join(docxDir, 'package.json'), 'utf8'));

mkdirSync(vendorDir, { recursive: true });
copyFileSync(path.join(docxDir, 'dist', 'index.mjs'), path.join(vendorDir, 'docx.mjs'));
copyFileSync(path.join(docxDir, 'LICENSE'), path.join(vendorDir, 'docx.LICENSE.txt'));

console.log(`docx ${version} copiato in app/vendor/`);
console.log('Ricorda di aumentare VERSION in app/sw.js prima di pubblicare.');
