// Navigation interne : l'adresse (#/vue?c=contrat) est mise à jour quand le navigateur le permet ;
// sinon (aperçu intégré dans une page, fichier local), la route est conservée en mémoire.

let memoryHash = null;

export function readHash() {
  return memoryHash ?? location.hash;
}

export function writeHash(hash, { replace = false } = {}) {
  const h = hash.startsWith('#') ? hash : `#${hash}`;
  try {
    history[replace ? 'replaceState' : 'pushState'](null, '', h);
    memoryHash = null;
  } catch {
    memoryHash = h;
  }
}
