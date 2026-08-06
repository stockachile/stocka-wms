// URL y Anon Key proporcionadas por el usuario
const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

// Inicializar cliente Supabase usando UMD script cargado en el HTML
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  const step = 200;
  while (true) {
    let q = supabase.from(tableName).select(selectStr);
    if (filterCallback) q = filterCallback(q);
    const { data, error } = await q.range(from, from + step - 1);
    if (error) throw error;
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

// Interceptor global para abrir comprobantes de pago usando URLs firmadas temporales (bucket privado)
document.addEventListener('click', async (e) => {
  const link = e.target.closest('a');
  if (link && link.href && link.href.includes('/payment_receipts/')) {
    e.preventDefault();
    
    // Extraer el nombre del archivo de la URL
    const parts = link.href.split('/payment_receipts/');
    if (parts.length > 1) {
      const fileName = decodeURIComponent(parts[1]);
      try {
        // Solicitar una URL firmada válida por 60 segundos
        const { data, error } = await supabase.storage
          .from('payment_receipts')
          .createSignedUrl(fileName, 60);
          
        if (error) throw error;
        if (data && data.signedUrl) {
          window.open(data.signedUrl, '_blank');
        }
      } catch (err) {
        console.error('Error al generar URL firmada para comprobante:', err);
        alert('No tienes permisos para ver este comprobante o el enlace ha caducado.');
      }
    }
  }
});

export default supabase;

