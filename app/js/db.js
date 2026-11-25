// Wrapper minimale e promise-based su IndexedDB (R22). Nessuna libreria esterna.
export const DB_NAME = 'rugby-coach';
export const DB_VERSION = 1;
export const STORES = {
  sessions: { keyPath: 'id' },
  matches: { keyPath: 'id' },
  plans: { keyPath: 'id' },
  exercises: { keyPath: 'id' },
  players: { keyPath: 'id' },
  settings: { keyPath: 'key' },
  sync: { keyPath: 'key' },
};

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export function openDB(idb = globalThis.indexedDB, name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const r = idb.open(name, DB_VERSION);
    r.onupgradeneeded = (ev) => {
      const db = r.result;
      // Migrazioni dello schema IndexedDB per versione
      if (ev.oldVersion < 1) {
        for (const [s, opt] of Object.entries(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, opt);
      }
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); };
      resolve(wrap(db));
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database bloccato da un\'altra scheda dell\'app aperta'));
  });
}

function wrap(db) {
  const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
  const done = (t) => new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  return {
    raw: db,
    get: (store, key) => req(tx(store).get(key)),
    getAll: (store) => req(tx(store).getAll()),
    put: (store, value) => req(tx(store, 'readwrite').put(value)),
    delete: (store, key) => req(tx(store, 'readwrite').delete(key)),
    clear: (store) => req(tx(store, 'readwrite').clear()),
    async putMany(store, values) {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const v of values) os.put(v);
      return done(t);
    },
    async deleteMany(store, keys) {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const k of keys) os.delete(k);
      return done(t);
    },
    close: () => db.close(),
  };
}
