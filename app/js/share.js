// Condividi una scheda come documento Word: Web Share API con file (WhatsApp, Mail, Drive, File...) quando il
// telefono lo permette, altrimenti il file viene scaricato. Funziona anche senza Google Drive.
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function toFile(f, FileCtor = globalThis.File) {
  const data = f.data instanceof Blob ? f.data : new Blob([f.data], { type: f.mimeType || DOCX_TYPE });
  return new FileCtor([data], f.name, { type: f.mimeType || DOCX_TYPE });
}

// files: [{ name, mimeType, data }] ; restituisce 'shared' | 'cancelled' | 'downloaded'
export async function shareOrDownload(files, { title = 'Scheda', nav = globalThis.navigator, download, FileCtor = globalThis.File } = {}) {
  const list = files.map((f) => toFile(f, FileCtor));
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: list })) {
    try {
      await nav.share({ files: list, title, text: title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // condivisione non riuscita (es. permesso negato): si ripiega sul download
    }
  }
  for (const f of list) download(f, f.name);
  return 'downloaded';
}
