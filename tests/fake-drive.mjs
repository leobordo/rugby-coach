// Drive v3 finto MULTI-UTENTE per i test dei gruppi, con le regole che contano:
// - drive.file: l'app vede solo i file creati da lei per quell'utente o scelti dall'utente col Picker;
// - permessi: proprietario, "chiunque abbia il link" (anyone) e permessi espliciti per email, ereditati dalle cartelle;
// - cestino (anche i file in una cartella cestinata risultano nel cestino; solo il proprietario può cestinare),
//   version, appProperties, spostamenti (addParents/removeParents), permessi (create/list/delete: come su Drive,
//   li gestisce chi può modificare; il proprietario non si può togliere).
// Picker finto: GET /__picker/visible?ids=… (file che l'utente può vedere) e POST /__picker/grant (selezione).
// Il token identifica l'utente: "tok-<email>-<n>".

export function createFakeDrive() {
  const files = new Map();
  const access = new Map(); // email -> Set(id) (drive.file)
  const names = new Map();  // email -> nome mostrato da Google
  const calls = [];
  let n = 0;
  const grant = (u, id) => { if (!access.has(u)) access.set(u, new Set()); access.get(u).add(id); };
  const hasPerm = (u, f, depth = 0) => {
    if (!f || depth > 20) return false;
    if (f.owner === u) return true;
    if ((f.perms || []).some((p) => p.type === 'anyone' || (p.type === 'user' && p.emailAddress === u))) return true;
    return (f.parents || []).some((pid) => hasPerm(u, files.get(pid), depth + 1));
  };
  const isTrashed = (f, depth = 0) => !!f && depth < 20 && (!!f.trashed || (f.parents || []).some((p) => isTrashed(files.get(p), depth + 1)));
  const canUse = (u, f) => !!f && !!access.get(u)?.has(f.id) && hasPerm(u, f);
  const parts = (buf) => {
    const s = buf.toString('latin1');
    const b = /^--([^\r\n]+)/.exec(s)[1];
    return s.split('--' + b).slice(1, -1).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, p.length - 2));
  };
  const meta = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, version: String(f.version || 1), parents: f.parents, appProperties: f.appProperties, trashed: isTrashed(f) });

  // { method, url, auth, body: Buffer } -> { status, json | text }
  function handle({ method, url, auth, body }) {
    const u0 = new URL(url);
    const path = u0.pathname;
    const m = /^Bearer tok-(.+)-\d+$/.exec(auth || '');
    const user = m ? m[1] : null;
    calls.push({ user, method, path, q: u0.searchParams.get('q') || '', media: u0.searchParams.get('alt') === 'media' });
    const J = (obj, status = 200) => ({ status, json: obj });
    const NF = () => J({ error: { code: 404, message: 'File not found' } }, 404);
    if (!user) return J({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
    if (path === '/drive/v3/about') return J({ user: { emailAddress: user, displayName: names.get(user) || user.split('@')[0] } });
    // ----- Picker finto -----
    if (path === '/__picker/visible') {
      const ids = (u0.searchParams.get('ids') || '').split(',').filter(Boolean);
      return J({ files: ids.map((id) => files.get(id)).filter((f) => f && !isTrashed(f) && hasPerm(user, f)).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })) });
    }
    if (path === '/__picker/grant' && method === 'POST') {
      const ids = JSON.parse(body.toString('utf8')).ids || [];
      const ok = ids.filter((id) => files.get(id) && hasPerm(user, files.get(id)));
      for (const id of ok) grant(user, id);
      return J({ granted: ok });
    }
    // ----- file -----
    if (path === '/drive/v3/files' && method === 'POST') {
      const md = JSON.parse(body.toString('utf8'));
      if (md.parents && !canUse(user, files.get(md.parents[0]))) return NF();
      const id = 'fold' + (++n);
      files.set(id, { ...md, id, owner: user, perms: [], version: 1, createdTime: new Date(1.7e12 + n * 1000).toISOString() });
      grant(user, id);
      return J({ id, name: md.name });
    }
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = u0.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const mime = /mimeType='([^']+)'/.exec(q)?.[1];
      const props = [...q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)];
      const list = [...files.values()].filter((f) => canUse(user, f) && !isTrashed(f) && f.appProperties
        && (!parent || (f.parents || []).includes(parent)) && props.every(([, k, v]) => f.appProperties[k] === v) && (!mime || f.mimeType === mime));
      return J({ files: list.map(meta) });
    }
    const perm = /^\/drive\/v3\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/.exec(path);
    if (perm) {
      const f = files.get(perm[1]);
      if (!canUse(user, f)) return NF();
      if (method === 'GET') return J({ permissions: [{ id: 'owner', type: 'user', role: 'owner', emailAddress: f.owner }, ...(f.perms || [])] });
      if (method === 'POST') {
        const p = JSON.parse(body.toString('utf8'));
        const id = 'perm' + (++n);
        f.perms = [...(f.perms || []).filter((x) => !(x.type === p.type && x.emailAddress === p.emailAddress)), { id, type: p.type, role: p.role, emailAddress: p.emailAddress }];
        return J({ id, type: p.type, role: p.role, emailAddress: p.emailAddress });
      }
      if (method === 'DELETE') {
        if (perm[2] === 'owner') return J({ error: { code: 403, message: 'The owner cannot be removed' } }, 403);
        const before = (f.perms || []).length;
        f.perms = (f.perms || []).filter((x) => x.id !== perm[2]);
        return before === f.perms.length ? NF() : { status: 204, json: null };
      }
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (one) {
      const f = files.get(one[1]);
      if (!canUse(user, f)) return NF();
      if (method === 'GET') return u0.searchParams.get('alt') === 'media' ? { status: 200, text: f.content ?? '' } : J(meta(f));
      if (method === 'PATCH') {
        const add = u0.searchParams.get('addParents'); const rem = u0.searchParams.get('removeParents');
        const md = JSON.parse(body.toString('utf8') || '{}');
        if (md.trashed === true && f.owner !== user) return J({ error: { code: 403, message: 'Only the owner can trash this file' } }, 403);
        if (add || rem) f.parents = [...(f.parents || []).filter((x) => x !== rem), ...(add && !(f.parents || []).includes(add) ? [add] : [])];
        Object.assign(f, md);
        return J({ id: f.id, trashed: !!f.trashed, parents: f.parents });
      }
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const [mp, c] = parts(body);
      const md = JSON.parse(mp);
      if (md.parents && !canUse(user, files.get(md.parents[0]))) return NF();
      const id = 'f' + (++n);
      files.set(id, { ...md, id, owner: user, perms: [], version: 1, content: Buffer.from(c, 'latin1').toString('utf8'), bytes: Buffer.from(c, 'latin1') });
      grant(user, id);
      return J({ id, name: md.name, version: '1' });
    }
    const up = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (up && method === 'PATCH') {
      const f = files.get(decodeURIComponent(up[1]));
      if (!canUse(user, f)) return NF();
      const [mp, c] = parts(body);
      const md = JSON.parse(mp);
      if (md.trashed === true && f.owner !== user) return J({ error: { code: 403, message: 'Only the owner can trash this file' } }, 403);
      Object.assign(f, md, { version: (f.version || 1) + 1, content: Buffer.from(c, 'latin1').toString('utf8'), bytes: Buffer.from(c, 'latin1') });
      return J({ id: f.id, name: f.name, trashed: !!f.trashed, version: String(f.version) });
    }
    return J({ error: { code: 404, message: 'non simulato ' + method + ' ' + path } }, 404);
  }

  // fetch per i test in Node (stesse regole)
  async function fetchAs(url, opts = {}) {
    let body = Buffer.alloc(0);
    if (opts.body != null) body = typeof opts.body === 'string' ? Buffer.from(opts.body, 'utf8') : Buffer.from(await new Response(opts.body).arrayBuffer());
    const r = handle({ method: opts.method || 'GET', url, auth: opts.headers && opts.headers.Authorization, body });
    if (r.text != null) return new Response(r.text, { status: r.status });
    return new Response(r.json === null ? null : JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }

  return { files, access, names, calls, handle, fetchAs, hasPerm, canUse, grant, isTrashed };
}
