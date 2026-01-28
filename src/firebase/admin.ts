import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// This logic ensures that the Firebase Admin SDK is initialized only once.
if (!admin.apps.length) {
  try {
    // When running in a Google Cloud environment (like Cloud Run),
    // the SDK automatically discovers the service account credentials.
    // For local development, you must set the GOOGLE_APPLICATION_CREDENTIALS
    // environment variable. See BOT_SETUP.md for details.
    admin.initializeApp();
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error: any) {
    // We can ignore the "already exists" error in development environments.
    if (error.code !== 'app/duplicate-app') {
      console.error('Firebase Admin SDK initialization error:', error);
      console.log("Please ensure your environment is configured correctly for the Admin SDK.");
    }
  }
}

export const db = getFirestore();
export const auth = getAuth();
