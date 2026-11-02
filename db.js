// Tiny IndexedDB helper, shared by the page and the service worker.
// Everything lives on the device only.
const DB_NAME = 'little-journal';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function run(store, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); res(req ? req.result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error); };
  }));
}

const allEntries = () => run('entries', 'readonly', s => s.getAll());
const putEntry = e => run('entries', 'readwrite', s => s.put(e));
const delEntry = id => run('entries', 'readwrite', s => s.delete(id));
const getKV = (k, d) => run('kv', 'readonly', s => s.get(k)).then(r => (r ? r.v : d));
const setKV = (k, v) => run('kv', 'readwrite', s => s.put({ k, v }));
