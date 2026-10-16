// Stockage partagé dans un dépôt GitHub, via l'API GitHub : les données sont des fichiers JSON du dépôt,
// chaque enregistrement est un commit (qui sert aussi de journal inaltérable), et chaque navigateur
// interroge le dépôt toutes les quelques secondes pour afficher les modifications des autres.
//
// Arborescence (dans le dépôt et la branche configurés) :
//   <racine>/<saison>/parametres.json              → paramètres partagés
//   <racine>/<saison>/contrats/<id>.json           → un fichier par compte (ligne du suivi)
//   <racine>/<saison>/commentaires/<id>.json       → commentaires
// Le journal des modifications est écrit dans le message de chaque commit (lignes « journal: {…} »).
//
// Modifications simultanées : chaque modification est une « opération » (champs modifiés d'un compte,
// création, suppression…) mise en file d'attente, appliquée tout de suite à l'écran, puis rejouée sur
// la dernière version du dépôt au moment de l'enregistrement. Si un collègue a enregistré entre-temps,
// l'opération est rejouée sur sa version : deux personnes qui modifient des champs différents d'un même
// compte conservent toutes les deux leur saisie. La file d'attente survit à une coupure réseau.

import { deepClone, safeStorage, uid } from './utils.js';

const TOKEN_KEY = 'saison:gh-token';
const IDENTITY_KEY = 'saison:gh-identity';
const LOCATION_KEY = 'saison:gh-location';
const JOURNAL_MARK = 'journal: ';
const RECENT_COMMITS = 200;
const MAX_ATTEMPTS = 6;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(text) {
  const bytes = enc.encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}
/** Empreinte Git d'un fichier (SHA-1 de « blob <taille>\0<contenu> »), pour reconnaître ses propres écritures. */
export async function gitBlobSha(text) {
  const body = enc.encode(text);
  const head = enc.encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head); all.set(body, head.length);
  const h = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const toJSON = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/** Lieu de stockage effectif : configuration du site, éventuellement remplacée par un lien d'accès. */
export function githubLocation(config) {
  const base = config.github || {};
  const override = safeStorage.get(LOCATION_KEY, null) || {};
  return {
    owner: override.owner || base.owner || '',
    repo: override.repo || base.repo || '',
    branch: override.branch || base.branch || '',
    root: base.root || 'suivi-cm',
    apiBase: (base.apiBase || 'https://api.github.com').replace(/\/$/, ''),
    pollMs: Number(base.pollMs) || 5000,
  };
}

