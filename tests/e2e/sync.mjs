// Lance l'émulateur Firebase (Auth + Firestore) avec des règles de test, puis le scénario à deux utilisateurs.
// Prérequis : Java 21+ ; la CLI Firebase est téléchargée par npx si FIREBASE_BIN n'est pas défini.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'saison-emu-'));
const rules = readFileSync(join(root, 'firebase/firestore.rules'), 'utf8')
  .replace(/\/\/ ALLOWED_EMAILS — début[\s\S]*?\/\/ ALLOWED_EMAILS — fin/, "'claire@test.local', 'julien@test.local'");
writeFileSync(join(dir, 'firestore.rules'), rules);
writeFileSync(join(dir, 'firebase.json'), JSON.stringify({
  firestore: { rules: 'firestore.rules' },
  emulators: { auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8080 }, ui: { enabled: false }, singleProjectMode: true },
}, null, 2));
const bin = process.env.FIREBASE_BIN ? [process.env.FIREBASE_BIN] : ['npx', '-y', 'firebase-tools@latest'];
const cmd = `node ${JSON.stringify(join(root, 'tests/e2e/run-sync.mjs'))}`;
const res = spawnSync(bin[0], [...bin.slice(1), 'emulators:exec', '--only', 'auth,firestore', '--project', 'demo-saison', '--config', join(dir, 'firebase.json'), cmd], { stdio: 'inherit', cwd: dir, env: process.env });
process.exit(res.status ?? 1);
