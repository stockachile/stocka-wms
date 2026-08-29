import './demo.js';

// URL y Anon Key proporcionadas por el usuario
const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

// Inicializar cliente Supabase real
const actualSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Obtener el ID del usuario actual de la sesión (real o mock)
window.getDemoUserId = function() {
  const mode = sessionStorage.getItem('wms_demo_mode') === 'true';
  if (!mode) return null;
  const sessionJson = sessionStorage.getItem('sb-ejtjfaucnxbikrwjwwdu-auth-token');
  if (sessionJson) {
    try {
      const session = JSON.parse(sessionJson);
      if (session?.user?.id) return session.user.id;
    } catch(e) {}
  }
  return 'demo-user-uuid-12345'; // fallback
};

// Clase MockQueryBuilder para emular la base de datos Supabase en memoria/sessionStorage
class MockQueryBuilder {
  constructor(tableName, data) {
    this.tableName = tableName;
    this.data = data;
    this.filters = [];
    this.orderByField = null;
    this.orderAscending = true;
    this.limitCount = null;
    this.offsetCount = null;
    this.isSingle = false;
    this.isMaybeSingle = false;
  }

  select(selectStr) {
    return this;
  }

  eq(column, value) {
    this.filters.push(item => {
      if (column.includes('.')) {
        const parts = column.split('.');
        const val = item[parts[0]] ? item[parts[0]][parts[1]] : undefined;
        return String(val) === String(value);
      }
      return String(item[column]) === String(value);
    });
    return this;
  }

  neq(column, value) {
    this.filters.push(item => String(item[column]) !== String(value));
    return this;
  }

  gte(column, value) {
    this.filters.push(item => item[column] >= value);
    return this;
  }

  lte(column, value) {
    this.filters.push(item => item[column] <= value);
    return this;
  }

  in(column, values) {
    this.filters.push(item => {
      if (column.includes('.')) {
        const parts = column.split('.');
        const val = item[parts[0]] ? item[parts[0]][parts[1]] : undefined;
        return values.includes(val);
      }
      return values.includes(item[column]);
    });
    return this;
  }