/** Enregistre la clé (et éventuellement le dépôt) transmis par un lien d'accès « #acces=… ». */
export function adoptAccessLink(hash) {
  const m = String(hash || '').replace(/^#/, '');
  if (!/(^|&)acces=/.test(m)) return false;
  const p = new URLSearchParams(m);
  const token = (p.get('acces') || '').trim();
  if (token) safeStorage.set(TOKEN_KEY, token);
  const depot = (p.get('depot') || '').trim();
  if (depot) {
    const [path, branch] = depot.split('@');
    const [owner, repo] = path.split('/');
    if (owner && repo) safeStorage.set(LOCATION_KEY, { owner, repo, branch: branch || '' });
  }
  return !!token;
}

export function accessLink(siteUrl, token, loc) {
  const depot = loc ? `&depot=${encodeURIComponent(`${loc.owner}/${loc.repo}${loc.branch ? `@${loc.branch}` : ''}`)}` : '';
  return `${siteUrl.split('#')[0]}#acces=${encodeURIComponent(token)}${depot}`;
}

function errorFrom(res, data) {
  const msg = (data && data.message) || `Erreur GitHub ${res.status}`;
  const err = new Error(msg);
  err.status = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (res.status === 401) err.code = 'unauthenticated';
  else if (res.status === 429 || (res.status === 403 && (remaining === '0' || /rate limit/i.test(msg)))) {
    err.code = 'rate-limited';
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const after = Number(res.headers.get('retry-after')) * 1000;
    err.waitMs = after || (reset ? Math.max(5000, reset - Date.now()) : 60000);
  } else if (res.status === 403) err.code = 'permission-denied';
  else if (res.status === 404) err.code = 'not-found';
  else if (res.status === 409 && /empty/i.test(msg)) err.code = 'empty';
  else if (res.status === 409 || res.status === 422) err.code = 'conflict';
  else if (res.status >= 500) err.code = 'unavailable';
  return err;
}

/** Entrées du journal contenues dans un message de commit. */
export function parseJournal(message) {
  const out = [];
  for (const line of String(message || '').split('\n')) {
    if (!line.startsWith(JOURNAL_MARK)) continue;
    try { out.push(JSON.parse(line.slice(JOURNAL_MARK.length))); } catch { /* ligne illisible */ }
  }
  return out;
}

/** Message de commit lisible sur GitHub : titre, auteur dans l'application, puis entrées du journal. */
export function commitMessage(entries, actorName) {
  const first = entries[0];
  let title = 'Mise à jour du suivi';
  if (first) {
    const who = first.contractLabel ? `${first.contractLabel} · ` : '';
    if (first.action === 'update') title = `${who}${first.fieldLabel || first.field} : ${first.from || '∅'} → ${first.to || '∅'}`;
    else if (first.action === 'create') title = `${who}création`;
    else if (first.action === 'delete') title = `${who}suppression`;
    else if (first.action === 'comment') title = `${who}commentaire`;
    else if (first.to) title = `${who}${first.to}`;
  }
  title = title.replace(/\s+/g, ' ').slice(0, 110) + (entries.length > 1 ? ` (+${entries.length - 1})` : '');
  const lines = entries.filter((e) => e && e.id).map((e) => JOURNAL_MARK + JSON.stringify(e));
  return `${title}\n\nPar : ${actorName || 'Utilisateur'}${lines.length ? `\n\n${lines.join('\n')}` : ''}\n`;
}

export function createGithubBackend(config) {
  const loc = githubLocation(config);
  const season = String(config.seasonId || '2027');
  const base = `${loc.root}/${season}`;
  const paths = {
    settings: `${base}/parametres.json`,
    activity: `${base}/activite.json`,
    contract: (id) => `${base}/contrats/${id}.json`,
    comment: (id) => `${base}/commentaires/${id}.json`,
  };
  const repoPath = `/repos/${encodeURIComponent(loc.owner)}/${encodeURIComponent(loc.repo)}`;
  const storeKey = `${loc.owner}/${loc.repo}@${loc.branch || '~'}/${base}`;
  const cacheKey = `saison:gh-cache:${storeKey}`;
  const queueKey = `saison:gh-queue:${storeKey}`;
  const tabId = uid(8);

  let token = safeStorage.get(TOKEN_KEY, '') || '';
  let identity = safeStorage.get(IDENTITY_KEY, null);
  let branch = loc.branch;
  let repoInfo = null;
  let handlers = null;
  let stopped = false;

  // État du dépôt (dernière version lue) et file d'attente locale.
  let head = null;
  let headEtag = null;
  let files = new Map(); // chemin → empreinte du fichier
  const parsed = new Map(); // empreinte → objet JSON
  const blobs = new Map(Object.entries(safeStorage.get(cacheKey, {}) || {})); // empreinte → texte
  let queue = [];
  let lastView = { settings: null, contracts: new Map(), comments: new Map() };
  let history = [];
  const listedCommits = new Set(); // commits déjà lus dans l'historique
  const ownCommits = new Set(); // commits créés par cet onglet (journal déjà connu)
  let flushing = false;
  let flushTimer = null;
  let pollTimer = null;
  let waitUntil = 0;
  let status = 'connecting';
  let lastReported = new Map();

  /* ------------------------------------------------------------- Appels */

  async function api(method, path, { body, etag } = {}) {
    if (!token) throw Object.assign(new Error('Aucune clé d’accès.'), { code: 'unauthenticated' });
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-None-Match'] = etag;
    let res;
    try {
      res = await fetch(`${loc.apiBase}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (cause) {
      throw Object.assign(new Error('Connexion à GitHub impossible.'), { code: 'unavailable', cause });
    }
    if (res.status === 304) return { status: 304, data: null, etag };
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if (!res.ok) throw errorFrom(res, data);
    return { status: res.status, data, etag: res.headers.get('etag') };
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    handlers?.sync({ status: next });
  }

  function notify(err) {
    const key = String(err?.code || err?.message || err);
    const now = Date.now();
    if (now - (lastReported.get(key) || 0) < 4000) return;
    lastReported.set(key, now);
    handlers?.error(err);
  }

  /* ------------------------------------------------------------ Lecture */

  function persistCache() {
    const keep = {};
    const live = new Set(files.values());
    for (const sha of live) if (blobs.has(sha)) keep[sha] = blobs.get(sha);
    safeStorage.set(cacheKey, keep);
  }
  let cacheTimer = null;
  const scheduleCache = () => { clearTimeout(cacheTimer); cacheTimer = setTimeout(persistCache, 1500); cacheTimer.unref?.(); };

  async function fetchBlobs(shas) {
    const missing = [...new Set(shas)].filter((s) => !blobs.has(s));
    if (!missing.length) return;
    // Par lots via l'API GraphQL (une requête pour 50 fichiers), sinon fichier par fichier.
    if (missing.length > 3) {
      try {
        for (let i = 0; i < missing.length; i += 50) {
          const chunk = missing.slice(i, i + 50);
          const query = `query { repository(owner: ${JSON.stringify(loc.owner)}, name: ${JSON.stringify(loc.repo)}) { ${chunk.map((s, j) => `b${j}: object(oid: ${JSON.stringify(s)}) { ... on Blob { text } }`).join(' ')} } }`;
          const r = await api('POST', '/graphql', { body: { query } });
          const repo = r.data?.data?.repository;
          if (!repo) throw new Error('GraphQL indisponible');
          chunk.forEach((s, j) => { const t = repo[`b${j}`]?.text; if (typeof t === 'string') blobs.set(s, t); });
        }
      } catch (err) {
        if (err.code === 'unauthenticated' || err.code === 'unavailable') throw err;
      }
    }
    const rest = missing.filter((s) => !blobs.has(s));
    for (let i = 0; i < rest.length; i += 8) {
      await Promise.all(rest.slice(i, i + 8).map(async (s) => {
        const r = await api('GET', `${repoPath}/git/blobs/${s}`);
        blobs.set(s, r.data.encoding === 'base64' ? b64decode(r.data.content) : String(r.data.content || ''));
      }));
    }
    scheduleCache();
  }

  function parseBlob(sha) {
    if (parsed.has(sha)) return parsed.get(sha);
    let v = null;
    try { v = JSON.parse(blobs.get(sha)); } catch { v = null; }
    parsed.set(sha, v);
    return v;
  }

  async function readTree(commitSha) {
    const commit = (await api('GET', `${repoPath}/git/commits/${commitSha}`)).data;
    const tree = (await api('GET', `${repoPath}/git/trees/${commit.tree.sha}?recursive=1`)).data;
    let entries = tree.tree || [];
    if (tree.truncated) {
      // Très gros dépôt : on ne lit que le dossier des données.
      let sha = commit.tree.sha;
      for (const seg of base.split('/')) {
        const t = (await api('GET', `${repoPath}/git/trees/${sha}`)).data;
        const e = (t.tree || []).find((x) => x.path === seg && x.type === 'tree');
        if (!e) return { treeSha: commit.tree.sha, files: new Map() };
        sha = e.sha;
      }
      entries = ((await api('GET', `${repoPath}/git/trees/${sha}?recursive=1`)).data.tree || []).map((e) => ({ ...e, path: `${base}/${e.path}` }));
    }
    const out = new Map();
    for (const e of entries) if (e.type === 'blob' && e.path.startsWith(`${base}/`) && e.path.endsWith('.json')) out.set(e.path, e.sha);
    return { treeSha: commit.tree.sha, files: out };
  }

  function remoteState() {
    const st = { settings: null, contracts: new Map(), comments: new Map() };
    for (const [p, sha] of files) {
      const v = parseBlob(sha);
      if (!v) continue;
      if (p === paths.settings) st.settings = v.settings || v;
      else if (p.startsWith(`${base}/contrats/`) && v.id) st.contracts.set(v.id, v);
      else if (p.startsWith(`${base}/commentaires/`) && v.id) st.comments.set(v.id, v);
    }
    return st;
  }

  /**
   * Lit la dernière version du dépôt ; renvoie vrai si elle a changé. Les lectures sont faites l'une après
   * l'autre : une lecture plus ancienne ne peut pas se terminer après une plus récente et la remplacer.
   */
  let readChain = Promise.resolve();
  function exclusive(fn) {
    const p = readChain.then(fn);
    readChain = p.catch(() => {});
    return p;
  }
  const refresh = (opts) => exclusive(() => readLatest(opts));
  async function readLatest({ force = false } = {}) {
    const r = await api('GET', `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`, { etag: force ? null : headEtag });
    if (r.status === 304) return false;
    const sha = r.data.object.sha;
    if (sha === head && !force) { headEtag = r.etag; return false; }
    const t = await readTree(sha);
    await fetchBlobs([...t.files.values()]);
    const prevHead = head;
    head = sha;
    files = t.files;
    // Repère de version enregistré seulement une fois la lecture complète.
    headEtag = r.etag;
    await refreshHistory(prevHead);
    return true;
  }

  /* ------------------------------------------------------------ Journal */

  function entriesOf(commit) {
    const message = commit.commit?.message || '';
    const list = parseJournal(message);
    if (list.length) return list;
    // Commit fait en dehors de l'application (édition directe sur GitHub) : une entrée générique.
    const date = Date.parse(commit.commit?.author?.date || commit.commit?.committer?.date || '') || Date.now();
    return [{ id: `gh-${commit.sha}`, ts: date, uid: commit.author?.login || '', user: commit.commit?.author?.name || commit.author?.login || 'GitHub', action: 'external', to: message.split('\n')[0] }];
  }

  async function listCommits(params) {
    const q = new URLSearchParams({ sha: branch, per_page: '100', ...params });
    const r = await api('GET', `${repoPath}/commits?${q}`);
    return Array.isArray(r.data) ? r.data : [];
  }

  async function refreshHistory(prevHead) {
    const fresh = [];
    for (let page = 1; page <= (prevHead ? 3 : Math.ceil(RECENT_COMMITS / 100)); page++) {
      const list = await listCommits({ path: base, page: String(page), per_page: prevHead ? '30' : '100' });
      let reached = false;
      for (const c of list) {
        if (listedCommits.has(c.sha)) { reached = true; break; }
        listedCommits.add(c.sha);
        if (!ownCommits.has(c.sha)) fresh.push(...entriesOf(c));
      }
      if (reached || list.length < (prevHead ? 30 : 100)) break;
    }
    addHistory(fresh);
  }

  function addHistory(entries) {
    if (!entries.length) return;
    const seen = new Set(history.map((h) => h.id));
    history = [...entries.filter((h) => h.id && !seen.has(h.id)), ...history].sort((a, b) => b.ts - a.ts).slice(0, 800);
  }

  /* --------------------------------------------------- File d'attente */

  function persistQueue() {
    if (queue.length) safeStorage.set(`${queueKey}:${tabId}`, { ts: Date.now(), ops: queue });
    else safeStorage.remove(`${queueKey}:${tabId}`);
  }

  /** Reprend les modifications non envoyées d'un onglet fermé ou d'une session précédente. */
  function adoptOrphanQueues() {
    let keys = [];
    try { keys = Object.keys(globalThis.localStorage).filter((k) => k.startsWith(`${queueKey}:`)); } catch { keys = []; }
    for (const k of keys) {
      const q = safeStorage.get(k, null);
      if (!q || !Array.isArray(q.ops)) { safeStorage.remove(k); continue; }
      if (Date.now() - (q.ts || 0) < 45000 && !k.endsWith(`:${tabId}`)) continue; // onglet encore ouvert
      queue.push(...q.ops);
      safeStorage.remove(k);
    }
    persistQueue();
  }
  const heartbeat = setInterval(() => { if (queue.length) persistQueue(); }, 20000);
  heartbeat.unref?.();

  function enqueue(op) {
    queue.push({ ...op, opId: uid(10) });
    persistQueue();
    emit('local');
    scheduleFlush(600);
  }

  /** Applique une opération à un état (contrats, paramètres, commentaires) ; renvoie faux si elle est caduque. */
  function applyOp(st, op) {
    switch (op.t) {
      case 'create': st.contracts.set(op.doc.id, deepClone(op.doc)); return true;
      case 'update': {
        const c = st.contracts.get(op.id);
        if (!c) return false;
        st.contracts.set(op.id, { ...c, values: { ...c.values, ...deepClone(op.patch) }, ...op.stamp });
        return true;
      }
      case 'delete': st.contracts.delete(op.id); return true;
      case 'settings': st.settings = { ...(st.settings || {}), ...deepClone(op.partial) }; return true;
      case 'comment': st.comments.set(op.comment.id, deepClone(op.comment)); return true;
      case 'uncomment': st.comments.delete(op.id); return true;
      case 'replaceAll':
        st.settings = deepClone(op.settings);
        st.contracts = new Map(op.contracts.map((c) => [c.id, deepClone(c)]));
        st.comments = new Map(op.comments.map((c) => [c.id, deepClone(c)]));
        return true;
      case 'history': return true;
      default: return true;
    }
  }

  function currentView() {
    const st = remoteState();
    for (const op of queue) applyOp(st, op);
    return st;
  }

  /** Transmet à l'application l'état affiché (dépôt + modifications en attente) et ce qui a changé. */
  function emit(source = 'remote') {
    if (!handlers) return;
    const next = currentView();
    const prev = lastView;
    const changes = [];
    for (const [id, c] of next.contracts) {
      const p = prev.contracts.get(id);
      if (!p) changes.push({ type: 'added', id, remote: source === 'remote', by: c.updatedByName });
      else if (JSON.stringify(p) !== JSON.stringify(c)) {
        const keys = Object.keys({ ...p.values, ...c.values }).filter((k) => JSON.stringify(p.values[k] ?? null) !== JSON.stringify(c.values[k] ?? null));
        changes.push(keys.length ? { type: 'modified', id, keys, remote: source === 'remote', by: c.updatedByName } : { type: 'touched', id, remote: false });
      }
    }
    for (const id of prev.contracts.keys()) if (!next.contracts.has(id)) changes.push({ type: 'removed', id, remote: source === 'remote' });
    const settingsChanged = JSON.stringify(prev.settings) !== JSON.stringify(next.settings);
    const commentsChanged = JSON.stringify([...prev.comments.values()]) !== JSON.stringify([...next.comments.values()]);
    const first = !emit.done;
    lastView = next;
    emit.done = true;
    if (first || settingsChanged) handlers.settings(deepClone(next.settings));
    if (first || changes.length) handlers.contracts([...next.contracts.values()].map(deepClone), changes, { initial: first });
    if (first || commentsChanged) handlers.comments([...next.comments.values()].map(deepClone));
    const pendingHistory = queue.flatMap((op) => op.history || []);
    handlers.history([...pendingHistory].reverse().concat(history).slice(0, 800));
  }

  /* --------------------------------------------------------- Écriture */

  function scheduleFlush(ms = 600) {
    if (flushTimer || stopped) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, Math.max(ms, waitUntil - Date.now()));
    flushTimer.unref?.();
  }

  /** Contenu des fichiers à écrire pour un lot d'opérations, rejoué sur la version actuelle du dépôt. */
  function materialize(ops) {
    const before = remoteState();
    const after = remoteState();
    const dropped = [];
    for (const op of ops) if (!applyOp(after, op)) dropped.push(op);
    const writes = new Map();
    const deletes = new Set();
    const settingsText = after.settings ? toJSON({ settings: after.settings }) : null;
    if (settingsText && JSON.stringify(after.settings) !== JSON.stringify(before.settings)) writes.set(paths.settings, settingsText);
    for (const [id, c] of after.contracts) {
      if (JSON.stringify(before.contracts.get(id)) !== JSON.stringify(c)) writes.set(paths.contract(id), toJSON(c));
    }
    for (const id of before.contracts.keys()) if (!after.contracts.has(id) && files.has(paths.contract(id))) deletes.add(paths.contract(id));
    for (const [id, c] of after.comments) if (JSON.stringify(before.comments.get(id)) !== JSON.stringify(c)) writes.set(paths.comment(id), toJSON(c));
    for (const id of before.comments.keys()) if (!after.comments.has(id) && files.has(paths.comment(id))) deletes.add(paths.comment(id));
    const history = ops.filter((op) => !dropped.includes(op)).flatMap((op) => op.history || []);
    // Évènement sans modification de données (ex. relance préparée) : une trace datée pour qu'il figure au journal.
    if (!writes.size && !deletes.size && history.length) writes.set(paths.activity, toJSON({ ts: Date.now(), user: history[0].user || '', action: history[0].action, label: history[0].to || '' }));
    return { writes, deletes, history, dropped };
  }

  async function rememberWrites(writes) {
    for (const [p, text] of writes) {
      const sha = await gitBlobSha(text);
      blobs.set(sha, text);
      files.set(p, sha);
    }
  }

  async function commitTree(writes, deletes, message) {
    const commit = (await api('GET', `${repoPath}/git/commits/${head}`)).data;
    const tree = [
      ...[...writes].map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      ...[...deletes].map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
    ];
    const newTree = (await api('POST', `${repoPath}/git/trees`, { body: { base_tree: commit.tree.sha, tree } })).data;
    const newCommit = (await api('POST', `${repoPath}/git/commits`, { body: { message, tree: newTree.sha, parents: [head] } })).data;
    await api('PATCH', `${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`, { body: { sha: newCommit.sha, force: false } });
    head = newCommit.sha;
    headEtag = null;
    for (const p of deletes) files.delete(p);
    await rememberWrites(writes);
    ownCommits.add(newCommit.sha);
  }

  async function putFile(path, content, message) {
    const sha = files.get(path);
    const r = await api('PUT', `${repoPath}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      body: { message, content: b64encode(content), branch, ...(sha ? { sha } : {}) },
    });
    // Le commit a été créé par GitHub au-dessus de la dernière version (éventuellement plus récente que la nôtre).
    if (r.data?.commit?.sha) ownCommits.add(r.data.commit.sha);
    await rememberWrites(new Map([[path, content]]));
  }

  async function flush() {
    if (flushing || stopped || !queue.length) return;
    if (Date.now() < waitUntil) { scheduleFlush(waitUntil - Date.now()); return; }
    flushing = true;
    setStatus('saving');
    const batch = queue.slice(0, 400);
    try {
      let attempt = 0;
      for (;;) {
        attempt++;
        // Lecture de la dernière version puis écriture, sans qu'une autre lecture s'intercale.
        const outcome = await exclusive(async () => {
          await readLatest();
          const { writes, deletes, history: entries, dropped } = materialize(batch);
          if (dropped.length) {
            notify(Object.assign(new Error('Ce compte a été supprimé par un collègue : la modification n’a pas pu être enregistrée.'), { code: 'deleted-by-peer' }));
          }
          const actorName = batch.find((op) => op.actor)?.actor || identity?.name || '';
          try {
            if (writes.size || deletes.size) {
              const message = commitMessage(entries, actorName);
              const single = writes.size === 1 && !deletes.size && entries.length < 60;
              if (single) { const [[p, content]] = [...writes]; await putFile(p, content, message); } else await commitTree(writes, deletes, message);
              addHistory(entries);
            }
            return 'ok';
          } catch (err) {
            if (err.code === 'conflict' && attempt < MAX_ATTEMPTS) { headEtag = null; return 'retry'; }
            throw err;
          }
        });
        if (outcome === 'ok') break;
        await sleep(150 * attempt + Math.random() * 300);
      }
      const done = new Set(batch.map((op) => op.opId));
      queue = queue.filter((op) => !done.has(op.opId));
      persistQueue();
      scheduleCache();
      emit('local');
      setStatus(queue.length ? 'saving' : 'synced');
    } catch (err) {
      handleError(err, 'write');
    } finally {
      flushing = false;
      if (queue.length) scheduleFlush(status === 'offline' ? 8000 : 400);
    }
  }

  function handleError(err, phase) {
    // Réseau coupé, droits ou quota : situations prévues, signalées à l'écran ; le reste est une vraie erreur.
    (['unavailable', 'rate-limited', 'permission-denied', 'not-found', 'unauthenticated'].includes(err.code) ? console.warn : console.error)('[github]', phase, err);
    if (err.code === 'unavailable') { setStatus('offline'); return; }
    if (err.code === 'rate-limited') {
      waitUntil = Date.now() + (err.waitMs || 60000);
      setStatus('offline');
      notify(Object.assign(new Error(`Limite de requêtes GitHub atteinte : reprise automatique vers ${new Date(waitUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. Les modifications sont conservées.`), { code: 'rate-limited' }));
      return;
    }
    if (err.code === 'unauthenticated') { setStatus('error'); handlers?.authLost?.(err); return; }
    if (err.code === 'permission-denied' || err.code === 'not-found') {
      setStatus('error');
      notify(Object.assign(new Error(phase === 'write'
        ? 'Enregistrement refusé par GitHub : votre clé d’accès ne permet pas de modifier ce dépôt (droit « Contents : Read and write » nécessaire). Vos modifications restent en attente sur ce poste.'
        : 'Accès au dépôt refusé : vérifiez la clé d’accès et le dépôt configuré.'), { code: 'permission-denied' }));
      if (phase === 'read') handlers?.denied?.(err);
      waitUntil = Date.now() + 30000;
      return;
    }
    setStatus('error');
    notify(err);
  }

  /* -------------------------------------------------------- Interrogation */

  async function poll() {
    pollTimer = null;
    if (stopped) return;
    try {
      if (Date.now() >= waitUntil) {
        const changed = await refresh();
        if (changed) emit('remote');
        if (!queue.length && !flushing) setStatus('synced');
      }
    } catch (err) {
      handleError(err, 'read');
    }
    if (queue.length && !flushing) scheduleFlush(200);
    schedulePoll();
  }
  function schedulePoll(ms) {
    if (stopped || pollTimer) return;
    const hidden = globalThis.document?.visibilityState === 'hidden';
    pollTimer = setTimeout(poll, ms ?? (hidden ? Math.max(30000, loc.pollMs) : loc.pollMs));
    pollTimer.unref?.();
  }
  function pollNow() { clearTimeout(pollTimer); pollTimer = null; schedulePoll(0); }

  /* ------------------------------------------------------- Initialisation */

  async function resolveRepo() {
    repoInfo = (await api('GET', repoPath)).data;
    if (!branch) branch = repoInfo.default_branch || 'main';
    return repoInfo;
  }

  /** Crée la branche (orpheline) ou le premier commit d'un dépôt vide, avec les paramètres par défaut. */
  async function initialize(defaults) {
    const readme = `# Données du suivi de la saison contractuelle\n\nCe dossier est géré par l’application de suivi : ne le modifiez pas à la main.\n\n- \`${base}/parametres.json\` : paramètres partagés\n- \`${base}/contrats/\` : un fichier par compte\n- \`${base}/commentaires/\` : commentaires\n\nL’historique des modifications se lit dans l’historique des commits.\n`;
    const message = commitMessage([{ id: uid(), ts: Date.now(), uid: identity?.uid || '', user: identity?.name || '', action: 'settings', fieldLabel: 'Saison', to: `Initialisation de la saison ${season}` }], identity?.name);
    let r = null;
    try { r = await api('GET', `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`); } catch (err) {
      if (err.code === 'empty') {
        await api('PUT', `${repoPath}/contents/${paths.settings.split('/').map(encodeURIComponent).join('/')}`, { body: { message, content: b64encode(toJSON({ settings: defaults })) } });
        await api('PUT', `${repoPath}/contents/${encodeURIComponent(loc.root)}/LISEZMOI.md`, { body: { message: 'Notice du dossier de données', content: b64encode(readme) } }).catch(() => {});
        return true;
      }
      if (err.code !== 'not-found') throw err;
    }
    if (!r) {
      const tree = (await api('POST', `${repoPath}/git/trees`, { body: { tree: [
        { path: paths.settings, mode: '100644', type: 'blob', content: toJSON({ settings: defaults }) },
        { path: `${loc.root}/LISEZMOI.md`, mode: '100644', type: 'blob', content: readme },
      ] } })).data;
      const commit = (await api('POST', `${repoPath}/git/commits`, { body: { message, tree: tree.sha, parents: [] } })).data;
      await api('POST', `${repoPath}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
      return true;
    }
    return false;
  }

  return {
    kind: 'github',
    get label() { return `GitHub · ${loc.owner}/${loc.repo}`; },
    location: loc,
    get repoInfo() { return repoInfo; },
    get branch() { return branch; },
    get token() { return token; },
    historyIsPartial: true,

    async init() {},

    onAuth(cb) {
      queueMicrotask(async () => {
        if (!token) { cb(null); return; }
        try {
          const u = (await api('GET', '/user')).data;
          identity = { uid: u.login, login: u.login, email: u.email || '', name: u.name || u.login };
          safeStorage.set(IDENTITY_KEY, identity);
          cb(identity);
        } catch (err) {
          if (err.code === 'unavailable' && identity) { cb(identity); return; }
          if (err.code === 'unauthenticated') { safeStorage.remove(TOKEN_KEY); token = ''; cb(null, Object.assign(new Error('La clé d’accès a expiré ou a été révoquée. Saisissez une nouvelle clé.'), { code: 'unauthenticated' })); return; }
          cb(null, err);
        }
      });
      return () => {};
    },

    async signIn(newToken) {
      const t = String(newToken || '').trim();
      if (!t) throw Object.assign(new Error('Saisissez votre clé d’accès.'), { code: 'invalid' });
      token = t;
      try {
        const u = (await api('GET', '/user')).data;
        await resolveRepo();
        identity = { uid: u.login, login: u.login, email: u.email || '', name: u.name || u.login };
        safeStorage.set(TOKEN_KEY, t);
        safeStorage.set(IDENTITY_KEY, identity);
        return identity;
      } catch (err) {
        token = safeStorage.get(TOKEN_KEY, '') || '';
        if (err.code === 'unauthenticated') throw Object.assign(new Error('Clé d’accès refusée par GitHub (clé incorrecte, expirée ou révoquée).'), { code: 'unauthenticated' });
        if (err.code === 'not-found') throw Object.assign(new Error(`Le dépôt ${loc.owner}/${loc.repo} est introuvable avec cette clé : vérifiez que la clé donne accès à ce dépôt.`), { code: 'not-found' });
        throw err;
      }
    },
    async signOut() {
      stopped = true;
      safeStorage.remove(TOKEN_KEY);
      safeStorage.remove(IDENTITY_KEY);
      safeStorage.remove(cacheKey);
      persistQueue();
      token = '';
    },
    async resetPassword() {},
    async changePassword() { throw new Error('La clé d’accès se gère sur GitHub (Paramètres › Developer settings › Fine-grained tokens).'); },

    async ensureSeason(defaults) {
      await resolveRepo();
      let created = await initialize(defaults);
      await refresh({ force: true });
      if (!files.has(paths.settings)) {
        await putFile(paths.settings, toJSON({ settings: defaults }), commitMessage([{ id: uid(), ts: Date.now(), uid: identity?.uid || '', user: identity?.name || '', action: 'settings', fieldLabel: 'Saison', to: `Initialisation de la saison ${season}` }], identity?.name));
        await refresh({ force: true });
        created = true;
      }
      return created ? defaults : null;
    },

    async start(h) {
      handlers = h;
      handlers.presence([]);
      adoptOrphanQueues();
      try {
        if (!head) await refresh({ force: true });
        setStatus(queue.length ? 'saving' : 'synced');
      } catch (err) { handleError(err, 'read'); }
      emit('remote');
      if (queue.length) scheduleFlush(300);
      schedulePoll();
      const doc = globalThis.document;
      const win = globalThis.window;
      const onVisible = () => { if (doc.visibilityState === 'visible') pollNow(); };
      const onOnline = () => { waitUntil = 0; pollNow(); scheduleFlush(200); };
      // Onglet fermé : sa file d'attente peut être reprise tout de suite par le prochain onglet ouvert.
      const onHide = () => { if (queue.length) safeStorage.set(`${queueKey}:${tabId}`, { ts: 0, ops: queue }); };
      doc?.addEventListener('visibilitychange', onVisible);
      win?.addEventListener('online', onOnline);
      win?.addEventListener('pagehide', onHide);
      return () => {
        stopped = true;
        clearTimeout(pollTimer); clearTimeout(flushTimer); clearInterval(heartbeat);
        doc?.removeEventListener('visibilitychange', onVisible);
        win?.removeEventListener('online', onOnline);
        win?.removeEventListener('pagehide', onHide);
        handlers = null;
      };
    },

    /** Prochain numéro de référence libre (les doublons éventuels sont corrigés par l'application). */
    async reserveRefs() {
      let max = 0;
      for (const c of lastView.contracts.values()) {
        const m = String(c.values?.ref || '').match(/(\d+)\s*$/);
        if (m) max = Math.max(max, Number(m[1]));
      }
      return max + 1;
    },
    async setCounterAtLeast() {},

    async createContracts(items, history = [], actor) {
      const now = Date.now();
      for (const [i, it] of items.entries()) {
        enqueue({
          t: 'create',
          doc: {
            id: it.id, values: deepClone(it.values),
            createdAt: it.createdAt || now, createdBy: it.createdBy || actor.uid, createdByName: it.createdByName || actor.name,
            updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name,
          },
          history: i === 0 ? history : [],
          actor: actor.name,
        });
      }
      if (!items.length && history.length) enqueue({ t: 'history', history, actor: actor.name });
    },

    async updateContracts(updates, history = [], actor) {
      const now = Date.now();
      const byId = new Map();
      for (const h of history) { if (!byId.has(h.contractId)) byId.set(h.contractId, []); byId.get(h.contractId).push(h); }
      const orphan = history.filter((h) => !updates.some((u) => u.id === h.contractId));
      updates.forEach(({ id, patch }, i) => enqueue({
        t: 'update', id, patch: deepClone(patch), stamp: { updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name },
        history: [...(byId.get(id) || []), ...(i === 0 ? orphan : [])], actor: actor.name,
      }));
      if (!updates.length && history.length) enqueue({ t: 'history', history, actor: actor.name });
    },

    async deleteContracts(ids, history = []) {
      ids.forEach((id, i) => enqueue({ t: 'delete', id, history: i === 0 ? history : [], actor: identity?.name }));
    },

    async saveSettings(partial, history = []) {
      enqueue({ t: 'settings', partial: deepClone(partial), history, actor: identity?.name });
    },

    async addComment(comment) { enqueue({ t: 'comment', comment: deepClone(comment), history: [], actor: comment.user }); },
    async deleteComment(id) { enqueue({ t: 'uncomment', id, history: [], actor: identity?.name }); },
    async addHistory(entries) { enqueue({ t: 'history', history: entries, actor: entries[0]?.user || identity?.name }); },

    /** Entrées du journal : celles d'un compte, ou une page d'entrées plus anciennes que beforeTs. */
    async loadHistory({ beforeTs = null, beforeId = null, contractId = null, max = 500 } = {}) {
      const out = [];
      if (contractId) {
        for (let page = 1; page <= 3; page++) {
          const list = await listCommits({ path: paths.contract(contractId), page: String(page) });
          for (const c of list) out.push(...entriesOf(c).filter((e) => e.contractId === contractId || e.action === 'external'));
          if (list.length < 100) break;
        }
        // Entrées de journal portées par des commits groupés (ex. collage sur plusieurs comptes).
        out.push(...history.filter((h) => h.contractId === contractId));
        const seen = new Set();
        return out.filter((h) => !seen.has(h.id) && seen.add(h.id)).sort((a, b) => b.ts - a.ts);
      }
      const until = beforeTs ? new Date(beforeTs + 1000).toISOString() : null;
      for (let page = 1; page <= 20 && out.length < max; page++) {
        const list = await listCommits({ path: base, page: String(page), ...(until ? { until } : {}) });
        for (const c of list) out.push(...entriesOf(c));
        if (list.length < 100) break;
      }
      const after = (h) => !beforeTs || h.ts < beforeTs || (h.ts === beforeTs && beforeId && h.id < beforeId);
      return out.filter(after).sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1)).slice(0, max);
    },

    setPresence() {},

    async replaceAll({ settings, contracts, comments = [], history = [] }) {
      const now = Date.now();
      const actorName = identity?.name || 'Utilisateur';
      enqueue({
        t: 'replaceAll',
        settings: deepClone(settings),
        contracts: contracts.map((c) => ({
          id: c.id, values: deepClone(c.values || {}),
          createdAt: c.createdAt || now, createdBy: c.createdBy || identity?.uid || '', createdByName: c.createdByName || actorName,
          updatedAt: c.updatedAt || now, updatedBy: c.updatedBy || identity?.uid || '', updatedByName: c.updatedByName || actorName,
        })),
        comments: deepClone(comments),
        history: history.slice(0, 50),
        actor: actorName,
      });
    },

    /** Force une lecture immédiate du dépôt (bouton « Actualiser »). */
    refreshNow() { pollNow(); },
    pendingCount: () => queue.length,
  };
}
