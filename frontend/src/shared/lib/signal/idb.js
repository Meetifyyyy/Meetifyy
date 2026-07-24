export const idb = {
  dbPromise: null,

  init() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('MeetifyySignalDB', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('signal_store')) {
          db.createObjectStore('signal_store');
        }
        if (!db.objectStoreNames.contains('sent_messages')) {
          db.createObjectStore('sent_messages');
        }
      };
    });
    return this.dbPromise;
  },

  async get(storeName, key) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async put(storeName, key, val) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(val, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async remove(storeName, key) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};
