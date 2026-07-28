// src/services/CIDRegistryService.ts
//
// Lightweight Firestore registry that maps proposalId → latest comment thread CID.
// Solves cross-device comment discovery without Cardano transactions.
// Later: this same Firebase project will handle Discord discussion sync.

import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db  = getFirestore(app);

const COLLECTION = 'comment_cids';

class CIDRegistryService {
  async setCID(proposalId: string, cid: string): Promise<void> {
    try {
      await setDoc(doc(db, COLLECTION, proposalId), {
        cid,
        proposalId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn('[CIDRegistry] Write failed (non-fatal):', error);
    }
  }

  async getCID(proposalId: string): Promise<string | null> {
    try {
      const snap = await getDoc(doc(db, COLLECTION, proposalId));
      if (!snap.exists()) return null;
      return snap.data()?.cid ?? null;
    } catch (error) {
      console.warn('[CIDRegistry] Read failed (non-fatal):', error);
      return null;
    }
  }
}

export const cidRegistryService = new CIDRegistryService();
