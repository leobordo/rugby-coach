// Copia questo file in config.js (o compila i campi in Impostazioni → Google Drive).
// Questi valori NON sono segreti: il Client ID e la API key di un'app web statica sono pubblici per natura.
// Limita comunque la API key ai siti dell'app (+ https://docs.google.com/*) e alle API "Google Picker API" e "Google Drive API"
// (vedi GUIDA_GOOGLE_CLOUD.md).
export default {
  // ID client OAuth 2.0 di tipo "Applicazione web"
  clientId: '1234567890-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com',
  // Chiave API (serve al Google Picker per scegliere la cartella)
  apiKey: 'AIzaSy...',
  // App ID = numero del progetto Google Cloud (solo cifre)
  appId: '123456789012',
};
