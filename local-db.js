// Simple local DB access layer for folder/file-based collections
// Usage: const db = require('./local-db');
const fs = require('fs');
const path = require('path');

const DB_ROOT = process.env.LOCAL_DB_ROOT || path.join(__dirname, 'data');

function getDoc(collection, docId) {
  const file = path.join(DB_ROOT, collection, docId + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function setDoc(collection, docId, data) {
  const dir = path.join(DB_ROOT, collection);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, docId + '.json'), JSON.stringify(data, null, 2));
}

function deleteDoc(collection, docId) {
  const file = path.join(DB_ROOT, collection, docId + '.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function listDocs(collection) {
  const dir = path.join(DB_ROOT, collection);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
}

module.exports = { getDoc, setDoc, deleteDoc, listDocs };
