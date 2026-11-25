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
      const files = await listAll(query, 'files(id,name,mimeType,modifiedTime,version,parents,appProperties)');
      // difesa: se Drive restituisce i genitori, scarta i file di altre cartelle
      return folderId ? files.filter((f) => !Array.isArray(f.parents) || f.parents.includes(folderId)) : files;
    },

    async download(id) {
      const res = await request('GET', `${apiBase}/files/${encodeURIComponent(id)}?${q({ alt: 'media' })}`, { raw: true });
      return res.text();
    },

    async about() {
      return request('GET', `${apiBase}/about?${new URLSearchParams({ fields: 'user(displayName,emailAddress)' })}`);
    },

    // Crea (POST) o aggiorna lo stesso file (PATCH uploadType=multipart) se fileId è noto.
    async uploadFile({ fileId, name, mimeType, parents, appProperties, data }) {
      const meta = { name, mimeType };
      if (appProperties) meta.appProperties = appProperties;
      if (!fileId && parents) meta.parents = parents;
      const { body, contentType } = buildMultipart(meta, mimeType, data);
      const fields = 'id,name,webViewLink,modifiedTime';
      if (fileId) {
        return request('PATCH', `${uploadBase}/files/${encodeURIComponent(fileId)}?${q({ uploadType: 'multipart', fields })}`, {
          body, headers: { 'Content-Type': contentType },
        });
      }
      return request('POST', `${uploadBase}/files?${q({ uploadType: 'multipart', fields })}`, {
        body, headers: { 'Content-Type': contentType },
      });
    },
  };
}
