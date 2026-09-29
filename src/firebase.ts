import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
const EMPLOYEE_EMAIL_DOMAIN = 'vhws.local';

export const normalizeAccountId = (accountId: string) => accountId.trim().toUpperCase();

export const accountIdToAuthEmail = (accountId: string) => (
  `${normalizeAccountId(accountId).toLowerCase()}@${EMPLOYEE_EMAIL_DOMAIN}`
);

export const accountIdFromAuthEmail = (email: string | null) => {
  if (!email || !email.endsWith(`@${EMPLOYEE_EMAIL_DOMAIN}`)) return null;
  return email.slice(0, email.indexOf('@')).toUpperCase();
};

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const signInWithAccount = (accountId: string, password: string) => (
  signInWithEmailAndPassword(auth, accountIdToAuthEmail(accountId), password)
);
export const logOut = () => signOut(auth);
