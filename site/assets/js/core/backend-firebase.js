// Stockage partagé en temps réel avec Firebase (Authentication + Cloud Firestore).
// Chaque contrat est un document ; chaque modification ne touche que les champs modifiés,
// ce qui permet à plusieurs personnes de travailler en même temps sans écraser le travail des autres.
//
// Arborescence Firestore :
//   seasons/{saison}                 → { settings, counter }
//   seasons/{saison}/contracts/{id}  → { values, createdAt, createdBy, updatedAt, updatedBy, updatedByName }
//   seasons/{saison}/comments/{id}   → { contractId, text, uid, user, ts }
//   seasons/{saison}/history/{id}    → journal des modifications (ajout seul)
//   seasons/{saison}/presence/{uid}  → qui est connecté et sur quelle fiche

const ONLINE_WINDOW_MS = 75000;
const HEARTBEAT_MS = 30000;
const MAX_BATCH = 450;
// Seules les entrées récentes du journal sont suivies en temps réel (quota gratuit Firebase) ;
// les plus anciennes sont chargées à la demande.
const RECENT_HISTORY = 300;

function sanitize(value) {
  if (value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v);
    return out;
  }
  return value;
}

const millis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : null);

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Délai dépassé'), { code: 'unavailable' })), ms))]);
}