  or(filterStr) {
    this.filters.push(item => {
      const clauses = filterStr.split(',');
      return clauses.some(clause => {
        const parts = clause.split('.');
        if (parts.length >= 3) {
          const col = parts[0];
          const op = parts[1];
          const val = parts[2].replace(/"/g, '');
          if (op === 'eq') return String(item[col]) === String(val);
        }
        return false;
      });
    });
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.orderByField = column;
    this.orderAscending = ascending;
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  range(from, to) {
    this.offsetCount = from;
    this.limitCount = (to - from) + 1;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  then(onfulfilled, onrejected) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  catch(onrejected) {
    return Promise.resolve(this.execute()).catch(onrejected);
  }

  execute() {
    let result = [...this.data];
    const demoUserId = window.getDemoUserId();

    // 1. Mapear ID/Merchant_ID al usuario logueado en modo demo para asegurar coincidencia de filtros
    if (window.isDemoMode() && demoUserId) {
      if (this.tableName === 'profiles') {
        result = result.map(p => {
          if (p.id === 'demo-client-uuid-placeholder' || p.full_name === 'Cliente Invitado Demo' || p.id === demoUserId) {
            return {
              ...p,
              id: demoUserId,
              allowed_modules: Array.isArray(p.allowed_modules) ? p.allowed_modules.join(', ') : p.allowed_modules
            };
          }
          return {
            ...p,
            allowed_modules: Array.isArray(p.allowed_modules) ? p.allowed_modules.join(', ') : p.allowed_modules
          };
        });
      } else if (this.tableName === 'stock_declarations') {
        result = result.map(item => ({ ...item, merchant_id: demoUserId }));
      } else if (this.tableName === 'merchants_warehouses') {
        result = result.map(item => ({ ...item, merchant_id: demoUserId }));
      } else if (this.tableName === 'merchant_integrations') {
        result = result.map(item => ({ ...item, merchant_id: demoUserId }));
      } else if (this.tableName === 'inventory_requests') {
        result = result.map(item => ({ ...item, merchant_id: demoUserId }));
      }
    }

    // 2. Resolver relaciones (Joins) ANTES de aplicar filtros para que filtros sobre relaciones (ej: products.comercio) funcionen
    if (this.tableName === 'inventory') {
      const products = window.getMockTable('products');
      result = result.map(item => {
        const prod = products.find(p => p.id === item.product_id);
        return { ...item, products: prod || null };
      });
    } else if (this.tableName === 'stock_declarations') {
      const warehouses = window.getMockTable('warehouses');
      const profiles = window.getMockTable('profiles');
      result = result.map(item => {
        const wh = warehouses.find(w => w.id === item.warehouse_id) || warehouses[0] || { name: 'Bodega Central', location: 'Santiago' };
        const prof = profiles.find(p => p.id === item.merchant_id) || profiles[0];
        return {
          ...item,
          warehouses: {
            name: wh.name,
            address: wh.location || 'Santiago, RM',
            comuna: 'Santiago',
            operating_days: 'Lunes a Viernes'
          },
          profiles: {
            full_name: prof?.full_name || 'Usuario Demo',
            email: prof?.email || 'demo@stocka.cl'
          }
        };
      });
    } else if (this.tableName === 'pack_items') {
      const products = window.getMockTable('products');
      result = result.map(item => {
        const prod = products.find(p => p.id === item.member_product_id || p.id === item.pack_product_id);
        return {
          ...item,
          products: prod ? { sku: prod.sku, name: prod.name } : null
        };
      });
    } else if (this.tableName === 'orders') {
      const orderItems = window.getMockTable('order_items');
      const products = window.getMockTable('products');
      result = result.map(order => {
        const items = orderItems.filter(oi => oi.order_id === order.id);
        const itemsWithProducts = items.map(oi => {
          const prod = products.find(p => p.id === oi.product_id);
          return {
            ...oi,
            products: prod || null
          };
        });
        return {
          ...order,
          order_items: itemsWithProducts
        };
      });
    } else if (this.tableName === 'products') {
      const inventory = window.getMockTable('inventory');
      const warehouses = window.getMockTable('warehouses');
      result = result.map(prod => {
        const invs = inventory.filter(i => i.product_id === prod.id);
        const invsWithWarehouses = invs.map(i => {
          const wh = warehouses.find(w => w.id === i.warehouse_id);
          return {
            ...i,
            warehouses: wh ? { name: wh.name } : null
          };
        });
        return {
          ...prod,
          inventory: invsWithWarehouses
        };
      });
    } else if (this.tableName === 'order_items') {
      const orders = window.getMockTable('orders');
      const products = window.getMockTable('products');
      result = result.map(item => {
        const orderObj = orders.find(o => o.id === item.order_id);
        const prodObj = products.find(p => p.id === item.product_id);
        return {
          ...item,
          orders: orderObj || null,
          products: prodObj || null
        };
      });
    } else if (this.tableName === 'v_comercios_volumen_actual') {
      const products = window.getMockTable('products');
      const inventory = window.getMockTable('inventory');
      let totalVolume = 0;
      inventory.forEach(inv => {
        const prod = products.find(p => p.id === inv.product_id);
        if (prod) {
          totalVolume += (prod.volumen || 0) * (inv.quantity || 0);
        }
      });
      result = [{
        comercio: 'Empresa Demo S.A.',
        comercio_id: 'cac-1',
        volumen_actual: totalVolume
      }];
    } else if (this.tableName === 'comercios_volumen_diario') {
      const products = window.getMockTable('products');
      const inventory = window.getMockTable('inventory');
      let currentVolume = 0;
      inventory.forEach(inv => {
        const prod = products.find(p => p.id === inv.product_id);
        if (prod) {
          currentVolume += (prod.volumen || 0) * (inv.quantity || 0);
        }
      });
      
      const history = [];
      for (let i = 30; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const fluctuation = (Math.sin(i / 2) * 0.15 + (Math.random() - 0.5) * 0.05);
        const dayVolume = Math.max(0.1, currentVolume * (1 + fluctuation));
        
        history.push({
          id: `vol-${i}`,
          comercio: 'Empresa Demo S.A.',
          comercio_id: 'cac-1',
          fecha: dateStr,
          volumen: parseFloat(dayVolume.toFixed(4)),
          created_at: d.toISOString()
        });
      }
      result = history;
    } else if (this.tableName === 'tickets') {
      const profiles = window.getMockTable('profiles');
      result = result.map(t => {
        const client = profiles.find(p => p.id === t.user_id) || profiles[0] || null;
        const assignee = profiles.find(p => p.id === t.assigned_to) || null;
        return {
          ...t,
          client: client,
          assignee: assignee,
          assigned: assignee
        };
      });
    } else if (this.tableName === 'ticket_messages') {
      const profiles = window.getMockTable('profiles');
      result = result.map(m => {
        const sender = profiles.find(p => p.id === m.sender_id) || profiles[0] || null;
        return {
          ...m,
          sender: sender
        };
      });
    }

    // 3. Aplicar filtros
    for (const filter of this.filters) {
      result = result.filter(filter);
    }

    // Aplicar ordenamiento
    if (this.orderByField) {
      result.sort((a, b) => {
        let valA = a[this.orderByField];
        let valB = b[this.orderByField];
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (typeof valA === 'string') {
          return this.orderAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return this.orderAscending ? (valA - valB) : (valB - valA);
      });
    }

    // Aplicar paginación / límites
    let offset = this.offsetCount || 0;
    let limit = this.limitCount !== null ? this.limitCount : result.length;
    const count = result.length;
    result = result.slice(offset, offset + limit);

    // Formatear respuestas únicas
    if (this.isSingle) {
      if (result.length === 0) {
        return { data: null, error: { message: "No se encontraron registros" } };
      }
      return { data: result[0], error: null };
    }
    if (this.isMaybeSingle) {
      return { data: result.length > 0 ? result[0] : null, error: null };
    }

    return { data: result, count: count, error: null };
  }

  // Operaciones de escritura/mutación
  insert(records) {
    if (!Array.isArray(records)) records = [records];
    const newRecords = records.map(r => ({
      id: r.id || 'mock-' + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString(),
      ...r
    }));
    this.data.push(...newRecords);
    window.saveMockTable(this.tableName, this.data);
    return Promise.resolve({ data: newRecords, error: null });
  }

  update(updates) {
    let result = [...this.data];
    for (const filter of this.filters) {
      result = result.filter(filter);
    }
    result.forEach(item => {
      Object.assign(item, updates);
    });
    window.saveMockTable(this.tableName, this.data);
    return Promise.resolve({ data: result, error: null });
  }

  delete() {
    let toDelete = [...this.data];
    for (const filter of this.filters) {
      toDelete = toDelete.filter(filter);
    }
    this.data = this.data.filter(item => !toDelete.includes(item));
    window.saveMockTable(this.tableName, this.data);
    return Promise.resolve({ data: toDelete, error: null });
  }
}

// Configurar Proxy de Auth para Supabase Auth Client
const authProxy = new Proxy(actualSupabase.auth, {
  get(target, prop) {
    if (prop === 'getSession') {
      return async () => {
        // Primero verificar sesión real en Supabase
        const realSessionResult = await actualSupabase.auth.getSession();
        const session = realSessionResult?.data?.session;
        
        if (session) {
          // Si el usuario real está marcado como demo user en sus metadatos
          if (session.user?.user_metadata?.is_demo_user === true) {
            sessionStorage.setItem('wms_demo_mode', 'true');
            if (sessionStorage.getItem('wms_demo_db_initialized') !== 'true') {
              window.initializeDemoDB();
            }
            return realSessionResult;
          }
        }
        
        // Si no hay sesión real pero está el flag manual activo
        if (window.isDemoMode()) {
          return {
            data: {
              session: {
                access_token: 'mock-demo-token-1234',
                user: {
                  id: 'demo-user-uuid-12345',
                  email: 'demo@stocka.cl',
                  user_metadata: {
                    full_name: 'Cliente Invitado Demo',
                    company_name: 'Empresa Demo S.A.'
                  }
                }
              }
            },
            error: null
          };
        }
        return realSessionResult;
      };
    }
    if (prop === 'getUser') {
      return async () => {
        // Primero verificar si hay sesión real
        const realUserResult = await actualSupabase.auth.getUser();
        const user = realUserResult?.data?.user;
        
        if (user) {
          if (user.user_metadata?.is_demo_user === true) {
            return realUserResult;
          }
        }
        
        if (window.isDemoMode()) {
          return {
            data: {
              user: {
                id: window.getDemoUserId() || 'demo-user-uuid-12345',
                email: 'demo@stocka.cl',
                user_metadata: {
                  full_name: 'Cliente Invitado Demo',
                  company_name: 'Empresa Demo S.A.'
                }
              }
            },
            error: null
          };
        }
        return realUserResult;
      };
    }
    if (prop === 'signInWithPassword') {
      return async ({ email, password }) => {
        if (email.toLowerCase() === 'demo@stocka.cl') {
          sessionStorage.setItem('wms_demo_mode', 'true');
          window.initializeDemoDB(true);
          return {
            data: {
              session: {
                access_token: 'mock-demo-token-1234',
                user: {
                  id: 'demo-user-uuid-12345',
                  email: 'demo@stocka.cl',
                  user_metadata: {
                    full_name: 'Cliente Invitado Demo',
                    company_name: 'Empresa Demo S.A.'
                  }
                }
              }
            },
            error: null
          };
        }
        
        const result = await actualSupabase.auth.signInWithPassword({ email, password });
        const session = result?.data?.session;
        if (session && session.user?.user_metadata?.is_demo_user === true) {
          sessionStorage.setItem('wms_demo_mode', 'true');
          window.initializeDemoDB(true);
        }
        return result;
      };
    }
    if (prop === 'onAuthStateChange') {
      return (callback) => {
        // Escuchar cambios reales en Supabase Auth
        return actualSupabase.auth.onAuthStateChange(async (event, session) => {
          if (session && session.user?.user_metadata?.is_demo_user === true) {
            sessionStorage.setItem('wms_demo_mode', 'true');
            if (sessionStorage.getItem('wms_demo_db_initialized') !== 'true') {
              window.initializeDemoDB();
            }
          }
          callback(event, session);
        });
      };
    }
    if (prop === 'signOut') {
      return async () => {
        if (window.isDemoMode()) {
          sessionStorage.removeItem('wms_demo_mode');
          sessionStorage.removeItem('wms_demo_db_initialized');
        }
        return actualSupabase.auth.signOut();
      };
    }
    
    // Delegar al cliente de Supabase Auth original con binding correcto
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  }
});

// Mock Realtime Channel para modo demo o fallback
class MockRealtimeChannel {
  constructor(topic) {
    this.topic = topic;
    this.callbacks = [];
  }
  on(type, filter, callback) {
    if (typeof filter === 'function') {
      this.callbacks.push(filter);
    } else if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
    return this;
  }
  subscribe(callback) {
    if (callback) callback('SUBSCRIBED');
    return this;
  }
  unsubscribe() {
    return Promise.resolve('ok');
  }
  send() {
    return Promise.resolve('ok');
  }
}

const mockChannels = new Map();

// Handlers especiales para el Proxy de Supabase
const supabaseCustomHandlers = {
  auth: authProxy,
  get storage() { return actualSupabase ? actualSupabase.storage : null; },
  from: (tableName) => {
    if (window.isDemoMode()) {
      const data = window.getMockTable(tableName);
      return new MockQueryBuilder(tableName, data);
    }
    if (actualSupabase) {
      return actualSupabase.from(tableName);
    }
    const data = window.getMockTable ? window.getMockTable(tableName) : [];
    return new MockQueryBuilder(tableName, data);
  },
  rpc: (name, args) => {
    if (window.isDemoMode()) {
      console.log(`WMS Demo RPC Call: ${name}`, args);
      if (name === 'get_committed_order_details') {
        return Promise.resolve({
          data: [
            {
              quantity: 3,
              order_id: 'o-1003',
              external_order_number: '1003',
              external_platform: 'shopify',
              status: 'packing',
              created_at: new Date().toISOString(),
              customer_name: 'Carlos Silva'
            }
          ],
          error: null
        });
      }
      return Promise.resolve({ data: true, error: null });
    }
    if (actualSupabase) {
      return actualSupabase.rpc(name, args);
    }
    return Promise.resolve({ data: true, error: null });
  },
  channel: (name, opts) => {
    if (window.isDemoMode()) {
      const ch = new MockRealtimeChannel(name);
      mockChannels.set(name, ch);
      return ch;
    }
    if (actualSupabase && typeof actualSupabase.channel === 'function') {
      return actualSupabase.channel(name, opts);
    }
    const ch = new MockRealtimeChannel(name);
    return ch;
  },
  removeChannel: (channel) => {
    if (window.isDemoMode()) {
      if (channel && channel.topic) {
        mockChannels.delete(channel.topic);
      }
      return Promise.resolve('ok');
    }
    if (actualSupabase && typeof actualSupabase.removeChannel === 'function') {
      return actualSupabase.removeChannel(channel);
    }
    return Promise.resolve('ok');
  },
  removeAllChannels: () => {
    if (window.isDemoMode()) {
      mockChannels.clear();
      return Promise.resolve([]);
    }
    if (actualSupabase && typeof actualSupabase.removeAllChannels === 'function') {
      return actualSupabase.removeAllChannels();
    }
    return Promise.resolve([]);
  },
  getChannels: () => {
    if (window.isDemoMode()) {
      return Array.from(mockChannels.values());
    }
    if (actualSupabase && typeof actualSupabase.getChannels === 'function') {
      return actualSupabase.getChannels();
    }
    return [];
  }
};

// Cliente Supabase proxificado
const supabaseProxy = new Proxy(actualSupabase || {}, {
  get(target, prop) {
    if (prop in supabaseCustomHandlers) {
      return supabaseCustomHandlers[prop];
    }
    if (target && prop in target) {
      const val = target[prop];
      if (typeof val === 'function') {
        return val.bind(target);
      }
      return val;
    }
    return undefined;
  }
});

const supabase = supabaseProxy;

// Función global para escapar caracteres HTML y mitigar ataques XSS
window.escapeHtml = function(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};


window.fetchAllSupabaseRows = async function(tableName, selectStr, filterCallback) {
  let allData = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let attempts = 0;
    let data = null;
    let lastError = null;

    while (attempts < 3) {
      attempts++;
      let q = supabase.from(tableName).select(selectStr);
      if (filterCallback) q = filterCallback(q);
      const res = await q.range(from, from + step - 1);
      if (!res.error) {
        data = res.data;
        lastError = null;
        break;
      }
      lastError = res.error;
      const isTimeout = lastError.code === '57014' || lastError.message?.includes('timeout') || lastError.message?.includes('Failed to fetch');
      if (isTimeout && attempts < 3) {
        console.warn(`[fetchAllSupabaseRows] Reintentando ${tableName} (intento ${attempts + 1})...`, lastError);
        await new Promise(r => setTimeout(r, 600 * attempts));
      } else {
        break;
      }
    }

    if (lastError) throw lastError;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return allData;
};

window.startPremiumLoader = function(containerId, titleText = 'Inicializando Dashboard') {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const logisticsStates = [
    { text: 'Conectando con el servidor logístico...', icon: 'ri-cloud-line' },
    { text: 'Sincronizando registros de inventario físico...', icon: 'ri-archive-line' },
    { text: 'Calculando volumen cúbico ocupado en bodega...', icon: 'ri-ruler-2-line' },
    { text: 'Verificando alertas de stock crítico por SKU...', icon: 'ri-error-warning-line' },
    { text: 'Sincronizando integraciones y canales de venta...', icon: 'ri-sensor-line' },
    { text: 'Cargando historial de movimientos y pedidos...', icon: 'ri-truck-line' },
    { text: 'Preparando métricas operacionales del comercio...', icon: 'ri-line-chart-line' },
    { text: 'Actualizando calendario de actividades...', icon: 'ri-calendar-todo-line' }
  ];

  container.innerHTML = `
    <div class="premium-loader-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 420px; padding: 3rem; background: var(--color-surface); border-radius: var(--radius-lg); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); position: relative; overflow: hidden; text-align: center;">
      <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(59, 130, 246, 0.03) 0%, rgba(255, 255, 255, 0) 70%); pointer-events: none; animation: pulse-glow 8s ease-in-out infinite;"></div>
      
      <style>
        @keyframes spin-gradient {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse-icon {
          0%, 100% { transform: scale(0.92); opacity: 0.8; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes pulse-glow {
          0%, 100% { transform: scale(0.95); opacity: 0.7; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        .loader-fade-in {
          animation: wmsFadeIn 0.3s forwards;
        }
        .loader-fade-out {
          animation: wmsFadeOut 0.3s forwards;
        }
        @keyframes wmsFadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes wmsFadeOut {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(-5px); }
        }
        @keyframes wms-pulse-dot {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      </style>
      
      <!-- Spinning Ring -->
      <div style="position: relative; width: 90px; height: 90px; margin-bottom: 2rem; display: flex; align-items: center; justify-content: center;">
        <div style="position: absolute; width: 100%; height: 100%; border: 3px dashed var(--color-border); border-radius: 50%;"></div>
        <div style="position: absolute; width: 100%; height: 100%; border: 3px solid transparent; border-top-color: var(--color-primary); border-radius: 50%; animation: spin-gradient 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;"></div>
        
        <!-- Dynamic Icon wrapper -->
        <div id="loader-icon-wrapper" style="position: absolute; width: 50px; height: 50px; background: rgba(59, 130, 246, 0.08); border-radius: 50%; display: flex; align-items: center; justify-content: center; animation: pulse-icon 2s ease-in-out infinite;">
          <i id="loader-icon-element" class="${logisticsStates[0].icon}" style="font-size: 1.6rem; color: var(--color-primary); transition: all 0.3s ease;"></i>
        </div>
      </div>
      
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text-main); letter-spacing: -0.3px;">${titleText}</h3>
      <p id="loader-status-text" style="margin: 0; color: var(--color-text-muted); font-size: 0.9rem; font-weight: 500; height: 24px; transition: all 0.3s ease; max-width: 320px;">${logisticsStates[0].text}</p>
      
      <!-- Progress dots -->
      <div style="display: flex; gap: 0.35rem; margin-top: 2rem; justify-content: center;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary); opacity: 0.3; animation: wms-pulse-dot 1.2s infinite 0s;"></span>
        <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary); opacity: 0.3; animation: wms-pulse-dot 1.2s infinite 0.2s;"></span>
        <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary); opacity: 0.3; animation: wms-pulse-dot 1.2s infinite 0.4s;"></span>
      </div>
    </div>
  `;

  let currentIndex = 0;
  const statusElement = container.querySelector('#loader-status-text');
  const iconElement = container.querySelector('#loader-icon-element');

  const intervalId = setInterval(() => {
    currentIndex = (currentIndex + 1) % logisticsStates.length;
    const nextState = logisticsStates[currentIndex];

    if (statusElement && iconElement) {
      statusElement.classList.add('loader-fade-out');
      iconElement.classList.add('loader-fade-out');

      setTimeout(() => {
        statusElement.innerText = nextState.text;
        iconElement.className = nextState.icon;

        statusElement.classList.remove('loader-fade-out');
        statusElement.classList.add('loader-fade-in');
        iconElement.classList.remove('loader-fade-out');
        iconElement.classList.add('loader-fade-in');

        setTimeout(() => {
          statusElement.classList.remove('loader-fade-in');
          iconElement.classList.remove('loader-fade-in');
        }, 300);
      }, 300);
    }
  }, 1800);

  return intervalId;
};

window.setDashboardCache = function(key, data) {
  try {
    const cacheObj = {
      timestamp: Date.now(),
      data: data
    };
    sessionStorage.setItem('wms_cache_' + key, JSON.stringify(cacheObj));
  } catch (e) {
    console.error('Error saving to cache:', e);
  }
};

window.getDashboardCache = function(key, ttlMs = 300000) {
  try {
    const raw = sessionStorage.getItem('wms_cache_' + key);
    if (!raw) return null;
    const cacheObj = JSON.parse(raw);
    const age = Date.now() - cacheObj.timestamp;
    if (age < ttlMs) {
      return { data: cacheObj.data, timestamp: cacheObj.timestamp };
    }
    sessionStorage.removeItem('wms_cache_' + key);
  } catch (e) {
    console.error('Error reading from cache:', e);
  }
  return null;
};

window.clearDashboardCache = function(key) {
  try {
    if (key) {
      sessionStorage.removeItem('wms_cache_' + key);
    } else {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('wms_cache_')) {
          sessionStorage.removeItem(k);
        }
      });
    }
  } catch (e) {
    console.error('Error clearing cache:', e);
  }
};

window.loadShippingRatesFromSupabase = async function() {
  try {
    const { data, error } = await supabase
      .from('shipping_rates')
      .select('rates')
      .eq('id', 'current')
      .maybeSingle();

    if (error) {
      console.warn('Advertencia al cargar tarifas desde Supabase (se usarán tarifas locales):', error);
      return;
    }

    if (data && data.rates) {
      window.shippingRates = data.rates;
      console.log('Tarifas de despacho actualizadas cargadas correctamente desde Supabase.');
    } else {
      console.log('No se encontraron tarifas cargadas en Supabase. Usando tarifas locales integradas.');
    }
  } catch (err) {
    console.error('Error en loadShippingRatesFromSupabase:', err);
  }
};

// Cargar tarifas de manera asíncrona no bloqueante
window.loadShippingRatesFromSupabase();

window.supabaseClient = supabase;

export { supabase };
export default supabase;
