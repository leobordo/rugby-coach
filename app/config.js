// Configurazione Google dell'app, a cura dello sviluppatore (vedi docs/SETUP_GOOGLE.md).
// Client ID OAuth di tipo "Applicazione web" (non è un segreto) e, per i gruppi, chiave API + numero del progetto.
// Vuoto = l'app funziona solo sul telefono (senza salvataggio su Google Drive).
export default {
  // Progetto Google Cloud rugby-coach-515808 — origini autorizzate: https://leobordo.github.io, http://localhost:8080
  clientId: '613972924268-728rj0ug6s50d6a5ursccrs16ug6fa6b.apps.googleusercontent.com',
  // Google Picker: serve SOLO per entrare in un gruppo (e per l'opzione avanzata "usa un'altra cartella").
  // Non sono segreti: la chiave API va limitata ai referrer dell'app e alle API Picker/Drive (vedi docs/SETUP_GOOGLE.md).
  apiKey: 'AIzaSyBG2Gl2wgmzDl6eoExWeg87Y_ahnDkmPRE',
  appId: '613972924268',
};
