// Google Identity Services (token model) + Google Picker.
// Gli script Google sono l'unica risorsa esterna: caricati solo quando servono, con gestione dell'offline.
import { DRIVE_SCOPE, FOLDER_MIME } from './drive.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const TOKEN_KEY = 'rc.google.token';
const CONSENT_KEY = 'rc.google.consented'; // solo un flag (nessun dato sensibile) in localStorage

// Messaggi semplici per l'allenatore (mai i testi tecnici di Google)
export const MSG = {
  denied: 'Non hai dato il permesso a Drive. Puoi riprovare quando vuoi.',
  blocked: 'Il telefono ha bloccato la finestra di Google: tocca di nuovo.',
  closed: 'Hai chiuso la finestra di Google. Puoi riprovare quando vuoi.',
  unreachable: 'Non riesco a raggiungere Google. Riprova quando sei connesso.',
  notReady: 'Un attimo… sto preparando l\'accesso a Google. Tocca di nuovo tra qualche secondo.',
  failed: 'L\'accesso a Google non è riuscito. Riprova.',
  notConfigured: 'Il salvataggio su Google Drive non è disponibile in questa versione.',
};
export class GoogleSignInError extends Error {
  constructor(code) { super(MSG[code] || MSG.failed); this.name = 'GoogleSignInError'; this.code = code; }
}
// Da un errore di Google (callback / error_callback) al nostro codice
export function mapGoogleError(err) {
  const t = (err && (err.error || err.type)) || '';
  if (/access_denied|consent_required|interaction_required|scope/.test(t)) return 'denied';
  if (t === 'popup_failed_to_open') return 'blocked';
  if (t === 'popup_closed') return 'closed';
  return 'failed';
}

const loading = new Map();
export function loadScript(src, timeout = 15000) {
  if (loading.has(src)) return loading.get(src);
  const p = new Promise((resolve, reject) => {
    if (!navigator.onLine) { reject(new GoogleSignInError('unreachable')); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    const timer = setTimeout(() => { s.remove(); reject(new GoogleSignInError('unreachable')); }, timeout);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new GoogleSignInError('unreachable')); };
    document.head.appendChild(s);
  });
  loading.set(src, p);
  p.catch(() => loading.delete(src));
  return p;
}

// Il token d'accesso (validità ~1 ora, permesso limitato ai file dell'app) sta in localStorage: riaprendo l'app
// entro l'ora non serve fare nulla. La versione 1.2 lo teneva in sessionStorage: viene spostato una volta.
export function createGoogleAuth({ getConfig, storage = window.localStorage, legacyStorage = window.sessionStorage }) {
  let tokenClient = null;
  let tokenClientId = null;
  let pending = null;
  let token = null;
  try {
    const legacy = legacyStorage && legacyStorage.getItem(TOKEN_KEY);
    if (legacy && !storage.getItem(TOKEN_KEY)) storage.setItem(TOKEN_KEY, legacy);
    if (legacy) legacyStorage.removeItem(TOKEN_KEY);
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

  let preloading = null;
  let lastLoadError = null;

  async function ensureClient() {
    const cfg = await getConfig();
    if (!cfg.clientId) throw new GoogleSignInError('notConfigured');
    await loadScript(GIS_SRC);
    if (!tokenClient || tokenClientId !== cfg.clientId) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
          const p = pending; pending = null;
          if (!p) return;
          if (resp.error) { p.reject(new GoogleSignInError(mapGoogleError(resp))); return; }
          if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) { p.reject(new GoogleSignInError('denied')); return; }
          token = { access_token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
          storage.setItem(TOKEN_KEY, JSON.stringify(token));
          try { storage.setItem(CONSENT_KEY, '1'); } catch { /* */ }
          p.resolve(token.access_token);
        },
        error_callback: (err) => {
          const p = pending; pending = null;
          if (p) p.reject(new GoogleSignInError(mapGoogleError(err)));
        },
      });
      tokenClientId = cfg.clientId;
    }
    return tokenClient;
  }

  // Prepara in anticipo script e token client (all'avvio se Drive è collegato, o quando l'app propone di
  // collegarlo): così al tocco requestAccessToken parte subito, dentro il gesto (necessario su iPhone/Safari).
  function preload() {
    if (tokenClient) return Promise.resolve(true);
    if (!preloading) {
      preloading = ensureClient().then(() => { lastLoadError = null; return true; })
        .catch((e) => { lastLoadError = e; return false; })
        .finally(() => { preloading = null; });
    }
    return preloading;
  }

  function isReady() { return !!tokenClient; }

  // Va chiamata SINCRONAMENTE dentro il gestore del tocco (nessun await prima): requestAccessToken parte subito.
  // Se il client non è ancora pronto non lo chiama fuori dal gesto: chiede di toccare di nuovo.
  function signIn({ selectAccount = false, knownUser = false } = {}) {
    if (!tokenClient) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const code = offline || (lastLoadError && lastLoadError.code === 'unreachable') ? 'unreachable' : lastLoadError && lastLoadError.code === 'notConfigured' ? 'notConfigured' : 'notReady';
      preload();
      return Promise.reject(new GoogleSignInError(code));
    }
    if (pending) { const old = pending; pending = null; old.reject(new GoogleSignInError('closed')); }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      // Consenso esplicito solo al primo accesso da questo dispositivo; poi prompt '' (la finestra di Google si
      // chiude da sola). "Usa un altro account" usa select_account.
      let consented = false;
      try { consented = !!storage.getItem(CONSENT_KEY); } catch { /* */ }
      tokenClient.requestAccessToken({ prompt: selectAccount ? 'select_account' : (consented || knownUser ? '' : 'consent') });
    });
  }

  function reset() { tokenClient = null; tokenClientId = null; lastLoadError = null; }

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

  return { getValidToken, clearToken, preload, isReady, reset, signIn, signOut, pickFolder, hasToken: () => !!getValidToken() };
}
