// Allenamento appena creato e ancora vuoto: resta solo in memoria (niente archivio, niente coda per Drive).
// L'archivio non è aperto in questo test: se il codice provasse a scrivere, il test fallirebbe.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as repo from '../app/js/repo.js';
import { newSession, newMatch } from '../app/js/model.js';

test('allenamento nuovo vuoto: non si salva, non va in coda e sparisce quando si chiude la pagina', async () => {
  const dirty = [];
  repo.setSyncHooks({ onDirty: async (k, id) => { dirty.push([k, id]); } });
  const s = repo.startDraft(newSession());
  assert.equal(repo.isDraft('session', s.id), true);
  assert.equal(repo.isDraft('match', s.id), false, 'vale solo per gli allenamenti');
  assert.equal(await repo.get('session', s.id), s, 'la pagina trova la stessa seduta');
  repo.setOpen('session', s.id, true);
  s.modules.push('attendance'); // sezione aggiunta, ancora vuota
  assert.equal(await repo.save(s), s);
  assert.deepEqual(dirty, [], 'niente coda per Drive');
  repo.setOpen('session', s.id, false); // uscita dalla pagina
  await repo.save(s); // salvataggio vuoto arrivato in ritardo: ignorato
  assert.deepEqual(dirty, []);
  assert.equal(repo.isDraft('session', s.id), true);
  assert.equal(repo.isDraft('session', newMatch().id), false);
});
