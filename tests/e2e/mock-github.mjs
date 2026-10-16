// Serveur GitHub simulé pour les tests : reproduit le sous-ensemble de l'API REST (et GraphQL) utilisé
// par l'application, avec la même sémantique que GitHub : références et contrôle « fast-forward »,
// arbres et blobs adressés par empreinte, API Contents avec contrôle de l'empreinte du fichier
// (409 en cas de conflit), historique des commits filtré par chemin, ETag / 304, CORS, jetons.
import { createHash } from 'node:crypto';
import http from 'node:http';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const blobSha = (text) => { const b = Buffer.from(text, 'utf8'); return sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])); };

export function startMockGitHub({ port = 0, latency = 25, tokens = {}, repos = {} } = {}) {
  // tokens : { jeton: { login, name, email, repos: { 'owner/repo': 'write' | 'read' } } }
  // repos : { 'owner/repo': { private: true, defaultBranch: 'main' } }
  const state = new Map();
  const stats = { requests: 0, writes: 0, conflicts: 0 };
  function repoState(full) {
    if (!state.has(full)) {
      const cfg = repos[full];
      if (!cfg) return null;
      state.set(full, { cfg, blobs: new Map(), trees: new Map(), commits: new Map(), refs: new Map() });
    }
    return state.get(full);
  }
  function putTree(r, map) {
    const entries = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const sha = sha1(`tree ${JSON.stringify(entries)}`);
    r.trees.set(sha, new Map(entries));
    return sha;
  }
  function putCommit(r, { tree, parents, message, user }) {
    const date = new Date().toISOString();
    const sha = sha1(`commit ${tree} ${parents.join(',')} ${message} ${date} ${Math.random()}`);
    r.commits.set(sha, { sha, tree, parents, message, date, user });
    return sha;
  }
  function addBlob(r, text) { const s = blobSha(text); r.blobs.set(s, text); return s; }
  const ancestors = (r, sha) => { const out = new Set(); let cur = sha; while (cur && !out.has(cur)) { out.add(cur); cur = r.commits.get(cur)?.parents[0]; } return out; };

  function send(res, status, data, headers = {}) {
    const body = data === undefined ? '' : JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...headers });
    res.end(body);
  }
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Accept',
    'Access-Control-Expose-Headers': 'ETag, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After',
  };

  const server = http.createServer(async (req, res) => {
    stats.requests++;
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    await new Promise((r) => setTimeout(r, latency));
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { send(res, 400, { message: 'Problems parsing JSON' }); return; }

    // Administration des tests.
    if (p === '/__admin/reset') { state.clear(); Object.assign(stats, { requests: 0, writes: 0, conflicts: 0 }); send(res, 200, { ok: true }); return; }
    if (p === '/__admin/stats') { send(res, 200, stats); return; }
    if (p === '/__admin/files') {
      const r = repoState(url.searchParams.get('repo'));
      const head = r?.refs.get(url.searchParams.get('branch') || r?.cfg.defaultBranch || 'main');
      const tree = head ? r.trees.get(r.commits.get(head).tree) : new Map();
      send(res, 200, Object.fromEntries([...(tree || new Map())].map(([k, s]) => [k, r.blobs.get(s)])));
      return;
    }

    const auth = (req.headers.authorization || '').replace(/^(Bearer|token)\s+/i, '');
    const user = tokens[auth];
    if (!user) { send(res, 401, { message: 'Bad credentials' }); return; }
    if (p === '/user' && req.method === 'GET') { send(res, 200, { login: user.login, name: user.name, email: user.email || null }); return; }

    if (p === '/graphql' && req.method === 'POST') {
      const m = /repository\(owner:\s*"([^"]+)",\s*name:\s*"([^"]+)"\)/.exec(body?.query || '');
      const full = m ? `${m[1]}/${m[2]}` : '';
      const r = repoState(full);
      if (!r || !user.repos?.[full]) { send(res, 200, { data: { repository: null }, errors: [{ message: 'Could not resolve to a Repository' }] }); return; }
      const repo = {};
      for (const a of (body.query.matchAll(/(b\d+):\s*object\(oid:\s*"([0-9a-f]+)"\)/g))) repo[a[1]] = r.blobs.has(a[2]) ? { text: r.blobs.get(a[2]) } : null;
      send(res, 200, { data: { repository: repo } });
      return;
    }

    const rm = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
    if (!rm) { send(res, 404, { message: 'Not Found' }); return; }
    const full = `${decodeURIComponent(rm[1])}/${decodeURIComponent(rm[2])}`;
    const r = repoState(full);
    const access = user.repos?.[full];
    if (!r || !access) { send(res, 404, { message: 'Not Found' }); return; }
    const rest = rm[3] || '';
    const isWrite = req.method !== 'GET';
    if (isWrite && access !== 'write') { send(res, 403, { message: 'Resource not accessible by personal access token' }); return; }
    const defaultBranch = r.cfg.defaultBranch || 'main';

    if (!rest && req.method === 'GET') {
      send(res, 200, { full_name: full, private: r.cfg.private !== false, visibility: r.cfg.private === false ? 'public' : 'private', default_branch: defaultBranch, permissions: { pull: true, push: access === 'write' } });
      return;
    }
    let m;
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(rest)) && req.method === 'GET') {
      if (!r.refs.size) { send(res, 409, { message: 'Git Repository is empty.' }); return; }
      const sha = r.refs.get(decodeURIComponent(m[1]));
      if (!sha) { send(res, 404, { message: 'Not Found' }); return; }
      const etag = `"${sha}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...cors, ETag: etag }); res.end(); return; }
      send(res, 200, { ref: `refs/heads/${m[1]}`, object: { sha, type: 'commit' } }, { ETag: etag });
      return;
    }
    if ((m = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest)) && req.method === 'GET') {
      const c = r.commits.get(m[1]);
      if (!c) { send(res, 404, { message: 'Not Found' }); return; }
      send(res, 200, { sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })), message: c.message, author: { name: c.user.name, date: c.date } });
      return;
    }
    if ((m = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest)) && req.method === 'GET') {
      const t = r.trees.get(m[1]);
      if (!t) { send(res, 404, { message: 'Not Found' }); return; }
      const dirs = new Set();
      for (const path of t.keys()) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
      const entries = [...[...dirs].map((d) => ({ path: d, mode: '040000', type: 'tree', sha: sha1(`dir ${d}`) })), ...[...t].map(([path, s]) => ({ path, mode: '100644', type: 'blob', sha: s, size: Buffer.byteLength(r.blobs.get(s)) }))];
      send(res, 200, { sha: m[1], tree: url.searchParams.get('recursive') ? entries : entries.filter((e) => !e.path.includes('/')), truncated: false });
      return;
    }
    if ((m = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest)) && req.method === 'GET') {
      if (!r.blobs.has(m[1])) { send(res, 404, { message: 'Not Found' }); return; }
      const text = r.blobs.get(m[1]);
      send(res, 200, { sha: m[1], content: Buffer.from(text).toString('base64').replace(/(.{60})/g, '$1\n'), encoding: 'base64', size: Buffer.byteLength(text) });
      return;
    }
    if (rest === '/git/trees' && req.method === 'POST') {
      const baseMap = body.base_tree ? r.trees.get(body.base_tree) : new Map();
      if (!baseMap) { send(res, 422, { message: 'Invalid tree info' }); return; }
      const map = new Map(baseMap);
      for (const e of body.tree || []) {
        if (e.content !== undefined) map.set(e.path, addBlob(r, e.content));
        else if (e.sha === null) map.delete(e.path);
        else if (e.sha) map.set(e.path, e.sha);
      }
      send(res, 201, { sha: putTree(r, map), tree: [] });
      return;
    }
    if (rest === '/git/commits' && req.method === 'POST') {
      if (!r.trees.has(body.tree)) { send(res, 422, { message: 'Tree SHA does not exist' }); return; }
      const sha = putCommit(r, { tree: body.tree, parents: body.parents || [], message: body.message || '', user });
      send(res, 201, { sha, tree: { sha: body.tree }, parents: (body.parents || []).map((s) => ({ sha: s })) });
      return;
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && req.method === 'PATCH') {
      const b = decodeURIComponent(m[1]);
      const cur = r.refs.get(b);
      if (!cur) { send(res, 422, { message: 'Reference does not exist' }); return; }
      if (!r.commits.has(body.sha)) { send(res, 422, { message: 'Object does not exist' }); return; }
      if (!body.force && !ancestors(r, body.sha).has(cur)) { stats.conflicts++; send(res, 422, { message: 'Update is not a fast forward' }); return; }
      r.refs.set(b, body.sha);
      stats.writes++;
      send(res, 200, { ref: `refs/heads/${b}`, object: { sha: body.sha, type: 'commit' } });
      return;
    }
    if (rest === '/git/refs' && req.method === 'POST') {
      const b = String(body.ref || '').replace(/^refs\/heads\//, '');
      if (r.refs.has(b)) { send(res, 422, { message: 'Reference already exists' }); return; }
      r.refs.set(b, body.sha);
      send(res, 201, { ref: body.ref, object: { sha: body.sha, type: 'commit' } });
      return;
    }
    if ((m = /^\/contents\/(.+)$/.exec(rest)) && req.method === 'PUT') {
      const path = m[1].split('/').map(decodeURIComponent).join('/');
      const b = body.branch || defaultBranch;
      const text = Buffer.from(body.content || '', 'base64').toString('utf8');
      if (!r.refs.size) {
        const tree = putTree(r, new Map([[path, addBlob(r, text)]]));
        const sha = putCommit(r, { tree, parents: [], message: body.message, user });
        r.refs.set(defaultBranch, sha);
        stats.writes++;
        send(res, 201, { content: { path, sha: blobSha(text) }, commit: { sha } });
        return;
      }
      const head = r.refs.get(b);
      if (!head) { send(res, 404, { message: `Branch ${b} not found` }); return; }
      const map = new Map(r.trees.get(r.commits.get(head).tree));
      const cur = map.get(path);
      if (cur && !body.sha) { stats.conflicts++; send(res, 422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }); return; }
      if (cur && body.sha !== cur) { stats.conflicts++; send(res, 409, { message: `${path} does not match ${body.sha}` }); return; }
      map.set(path, addBlob(r, text));
      const sha = putCommit(r, { tree: putTree(r, map), parents: [head], message: body.message, user });
      r.refs.set(b, sha);
      stats.writes++;
      send(res, cur ? 200 : 201, { content: { path, sha: blobSha(text) }, commit: { sha } });
      return;
    }
    if (rest === '/commits' && req.method === 'GET') {
      const q = url.searchParams;
      const start = r.refs.get(q.get('sha') || defaultBranch) || q.get('sha');
      if (!start || !r.commits.has(start)) { send(res, r.refs.size ? 404 : 409, { message: r.refs.size ? 'Not Found' : 'Git Repository is empty.' }); return; }
      const path = q.get('path') || '';
      const until = q.get('until') ? Date.parse(q.get('until')) : null;
      const list = [];
      let cur = start;
      while (cur) {
        const c = r.commits.get(cur);
        const t = r.trees.get(c.tree);
        const pt = c.parents[0] ? r.trees.get(r.commits.get(c.parents[0]).tree) : new Map();
        const touched = !path || [...new Set([...t.keys(), ...pt.keys()])].some((k) => (k === path || k.startsWith(`${path}/`)) && t.get(k) !== pt.get(k));
        if (touched && (!until || Date.parse(c.date) <= until)) list.push(c);
        cur = c.parents[0];
      }
      const per = Math.min(100, Number(q.get('per_page')) || 30);
      const page = Math.max(1, Number(q.get('page')) || 1);
      send(res, 200, list.slice((page - 1) * per, page * per).map((c) => ({ sha: c.sha, commit: { message: c.message, author: { name: c.user.name, date: c.date }, committer: { date: c.date } }, author: { login: c.user.login } })));
      return;
    }
    send(res, 404, { message: 'Not Found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const { port: p } = server.address();
    resolve({ url: `http://127.0.0.1:${p}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }), stats });
  }));
}
