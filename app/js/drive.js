// Client minimale per Google Drive REST v3 via fetch (scope drive.file).
// Nessuna dipendenza dal DOM o dagli script Google: fetch e token sono iniettati -> testabile con un fetch finto.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const JSON_MIME = 'application/json';

export class DriveAuthError extends Error {
  constructor(msg = 'Accesso a Google necessario') { super(msg); this.name = 'DriveAuthError'; }
}
export class DriveHttpError extends Error {
  constructor(status, msg) { super(msg || 'Errore Drive ' + status); this.name = 'DriveHttpError'; this.status = status; }
}
export class DriveOfflineError extends Error {
  constructor() { super('Nessuna connessione'); this.name = 'DriveOfflineError'; }
}

export function qEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

export function buildMultipart(metadata, mimeType, data, boundary) {
  const b = boundary || 'rcb' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  // metadati in JSON solo-ASCII (\uXXXX): nessun problema di codifica per nomi con accenti o "°"
  const metaJson = JSON.stringify(metadata).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const head = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${b}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${b}--`;
  const body = new Blob([head, data, tail]);
  return { body, contentType: `multipart/related; boundary=${b}`, boundary: b };
}

export function createDriveClient({ fetch: fetchFn, getToken, onUnauthorized,
  apiBase = 'https://www.googleapis.com/drive/v3', uploadBase = 'https://www.googleapis.com/upload/drive/v3' } = {}) {
  if (!fetchFn) throw new Error('fetch mancante');

  async function request(method, url, { body, headers = {}, raw = false } = {}) {
    const token = await getToken();
    if (!token) throw new DriveAuthError();
    let res;
    try {
      res = await fetchFn(url, { method, body, headers: { Authorization: 'Bearer ' + token, ...headers } });
    } catch (e) {
      throw new DriveOfflineError();
    }
    if (res.status === 401) {
      if (onUnauthorized) onUnauthorized();
      throw new DriveAuthError('Accesso scaduto: accedi di nuovo a Google');
    }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = j?.error?.message || ''; } catch { /* ignore */ }
      throw new DriveHttpError(res.status, `Drive ${res.status}${msg ? ': ' + msg : ''}`);
    }
    if (raw) return res;
    if (res.status === 204) return null;
    return res.json();
  }

  // supportsAllDrives su tutte le chiamate: la cartella scelta può stare in un Drive condiviso
  const q = (params) => new URLSearchParams({ ...params, supportsAllDrives: 'true' }).toString();

  async function listAll(query, fields) {
    const out = [];
    let pageToken = '';
    for (let i = 0; i < 50; i++) {
      const params = { q: query, fields: 'nextPageToken,' + fields, pageSize: '1000', includeItemsFromAllDrives: 'true', corpora: 'allDrives' };
      if (pageToken) params.pageToken = pageToken;
      const res = await request('GET', `${apiBase}/files?${q(params)}`);
      out.push(...((res && res.files) || []));
      pageToken = res && res.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  return {
    request,

    async createFolder(name, { parentId, appProperties } = {}) {
      const meta = { name, mimeType: FOLDER_MIME };
      if (parentId) meta.parents = [parentId];
      if (appProperties) meta.appProperties = appProperties;
      return request('POST', `${apiBase}/files?${q({ fields: 'id,name,webViewLink' })}`, {
        body: JSON.stringify(meta), headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      });
    },

    async getFile(id, fields = 'id,name,mimeType,trashed,webViewLink') {
      return request('GET', `${apiBase}/files/${encodeURIComponent(id)}?${q({ fields })}`);
    },

    async listFiles(query, fields = 'files(id,name,mimeType,modifiedTime,parents,appProperties)') {
      return { files: await listAll(query, fields) };
    },

    // File creati dall'app in una cartella (con drive.file l'app vede i file che ha creato lei)
    async listAppFiles(folderId, { appId = 'rugby-coach', mimeType, props = {} } = {}) {
      let query = `appProperties has { key='rcApp' and value='${qEsc(appId)}' } and trashed=false`;
      for (const [k, v] of Object.entries(props)) query += ` and appProperties has { key='${qEsc(k)}' and value='${qEsc(v)}' }`;
      if (folderId) query = `'${qEsc(folderId)}' in parents and ` + query;
      if (mimeType) query += ` and mimeType='${qEsc(mimeType)}'`;
      const files = await listAll(query, 'files(id,name,mimeType,modifiedTime,version,trashed,parents,appProperties)');
      // difesa: se Drive restituisce i genitori, scarta i file di altre cartelle
      return folderId ? files.filter((f) => !Array.isArray(f.parents) || f.parents.includes(folderId)) : files;
    },

    // Cartelle create dall'app (appProperties rcKind=folder | dataFolder), dalla più vecchia
    async listAppFolders({ appId = 'rugby-coach', kind = 'folder', parentId } = {}) {
      let query = `mimeType='${FOLDER_MIME}' and appProperties has { key='rcApp' and value='${qEsc(appId)}' } and appProperties has { key='rcKind' and value='${qEsc(kind)}' } and trashed=false`;
      if (parentId) query = `'${qEsc(parentId)}' in parents and ` + query;
      let files = await listAll(query, 'files(id,name,createdTime,parents,appProperties)');
      if (parentId) files = files.filter((f) => !Array.isArray(f.parents) || f.parents.includes(parentId));
      // difesa: solo cartelle con l'etichetta richiesta (se Drive le restituisce)
      files = files.filter((f) => !f.appProperties || f.appProperties.rcKind === kind);
      return files.sort((a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || String(a.id).localeCompare(String(b.id)));
    },

    // Sposta un file in un'altra cartella: STESSO file e stesso id (files.update addParents/removeParents)
    async moveFile(id, { addParents, removeParents }) {
      const params = { fields: 'id,parents,trashed' };
      if (addParents) params.addParents = addParents;
      if (removeParents) params.removeParents = removeParents;
      return request('PATCH', `${apiBase}/files/${encodeURIComponent(id)}?${q(params)}`, {
        body: '{}', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      });
    },

    async download(id) {
      const res = await request('GET', `${apiBase}/files/${encodeURIComponent(id)}?${q({ alt: 'media' })}`, { raw: true });
      return res.text();
    },

    async about() {
      return request('GET', `${apiBase}/about?${new URLSearchParams({ fields: 'user(displayName,emailAddress)' })}`);
    },

    // Sposta nel CESTINO di Drive (recuperabile per 30 giorni). File già sparito (404) = fatto.
    async trashFile(id) {
      try {
        await request('PATCH', `${apiBase}/files/${encodeURIComponent(id)}?${q({ fields: 'id,trashed' })}`, {
          body: JSON.stringify({ trashed: true }), headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
        return 'trashed';
      } catch (e) {
        if (e instanceof DriveHttpError && e.status === 404) return 'missing';
        throw e;
      }
    },

    // Toglie un file dal cestino (es. scheda eliminata su un altro telefono ma modificata qui DOPO)
    async untrashFile(id) {
      return request('PATCH', `${apiBase}/files/${encodeURIComponent(id)}?${q({ fields: 'id,trashed' })}`, {
        body: JSON.stringify({ trashed: false }), headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      });
    },

    // Crea (POST) o aggiorna lo stesso file (PATCH uploadType=multipart) se fileId è noto.
    // Con untrash: l'aggiornamento toglie anche il file dal cestino (su Drive un PATCH su un file cestinato
    // riesce ma il file RESTA nel cestino): trashed:false nei metadati e controllo della risposta.
    async uploadFile({ fileId, name, mimeType, parents, appProperties, data, untrash = false }) {
      const meta = { name, mimeType };
      if (appProperties) meta.appProperties = appProperties;
      if (!fileId && parents) meta.parents = parents;
      if (fileId && untrash) meta.trashed = false;
      const { body, contentType } = buildMultipart(meta, mimeType, data);
      const fields = 'id,name,webViewLink,modifiedTime,trashed,version';
      if (fileId) {
        const res = await request('PATCH', `${uploadBase}/files/${encodeURIComponent(fileId)}?${q({ uploadType: 'multipart', fields })}`, {
          body, headers: { 'Content-Type': contentType },
        });
        if (untrash && res && res.trashed === true) { await this.untrashFile(fileId); res.trashed = false; }
        return res;
      }
      return request('POST', `${uploadBase}/files?${q({ uploadType: 'multipart', fields })}`, {
        body, headers: { 'Content-Type': contentType },
      });
    },
  };
}

// Collegamento in un tocco: ritrova la cartella creata dall'app (es. su un altro telefono) oppure la crea
// nella radice del Drive. Restituisce { folder, created }.
export async function findOrCreateAppFolder(drive, name = 'Rugby Coach', appId = 'rugby-coach') {
  const found = await drive.listAppFolders({ appId });
  if (found.length) return { folder: { id: found[0].id, name: found[0].name }, created: false };
  const f = await drive.createFolder(name, { appProperties: { rcApp: appId, rcKind: 'folder' } });
  return { folder: { id: f.id, name: f.name || name }, created: true };
}

// Sottocartella "File per l'app" dentro "Rugby Coach": qui stanno i file .json che servono all'app (copie per il
// recupero, libreria, rosa, schede eliminate); nella cartella principale restano solo i documenti Word.
// Ritrovata se esiste già; se due telefoni l'hanno creata insieme vince la più vecchia (stesso criterio su tutti
// i telefoni: data di creazione, poi id), i file delle altre vengono spostati lì e le altre vanno nel cestino.
export const DATA_FOLDER_NAME = 'File per l\'app';
export async function findOrCreateDataFolder(drive, parentId, appId = 'rugby-coach') {
  let found = await drive.listAppFolders({ appId, kind: 'dataFolder', parentId });
  let createdId = null;
  if (!found.length) {
    // spostata a mano fuori da "Rugby Coach"? è sempre quella creata dall'app: la si usa e la si rimette al suo posto
    const anywhere = await drive.listAppFolders({ appId, kind: 'dataFolder' });
    if (anywhere.length) {
      const f = anywhere[0];
      const from = (f.parents || []).filter((x) => x !== parentId).join(',');
      try { await drive.moveFile(f.id, { addParents: parentId, removeParents: from || undefined }); } catch (e) { if (!(e instanceof DriveHttpError)) throw e; }
      found = [{ ...f, parents: [parentId] }];
    }
  }
  if (!found.length) {
    const f = await drive.createFolder(DATA_FOLDER_NAME, { parentId, appProperties: { rcApp: appId, rcKind: 'dataFolder' } });
    createdId = f.id;
    found = await drive.listAppFolders({ appId, kind: 'dataFolder', parentId });
    if (!found.some((x) => x.id === f.id)) found = [...found, { id: f.id, name: f.name || DATA_FOLDER_NAME }];
  }
  const [winner, ...extra] = found;
  for (const x of extra) {
    for (const f of await drive.listAppFiles(x.id)) await moveFileQuietly(drive, f.id, winner.id, x.id);
    await drive.trashFile(x.id);
  }
  return { id: winner.id, name: winner.name || DATA_FOLDER_NAME, created: winner.id === createdId };
}

// Migrazione: i .json dell'app ancora nella cartella principale vengono SPOSTATI in "File per l'app".
// Idempotente (si cercano solo quelli ancora lì) e sicura se interrotta: al giro dopo si riprende.
export async function moveRootJson(drive, folderId, dataFolderId, appId = 'rugby-coach') {
  const root = await drive.listAppFiles(folderId, { appId, mimeType: JSON_MIME });
  let moved = 0;
  for (const f of root) if (await moveFileQuietly(drive, f.id, dataFolderId, folderId)) moved++;
  return { moved, found: root.length };
}

export async function moveFileQuietly(drive, id, to, from) {
  try {
    await drive.moveFile(id, { addParents: to, removeParents: from });
    return true;
  } catch (e) {
    // già spostato da un altro telefono o eliminato nel frattempo: niente da fare
    if (e instanceof DriveHttpError && (e.status === 404 || e.status === 400 || e.status === 403)) return false;
    throw e;
  }
}