export async function createFirebaseBackend(config) {
  const fb = await import('../../../vendor/firebase.js');
  const app = fb.initializeApp(config.firebase);
  const auth = fb.getAuth(app);
  let db;
  try {
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  } catch {
    db = fb.initializeFirestore(app, { localCache: fb.memoryLocalCache() });
  }
  if (config.emulator) {
    const host = config.emulatorHost || '127.0.0.1';
    fb.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    fb.connectFirestoreEmulator(db, host, 8080);
  }

  const sid = String(config.seasonId || '2027');
  const seasonRef = fb.doc(db, 'seasons', sid);
  const col = (name) => fb.collection(db, 'seasons', sid, name);
  const contractsCol = col('contracts');
  const commentsCol = col('comments');
  const historyCol = col('history');
  const presenceCol = col('presence');

  let handlers = null;
  let currentUser = null;
  const pendingDeletes = new Set();
  let presenceInfo = null;
  let heartbeat = null;

  function report(err) {
    console.error('[firebase]', err);
    if (String(err?.code || '').includes('permission-denied')) handlers?.denied?.(err);
    handlers?.error(err);
  }
  const fire = (p) => { Promise.resolve(p).catch(report); };

  function batches() {
    const list = [fb.writeBatch(db)];
    let count = 0;
    return {
      get() {
        if (count >= MAX_BATCH) { list.push(fb.writeBatch(db)); count = 0; }
        count++;
        return list[list.length - 1];
      },
      commit() { for (const b of list) fire(b.commit()); },
    };
  }

  function addHistoryTo(b, entries) {
    for (const h of entries || []) b.get().set(fb.doc(historyCol, h.id), { ...sanitize(h), serverTs: fb.serverTimestamp() });
  }

  function toContract(d) {
    const data = d.data({ serverTimestamps: 'estimate' }) || {};
    return {
      id: d.id,
      values: data.values || {},
      createdAt: millis(data.createdAt),
      createdBy: data.createdBy || null,
      createdByName: data.createdByName || '',
      updatedAt: millis(data.updatedAt),
      updatedBy: data.updatedBy || null,
      updatedByName: data.updatedByName || '',
    };
  }

  function diffKeys(a = {}, b = {}) {
    return Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
  }

  function syncFrom(meta) {
    let status = 'synced';
    if (!navigator.onLine || meta.fromCache) status = 'offline';
    else if (meta.hasPendingWrites) status = 'saving';
    handlers?.sync({ status });
  }

  async function sendPresence() {
    if (!currentUser || !presenceInfo) return;
    try {
      await fb.setDoc(fb.doc(presenceCol, currentUser.uid), sanitize({ ...presenceInfo, uid: currentUser.uid, ts: fb.serverTimestamp(), clientTs: Date.now() }));
    } catch { /* présence non essentielle */ }
  }

  function clearPresence() {
    if (!currentUser) return;
    fb.deleteDoc(fb.doc(presenceCol, currentUser.uid)).catch(() => {});
  }

  let presenceTimer = null;
  function schedulePresence() {
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(sendPresence, 300);
  }

  return {
    kind: 'firebase',
    label: `Firebase · ${config.firebase.projectId || 'projet'}`,

    async init() { await fb.setPersistence(auth, fb.browserLocalPersistence).catch(() => {}); },

    onAuth(cb) {
      return fb.onAuthStateChanged(auth, (u) => {
        currentUser = u ? { uid: u.uid, email: u.email || '', name: u.displayName || u.email || 'Utilisateur' } : null;
        cb(currentUser);
      });
    },
    async signIn(email, password) {
      const cred = await fb.signInWithEmailAndPassword(auth, email.trim(), password);
      return cred.user;
    },
    async signOut() { clearPresence(); await fb.signOut(auth); },
    async resetPassword(email) { await fb.sendPasswordResetEmail(auth, email.trim()); },
    async changePassword(current, next) {
      const u = auth.currentUser;
      if (!u) throw new Error('Non connecté.');
      await fb.reauthenticateWithCredential(u, fb.EmailAuthProvider.credential(u.email, current));
      await fb.updatePassword(u, next);
    },

    async start(h) {
      handlers = h;
      const unsubs = [];
      handlers.sync({ status: 'connecting' });

      unsubs.push(fb.onSnapshot(seasonRef, (snap) => {
        handlers.settings(snap.exists() ? snap.data()?.settings || null : null);
      }, report));

      let prev = new Map();
      let first = true;
      unsubs.push(fb.onSnapshot(contractsCol, { includeMetadataChanges: true }, (snap) => {
        const next = new Map();
        const list = [];
        snap.forEach((d) => { const c = toContract(d); next.set(c.id, c); list.push(c); });
        const changes = [];
        if (!first) {
          for (const [id, c] of next) {
            const p = prev.get(id);
            const remote = c.updatedBy !== currentUser?.uid;
            if (!p) changes.push({ type: 'added', id, remote, by: c.updatedByName });
            else {
              const keys = diffKeys(p.values, c.values);
              if (keys.length) changes.push({ type: 'modified', id, keys, remote, by: c.updatedByName });
              else if (p.updatedBy !== c.updatedBy || Math.abs((p.updatedAt || 0) - (c.updatedAt || 0)) > 5000) changes.push({ type: 'touched', id, remote: false });
            }
          }
          for (const id of prev.keys()) {
            if (!next.has(id)) { changes.push({ type: 'removed', id, remote: !pendingDeletes.has(id) }); pendingDeletes.delete(id); }
          }
        }
        prev = next;
        if (first || changes.length) handlers.contracts(list, changes, { initial: first, fromCache: snap.metadata.fromCache });
        first = false;
        syncFrom(snap.metadata);
      }, report));

      unsubs.push(fb.onSnapshot(commentsCol, (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        handlers.comments(list);
      }, report));

      unsubs.push(fb.onSnapshot(fb.query(historyCol, fb.orderBy('ts', 'desc'), fb.limit(RECENT_HISTORY)), (snap) => {
        const list = [];
        snap.forEach((d) => { const x = d.data(); list.push({ ...x, id: d.id, serverTs: undefined }); });
        handlers.history(list);
      }, report));

      let presenceDocs = [];
      const emitPresence = () => {
        const now = Date.now();
        handlers?.presence(presenceDocs.filter((p) => now - (p.ts || p.clientTs || 0) < ONLINE_WINDOW_MS));
      };
      unsubs.push(fb.onSnapshot(presenceCol, (snap) => {
        presenceDocs = [];
        snap.forEach((d) => { const x = d.data({ serverTimestamps: 'estimate' }); presenceDocs.push({ ...x, uid: d.id, ts: millis(x.ts) || x.clientTs }); });
        emitPresence();
      }, () => {}));
      const presenceTick = setInterval(emitPresence, 20000);

      heartbeat = setInterval(sendPresence, HEARTBEAT_MS);
      const onHide = () => clearPresence();
      const onNet = () => handlers?.sync({ status: navigator.onLine ? 'synced' : 'offline' });
      window.addEventListener('pagehide', onHide);
      window.addEventListener('online', onNet);
      window.addEventListener('offline', onNet);

      return () => {
        unsubs.forEach((u) => u());
        clearInterval(presenceTick); clearInterval(heartbeat);
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('online', onNet);
        window.removeEventListener('offline', onNet);
        handlers = null;
      };
    },

    async ensureSeason(defaults) {
      const created = await withTimeout(fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(seasonRef);
        if (snap.exists() && snap.data()?.settings) return null;
        tx.set(seasonRef, sanitize({ settings: defaults, counter: snap.data()?.counter || 0, createdBy: currentUser?.uid || null }), { merge: true });
        return defaults;
      }), 10000).catch((err) => {
        if (String(err?.code || '').includes('permission-denied')) throw err;
        return null;
      });
      return created;
    },

    async reserveRefs(count) {
      return withTimeout(fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(seasonRef);
        const cur = Number(snap.data()?.counter || 0);
        tx.set(seasonRef, { counter: cur + count }, { merge: true });
        return cur + 1;
      }), 5000);
    },

    async setCounterAtLeast(n) {
      return withTimeout(fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(seasonRef);
        if (Number(snap.data()?.counter || 0) < n) tx.set(seasonRef, { counter: n }, { merge: true });
      }), 5000);
    },

    async createContracts(items, history = [], actor) {
      const b = batches();
      for (const it of items) {
        b.get().set(fb.doc(contractsCol, it.id), {
          values: sanitize(it.values),
          createdAt: fb.serverTimestamp(), createdBy: actor.uid, createdByName: actor.name,
          updatedAt: fb.serverTimestamp(), updatedBy: actor.uid, updatedByName: actor.name,
        });
      }
      addHistoryTo(b, history);
      b.commit();
    },

    async updateContracts(updates, history = [], actor) {
      const b = batches();
      for (const { id, patch } of updates) {
        const fields = { updatedAt: fb.serverTimestamp(), updatedBy: actor.uid, updatedByName: actor.name };
        for (const [k, v] of Object.entries(patch)) fields[`values.${k}`] = sanitize(v);
        b.get().update(fb.doc(contractsCol, id), fields);
      }
      addHistoryTo(b, history);
      b.commit();
    },

    async deleteContracts(ids, history = []) {
      const b = batches();
      for (const id of ids) { pendingDeletes.add(id); b.get().delete(fb.doc(contractsCol, id)); }
      addHistoryTo(b, history);
      b.commit();
    },

    async saveSettings(partial, history = []) {
      const b = batches();
      const fields = { settingsUpdatedAt: fb.serverTimestamp() };
      for (const [k, v] of Object.entries(partial)) fields[`settings.${k}`] = sanitize(v);
      b.get().update(seasonRef, fields);
      addHistoryTo(b, history);
      b.commit();
    },

    async addComment(comment) { fire(fb.setDoc(fb.doc(commentsCol, comment.id), sanitize(comment))); },
    async deleteComment(id) { fire(fb.deleteDoc(fb.doc(commentsCol, id))); },
    async addHistory(entries) { const b = batches(); addHistoryTo(b, entries); b.commit(); },

    /** Entrées du journal : celles d'un contrat, ou une page d'entrées plus anciennes que beforeTs. */
    async loadHistory({ beforeTs = null, contractId = null, max = 500 } = {}) {
      let q;
      if (contractId) q = fb.query(historyCol, fb.where('contractId', '==', contractId));
      else if (beforeTs) q = fb.query(historyCol, fb.orderBy('ts', 'desc'), fb.startAfter(beforeTs), fb.limit(max));
      else q = fb.query(historyCol, fb.orderBy('ts', 'desc'), fb.limit(max));
      const snap = await fb.getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id, serverTs: undefined })).sort((a, b) => b.ts - a.ts);
    },
    historyIsPartial: true,

    setPresence(info) {
      presenceInfo = { ...info };
      schedulePresence();
    },

    async replaceAll({ settings, contracts, comments = [], history = [], counter = 0 }) {
      const [oldContracts, oldComments] = await Promise.all([fb.getDocs(contractsCol), fb.getDocs(commentsCol)]);
      const b = batches();
      oldContracts.forEach((d) => { pendingDeletes.add(d.id); b.get().delete(d.ref); });
      oldComments.forEach((d) => b.get().delete(d.ref));
      b.get().set(seasonRef, sanitize({ settings, counter }), { merge: true });
      const actor = currentUser || { uid: 'inconnu', name: 'Utilisateur' };
      for (const c of contracts) {
        pendingDeletes.delete(c.id);
        b.get().set(fb.doc(contractsCol, c.id), sanitize({
          values: c.values,
          createdAt: c.createdAt || Date.now(), createdBy: c.createdBy || actor.uid, createdByName: c.createdByName || actor.name,
          updatedAt: c.updatedAt || Date.now(), updatedBy: c.updatedBy || actor.uid, updatedByName: c.updatedByName || actor.name,
        }));
      }
      for (const cm of comments) b.get().set(fb.doc(commentsCol, cm.id), sanitize(cm));
      addHistoryTo(b, history);
      b.commit();
    },
  };
}
