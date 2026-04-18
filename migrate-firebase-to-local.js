// Migration script: Firebase export (JSON) to local folder/file DB
// Place this script in your project root and run with: node migrate-firebase-to-local.js

const fs = require('fs');
const path = require('path');

const FIREBASE_EXPORT_DIR = './firebase-export'; // Path to your Firebase export root
const LOCAL_DB_ROOT = './data'; // Target local DB root

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function migrateCollection(collectionName) {
  const collectionDir = path.join(FIREBASE_EXPORT_DIR, collectionName);
  const targetDir = path.join(LOCAL_DB_ROOT, collectionName);
  ensureDirSync(targetDir);
  const files = fs.readdirSync(collectionDir);
  files.forEach(file => {
    if (file.endsWith('.json')) {
      const docId = file.replace(/\.json$/, '');
      const srcPath = path.join(collectionDir, file);
      const destPath = path.join(targetDir, docId + '.json');
      fs.copyFileSync(srcPath, destPath);
      console.log(`Migrated ${collectionName}/${docId}`);
    }
  });
}

function main() {
  ensureDirSync(LOCAL_DB_ROOT);
  const collections = fs.readdirSync(FIREBASE_EXPORT_DIR).filter(f => fs.statSync(path.join(FIREBASE_EXPORT_DIR, f)).isDirectory());
  collections.forEach(migrateCollection);
  console.log('Migration complete.');
}

main();
