(function (root) {
  "use strict";

  const DB_NAME = "highlight-desk";
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        dbPromise = null;
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("clips")) {
          const store = db.createObjectStore("clips", { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Could not open the clip library."));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error("Library upgrade is blocked by another tab."));
      };
    });
    return dbPromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Library request failed."));
    });
  }

  async function putClip(record) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("clips", "readwrite");
      transaction.objectStore("clips").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save clip."));
      transaction.onabort = () => reject(transaction.error || new Error("Clip save aborted."));
    });
    return record.id;
  }

  async function listClips() {
    const db = await openDb();
    const transaction = db.transaction("clips", "readonly");
    const items = await requestResult(transaction.objectStore("clips").getAll());
    return items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  async function deleteClip(id) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("clips", "readwrite");
      transaction.objectStore("clips").delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not delete clip."));
    });
  }

  async function clearClips() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("clips", "readwrite");
      transaction.objectStore("clips").clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear library."));
    });
  }

  async function setMeta(key, value) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("meta", "readwrite");
      transaction.objectStore("meta").put({ key, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save setting."));
    });
  }

  async function getMeta(key) {
    const db = await openDb();
    const transaction = db.transaction("meta", "readonly");
    const record = await requestResult(transaction.objectStore("meta").get(key));
    return record ? record.value : undefined;
  }

  async function estimate() {
    try {
      if (!root.navigator || !root.navigator.storage || !root.navigator.storage.estimate) return null;
      return await root.navigator.storage.estimate();
    } catch {
      return null;
    }
  }

  async function persist() {
    try {
      if (!root.navigator || !root.navigator.storage || !root.navigator.storage.persist) return false;
      return await root.navigator.storage.persist();
    } catch {
      return false;
    }
  }

  root.HDStore = {
    openDb,
    putClip,
    listClips,
    deleteClip,
    clearClips,
    setMeta,
    getMeta,
    estimate,
    persist
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
