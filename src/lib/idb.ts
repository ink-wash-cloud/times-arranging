// IndexedDB 极简封装：单库两表（records 用复合主键，meta 存本地配置）
import type { CollectionName, Envelope } from '../types';

const DB_NAME = 'schedule-app';
const DB_VERSION = 1;
const STORE = 'records';
const META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: ['collection', 'id'] });
        s.createIndex('by_collection', 'collection');
        s.createIndex('by_dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbAll(): Promise<Envelope[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  return wrap(tx.objectStore(STORE).getAll() as IDBRequest<Envelope[]>);
}

export async function idbByCollection(collection: CollectionName): Promise<Envelope[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const idx = tx.objectStore(STORE).index('by_collection');
  return wrap(idx.getAll(collection) as IDBRequest<Envelope[]>);
}

export async function idbDirty(): Promise<Envelope[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const idx = tx.objectStore(STORE).index('by_dirty');
  return wrap(idx.getAll(1) as IDBRequest<Envelope[]>);
}

export async function idbPut(rec: Envelope): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(rec);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbPutMany(recs: Envelope[]): Promise<void> {
  if (!recs.length) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const s = tx.objectStore(STORE);
  for (const r of recs) s.put(r);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 按复合主键批量删除（「以对方为准」覆盖本机时，清掉服务器上没有的那些） */
export async function idbDeleteMany(keys: Array<{ collection: string; id: string }>): Promise<void> {
  if (!keys.length) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const s = tx.objectStore(STORE);
  for (const k of keys) s.delete([k.collection, k.id]);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClearAll(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function metaGet<T>(k: string, def: T): Promise<T> {
  const db = await openDB();
  const tx = db.transaction(META, 'readonly');
  const row = await wrap(tx.objectStore(META).get(k) as IDBRequest<{ k: string; v: T } | undefined>);
  return row ? row.v : def;
}

export async function metaSet(k: string, v: unknown): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(META, 'readwrite');
  tx.objectStore(META).put({ k, v });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {
    return null;
  }
}
