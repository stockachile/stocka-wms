/**
 * WMS STOCKA - Client-Side IndexedDB Cache Layer (SWR Acceleration)
 * Provides instant hydration for orders, shipments, and inventory maps.
 */
(function() {
  if (typeof window === 'undefined') return;

  const WmsDbCache = {
    dbName: 'StockaWmsCache_v3',
    storeName: 'orders_window',
    _db: null,

    async openDb() {
      if (this._db) return this._db;
      if (typeof indexedDB === 'undefined') return null;

      return new Promise((resolve) => {
        try {
          const request = indexedDB.open(this.dbName, 1);
          request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(this.storeName)) {
              db.createObjectStore(this.storeName, { keyPath: 'cacheKey' });
            }
          };
          request.onsuccess = (e) => {
            this._db = e.target.result;
            resolve(this._db);
          };
          request.onerror = (e) => {
            console.warn('[WMS Cache] Could not open IndexedDB:', e);
            resolve(null);
          };
        } catch (err) {
          console.warn('[WMS Cache] IndexedDB init error:', err);
          resolve(null);
        }
      });
    },

    dedupeOrdersById(orders) {
      if (!Array.isArray(orders) || orders.length <= 1) {
        return Array.isArray(orders) ? orders : [];
      }
      const seenIndex = new Map();
      const result = [];
      for (let i = 0; i < orders.length; i++) {
        const ord = orders[i];
        if (!ord || ord.id === undefined || ord.id === null) continue;
        const key = String(ord.id);
        if (!seenIndex.has(key)) {
          seenIndex.set(key, result.length);
          result.push(ord);
        } else {
          const idx = seenIndex.get(key);
          const existing = result[idx];
          const existingItems = Array.isArray(existing.order_items) ? existing.order_items : [];
          const incomingItems = Array.isArray(ord.order_items) ? ord.order_items : [];
          let merged;
          if (incomingItems.length > 0 && existingItems.length === 0) {
            merged = Object.assign({}, existing, ord, { order_items: incomingItems });
          } else if (existingItems.length > 0 && incomingItems.length === 0) {
            merged = Object.assign({}, ord, existing, { order_items: existingItems });
          } else {
            merged = Object.assign({}, ord, existing);
          }
          result[idx] = merged;
        }
      }
      return result;
    },

    async getWindowCache(dateFrom, dateTo) {
      try {
        const db = await this.openDb();
        if (!db) return null;
        return new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.get(`${dateFrom || ''}_${dateTo || ''}`);
          req.onsuccess = () => {
            const res = req.result;
            if (res && Array.isArray(res.orders) && res.orders.length > 0) {
              const ageMs = Date.now() - new Date(res.cachedAt).getTime();
              // Permitir hasta 24 horas de antigüedad para hidratación instantánea Stale-While-Revalidate
              if (isNaN(ageMs) || ageMs < 24 * 60 * 60 * 1000) {
                res.orders = this.dedupeOrdersById(res.orders);
                resolve(res);
              } else {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        });
      } catch (err) {
        console.warn('[WMS Cache] Read error:', err);
        return null;
      }
    },

    async setWindowCache(dateFrom, dateTo, orders, shipments = [], inventoryMap = {}) {
      try {
        const db = await this.openDb();
        if (!db || !Array.isArray(orders) || orders.length === 0) return false;
        const cleanOrders = this.dedupeOrdersById(orders);
        if (cleanOrders.length === 0) return false;
        return new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readwrite');
          const store = tx.objectStore(this.storeName);
          store.put({
            cacheKey: `${dateFrom || ''}_${dateTo || ''}`,
            dateFrom,
            dateTo,
            orders: cleanOrders,
            shipments: Array.isArray(shipments) ? shipments : [],
            inventoryMap: (inventoryMap && typeof inventoryMap === 'object') ? inventoryMap : {},
            cachedAt: new Date().toISOString()
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      } catch (err) {
        console.warn('[WMS Cache] Write error:', err);
        return false;
      }
    },

    async clearCache() {
      try {
        const db = await this.openDb();
        if (!db) return;
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).clear();
      } catch (e) {
        console.warn('[WMS Cache] Clear error:', e);
      }
    }
  };

  window.wmsDbCache = window.wmsDbCache || WmsDbCache;
})();
