// Firestore export script: Exports all collections and documents to JSON files
// Usage: node export-firestore.js
// Requires: npm install firebase-admin

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Path to your Firebase service account key JSON
const SERVICE_ACCOUNT_PATH = './serviceAccountKey.json';
// Output directory for export
const EXPORT_DIR = './firebase-export';

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
});

const db = admin.firestore();

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function exportCollection(collectionName) {
  const collectionDir = path.join(EXPORT_DIR, collectionName);
  ensureDirSync(collectionDir);
  const snapshot = await db.collection(collectionName).get();
  for (const doc of snapshot.docs) {
    const docPath = path.join(collectionDir, doc.id + '.json');
    fs.writeFileSync(docPath, JSON.stringify(doc.data(), null, 2));
    console.log(`Exported ${collectionName}/${doc.id}`);
  }
}

async function main() {
  ensureDirSync(EXPORT_DIR);
  const collections = await db.listCollections();
  for (const col of collections) {
    await exportCollection(col.id);
  }
  console.log('Firestore export complete.');
  process.exit(0);
}

main();
