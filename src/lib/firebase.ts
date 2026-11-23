import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getAnalytics, isSupported, Analytics } from 'firebase/analytics';

// Safely access env vars across Vite, Node, and Electron runtimes
const env = (typeof import.meta !== 'undefined' && (import.meta as any)?.env) || (typeof process !== 'undefined' && process.env) || {};

// Firebase configuration for SafeSpeak with exact live configuration
const projectId = env.VITE_FIREBASE_PROJECT_ID || 'safespeak-6c554';
const databaseURL = env.VITE_FIREBASE_DATABASE_URL || 'https://safespeak-6c554-default-rtdb.asia-southeast1.firebasedatabase.app';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyB8-DkvcAr0-oUGuHfY0cowPV5ncR9mn44',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'safespeak-6c554.firebaseapp.com',
  databaseURL: databaseURL,
  projectId: projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'safespeak-6c554.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '847458508055',
  appId: env.VITE_FIREBASE_APP_ID || '1:847458508055:web:d954329ba43cb31ce3eb52',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-CNZWRTWKB2'
};

// Initialize Firebase defensively
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);

// Initialize Analytics when supported (browser runtime)
export let analytics: Analytics | null = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics not supported in this runtime
  });
}
