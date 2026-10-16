// Point d'entrée du bundle Firebase embarqué dans site/vendor/firebase.js.
// Seules les fonctions utilisées par l'application sont exportées.
export { initializeApp } from 'firebase/app';
export {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updatePassword, reauthenticateWithCredential,
  EmailAuthProvider, connectAuthEmulator, setPersistence, browserLocalPersistence,
} from 'firebase/auth';
export {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  memoryLocalCache, connectFirestoreEmulator,
  collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc,
  writeBatch, serverTimestamp, query, orderBy, limit, where, deleteField, Timestamp,
  runTransaction, increment, onSnapshotsInSync,
} from 'firebase/firestore';
