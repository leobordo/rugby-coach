// Google Identity Services (token model) + Google Picker.
// Gli script Google sono l'unica risorsa esterna: caricati solo quando servono, con gestione dell'offline.
import { DRIVE_SCOPE, FOLDER_MIME } from './drive.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const TOKEN_KEY = 'rc.google.token';
const CONSENT_KEY = 'rc.google.consented'; // solo un flag (nessun dato sensibile) in localStorage

const loading = new Map();
export function loadScript(src, timeout = 15000) {
  if (loading.has(src)) return loading.get(src);
  const p = new Promise((resolve, reject) => {
    if (!navigator.onLine) { reject(new Error('Sei offline: i servizi Google non sono raggiungibili.')); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    const timer = setTimeout(() => { s.remove(); reject(new Error('Timeout nel caricamento dei servizi Google.')); }, timeout);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('Impossibile caricare i servizi Google (connessione assente o bloccata).')); };
    document.head.appendChild(s);
  });
  loading.set(src, p);
  p.catch(() => loading.delete(src));
  return p;
}

// Il token d'accesso (validità ~1 ora) sta in sessionStorage: resta solo per la scheda/finestra aperta e non
// sopravvive alla chiusura dell'app (meno esposto di localStorage). Le versioni precedenti lo salvavano in
// localStorage: viene spostato una volta e poi cancellato da lì.
export function createGoogleAuth({ getConfig, storage = window.sessionStorage, legacyStorage = window.localStorage }) {
  let tokenClient = null;
  let tokenClientId = null;
  let pending = null;
  let token = null;
  try {
    const legacy = legacyStorage && legacyStorage.getItem(TOKEN_KEY);
    if (legacy) { storage.setItem(TOKEN_KEY, legacy); legacyStorage.removeItem(TOKEN_KEY); }
  } catch { /* storage non disponibile */ }
  try { token = JSON.parse(storage.getItem(TOKEN_KEY) || 'null'); } catch { token = null; }
  if (token && (typeof token.access_token !== 'string' || !Number.isFinite(token.expiresAt))) token = null;

  function getValidToken() {
    if (token && token.access_token && token.expiresAt - 60e3 > Date.now()) return token.access_token;
    return null;
  }
  function clearToken() {
    token = null;
    try { storage.removeItem(TOKEN_KEY); if (legacyStorage) legacyStorage.removeItem(TOKEN_KEY); } catch { /* */ }
  }

  async function ensureClient() {
    const cfg = await getConfig();
    if (!cfg.clientId) throw new Error('Client ID non configurato (Impostazioni → Google Drive).');
    await loadScript(GIS_SRC);
    if (!tokenClient || tokenClientId !== cfg.clientId) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
          const p = pending; pending = null;
          if (!p) return;
          if (resp.error) { p.reject(new Error(resp.error_description || resp.error)); return; }
          if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) { p.reject(new Error('Permesso su Google Drive non concesso.')); return; }
          token = { access_token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
          storage.setItem(TOKEN_KEY, JSON.stringify(token));
          try { legacyStorage.setItem(CONSENT_KEY, '1'); } catch { /* */ }
          p.resolve(token.access_token);
        },
        error_callback: (err) => {
          const p = pending; pending = null;
          if (!p) return;
          const msg = err && err.type === 'popup_closed' ? 'Finestra di accesso chiusa.' : err && err.type === 'popup_failed_to_open' ? 'Il browser ha bloccato la finestra di accesso: consenti i popup e riprova.' : 'Accesso non riuscito.';
          p.reject(new Error(msg));
        },
      });
      tokenClientId = cfg.clientId;
    }
    return tokenClient;
  }

  // Da chiamare in anticipo (quando c'è rete) così il popup parte subito dal gesto dell'utente
  async function preload() { try { await ensureClient(); return true; } catch { return false; } }

  // Va chiamata SOLO da un gesto dell'utente (click), altrimenti i browser bloccano il popup
  async function signIn({ selectAccount = false } = {}) {
    const client = await ensureClient();
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      // Consenso esplicito solo al primo accesso da questo dispositivo; poi prompt '' (Google mostra il consenso
      // solo se serve, altrimenti il token arriva subito). "Cambia account" usa select_account.
      let consented = false;
      try { consented = !!legacyStorage.getItem(CONSENT_KEY); } catch { /* */ }
      client.requestAccessToken({ prompt: selectAccount ? 'select_account' : (consented ? '' : 'consent') });
    });
  }

  async function signOut() {
    const t = token && token.access_token;
    clearToken();
    if (t && window.google && window.google.accounts && window.google.accounts.oauth2) {
      await new Promise((r) => window.google.accounts.oauth2.revoke(t, r));
    }
  }

  async function pickFolder() {
    const cfg = await getConfig();
    if (!cfg.apiKey || !cfg.appId) throw new Error('Per scegliere una cartella servono API key e App ID (numero progetto).');
    const t = getValidToken();
    if (!t) throw new Error('Accedi prima a Google.');
    await loadScript(GAPI_SRC);
    await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker non disponibile.')) }));
    const gp = window.google.picker;
    return new Promise((resolve) => {
      const view = new gp.DocsView(gp.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(FOLDER_MIME)
        .setMode(gp.DocsViewMode.LIST); // con drive.file le miniature non sono disponibili
      const picker = new gp.PickerBuilder()
        .setTitle('Scegli la cartella per le schede')
        .addView(view)
        .enableFeature(gp.Feature.SUPPORT_DRIVES)
        .setOAuthToken(t)
        .setDeveloperKey(cfg.apiKey)
        .setAppId(String(cfg.appId))
        .setLocale('it')
        .setCallback((data) => {
          if (data.action === gp.Action.PICKED && data.docs && data.docs[0]) resolve({ id: data.docs[0].id, name: data.docs[0].name });
          else if (data.action === gp.Action.CANCEL) resolve(null);
        })
        .build();
      picker.setVisible(true);
    });
  }

  return { getValidToken, clearToken, preload, signIn, signOut, pickFolder, hasToken: () => !!getValidToken() };
}
