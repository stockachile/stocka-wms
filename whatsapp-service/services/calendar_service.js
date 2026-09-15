/**
 * Servicio de Calendario, Feriados y Días Sin Operaciones para Stocka WMS
 * Controla:
 * - Consulta de días feriados y sin operaciones en Supabase
 * - Verificación de días no laborales en Santiago de Chile
 * - Generación de feed RFC 5545 iCalendar (.ics) para suscripción en Google Calendar
 * - Importación de feriados oficiales de Chile
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cargar variables de entorno
const envPath = path.join(__dirname, '../../.env');
const localEnvPath = path.join(__dirname, '../.env');
let env = {};

function readEnv(p) {
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        }
        env[match[1]] = value.trim();
      }
    });
  }
}
readEnv(envPath);
readEnv(localEnvPath);

const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Feriados Oficiales Chilenos de Respaldo (por si la BD está offline)
const OFFICIAL_CHILE_HOLIDAYS = [
  // 2026
  { date: '2026-01-01', title: 'Año Nuevo', isHoliday: true },
  { date: '2026-04-03', title: 'Viernes Santo', isHoliday: true },
  { date: '2026-04-04', title: 'Sábado Santo', isHoliday: true },
  { date: '2026-05-01', title: 'Día Nacional del Trabajo', isHoliday: true },
  { date: '2026-05-21', title: 'Día de las Glorias Navales', isHoliday: true },
  { date: '2026-06-29', title: 'San Pedro y San Pablo', isHoliday: true },
  { date: '2026-07-16', title: 'Día de la Virgen del Carmen', isHoliday: true },
  { date: '2026-08-15', title: 'Asunción de la Virgen', isHoliday: true },
  { date: '2026-09-17', title: 'Feriado Fiestas Patrias (Puente)', isHoliday: true },
  { date: '2026-09-18', title: 'Fiestas Patrias (Independencia Nacional)', isHoliday: true },
  { date: '2026-09-19', title: 'Día de las Glorias del Ejército', isHoliday: true },
  { date: '2026-10-12', title: 'Encuentro de Dos Mundos', isHoliday: true },
  { date: '2026-10-31', title: 'Día de las Iglesias Evangélicas y Protestantes', isHoliday: true },
  { date: '2026-11-01', title: 'Día de Todos los Santos', isHoliday: true },
  { date: '2026-12-08', title: 'Inmaculada Concepción', isHoliday: true },
  { date: '2026-12-25', title: 'Navidad', isHoliday: true },
  // 2027
  { date: '2027-01-01', title: 'Año Nuevo', isHoliday: true },
  { date: '2027-03-26', title: 'Viernes Santo', isHoliday: true },
  { date: '2027-03-27', title: 'Sábado Santo', isHoliday: true },
  { date: '2027-05-01', title: 'Día Nacional del Trabajo', isHoliday: true },
  { date: '2027-05-21', title: 'Día de las Glorias Navales', isHoliday: true },
  { date: '2027-09-17', title: 'Feriado Fiestas Patrias', isHoliday: true },
  { date: '2027-09-18', title: 'Fiestas Patrias', isHoliday: true },
  { date: '2027-09-19', title: 'Día de las Glorias del Ejército', isHoliday: true },
  { date: '2027-12-25', title: 'Navidad', isHoliday: true }
];

// Caché en memoria para evitar saturar Supabase en cada ciclo
let cachedEvents = null;
let lastCacheFetch = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Obtener todos los eventos del calendario desde Supabase
 */
async function getCalendarEvents(forceReload = false) {
  const now = Date.now();
  if (!forceReload && cachedEvents && (now - lastCacheFetch < CACHE_TTL_MS)) {
    return cachedEvents;
  }

  try {
    const { data, error } = await supabase
      .from('dashboard_events')
      .select('*')
      .order('event_date', { ascending: true });

    if (error) {
      console.warn('[CalendarService] Error consultando dashboard_events en Supabase:', error.message);
      if (cachedEvents) return cachedEvents;
      return [];
    }

    cachedEvents = data || [];
    lastCacheFetch = now;
    return cachedEvents;
  } catch (err) {
    console.error('[CalendarService] Excepción al obtener eventos:', err.message);
    if (cachedEvents) return cachedEvents;
    return [];
  }
}

/**
 * Limpia y recarga la memoria caché
 */
async function reloadCalendarCache() {
  cachedEvents = null;
  lastCacheFetch = 0;
  return await getCalendarEvents(true);
}

/**
 * Determina si un objeto de evento corresponde a día no operativo
 */
function isEventNonOperational(event) {
  if (!event) return false;
  if (event.is_non_operational === true || event.is_non_operational === 'true') return true;
  if (event.event_type === 'non_operational' || event.event_type === 'holiday') return true;
  const title = (event.title || '').toLowerCase();
  const desc = (event.description || '').toLowerCase();
  return title.includes('sin operacion') || title.includes('feriado') || desc.includes('sin operacion') || desc.includes('feriado');
}

/**
 * Determina si un objeto de evento corresponde a feriado
 */
function isEventHoliday(event) {
  if (!event) return false;
  if (event.is_holiday === true || event.is_holiday === 'true' || event.event_type === 'holiday') return true;
  const title = (event.title || '').toLowerCase();
  const desc = (event.description || '').toLowerCase();
  return title.includes('feriado') || desc.includes('feriado');
}

/**
 * Verifica si una fecha dada es Domingo, Feriado o Día Sin Operaciones
 * @param {Date} date Fecha a verificar (por defecto ahora en Santiago de Chile)
 */
async function isNonWorkingDay(date = new Date()) {
  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    weekday: 'short'
  }).format(date);

  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago'
  }).format(date); // Formato YYYY-MM-DD

  // 1. Domingo siempre es no operativo
  if (dayOfWeek === 'Sun') {
    return {
      isNonWorking: true,
      isSunday: true,
      isHoliday: false,
      isNonOperational: true,
      reason: 'Hoy es Domingo (Bodega cerrada)',
      date: dateStr,
      event: null
    };
  }

  // 2. Consultar eventos en Supabase
  const events = await getCalendarEvents();
  const matchedEvent = events.find(e => {
    const eDate = e.event_date ? e.event_date.split('T')[0].split(' ')[0] : '';
    if (eDate !== dateStr) return false;
    return isEventNonOperational(e) || isEventHoliday(e);
  });

  if (matchedEvent) {
    const isHol = isEventHoliday(matchedEvent);
    const label = isHol ? `Feriado: ${matchedEvent.title}` : `Día Sin Operaciones: ${matchedEvent.title}`;
    return {
      isNonWorking: true,
      isSunday: false,
      isHoliday: isHol,
      isNonOperational: true,
      reason: label,
      date: dateStr,
      event: matchedEvent
    };
  }

  // 3. Respaldo: Feriados Oficiales Chilenos
  const fallbackHoliday = OFFICIAL_CHILE_HOLIDAYS.find(h => h.date === dateStr);
  if (fallbackHoliday) {
    return {
      isNonWorking: true,
      isSunday: false,
      isHoliday: true,
      isNonOperational: true,
      reason: `Feriado Nacional: ${fallbackHoliday.title}`,
      date: dateStr,
      event: null
    };
  }

  return {
    isNonWorking: false,
    isSunday: false,
    isHoliday: false,
    isNonOperational: false,
    reason: 'Día hábil y operativo',
    date: dateStr,
    event: null
  };
}

/**
 * Genera el feed RFC 5545 iCalendar (.ics) en tiempo real
 * Compatible con Google Calendar, Apple Calendar y Outlook
 * Marca los eventos como TRANSP:OPAQUE para que Google Calendar los considere "Ocupado" (Busy)
 */
async function generateIcsFeed() {
  const events = await getCalendarEvents();

  let icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stocka WMS//Calendario Operacional Stocka//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Stocka WMS - Días Sin Operaciones y Feriados',
    'X-WR-CALDESC:Días feriados y sin operaciones de fulfillment en Stocka WMS (Bloqueado para reuniones)',
    'X-WR-TIMEZONE:America/Santiago'
  ];

  // Crear mapa unificado de eventos de BD + feriados oficiales
  const eventMap = new Map();

  // Feriados oficiales
  OFFICIAL_CHILE_HOLIDAYS.forEach(h => {
    eventMap.set(h.date, {
      id: `chile-holiday-${h.date}`,
      title: `🇨🇱 Feriado: ${h.title}`,
      description: `Feriado Oficial de Chile (${h.title}). Bodega de Stocka WMS sin operaciones. No agendar reuniones.`,
      event_date: `${h.date}T00:00:00Z`,
      is_non_operational: true,
      is_holiday: true
    });
  });

  // Sobrescribir o añadir con eventos registrados en WMS
  events.forEach(e => {
    if (isEventNonOperational(e) || isEventHoliday(e)) {
      const datePart = e.event_date ? e.event_date.split('T')[0].split(' ')[0] : '';
      if (datePart) {
        const isHol = isEventHoliday(e);
        const prefix = isHol ? '🇨🇱 Feriado: ' : '🛑 Sin Operaciones: ';
        eventMap.set(datePart, {
          id: e.id || `wms-${datePart}`,
          title: `${prefix}${e.title}`,
          description: `${e.description || 'Día sin operaciones registrado en Stocka WMS.'}\n\n[Bloqueado automáticamente para evitar agendamiento de reuniones]`,
          event_date: e.event_date,
          is_non_operational: true,
          is_holiday: isHol
        });
      }
    }
  });

  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  eventMap.forEach((ev, dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const startObj = new Date(Date.UTC(y, m - 1, d));
    const endObj = new Date(Date.UTC(y, m - 1, d + 1));

    const dtStart = `${startObj.getUTCFullYear()}${String(startObj.getUTCMonth() + 1).padStart(2, '0')}${String(startObj.getUTCDate()).padStart(2, '0')}`;
    const dtEnd = `${endObj.getUTCFullYear()}${String(endObj.getUTCMonth() + 1).padStart(2, '0')}${String(endObj.getUTCDate()).padStart(2, '0')}`;

    icsLines.push('BEGIN:VEVENT');
    icsLines.push(`UID:${ev.id}@stocka.cl`);
    icsLines.push(`DTSTAMP:${nowStamp}`);
    icsLines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    icsLines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    icsLines.push(`SUMMARY:${ev.title.replace(/[\n\r]/g, ' ')}`);
    icsLines.push(`DESCRIPTION:${ev.description.replace(/\n/g, '\\n')}`);
    icsLines.push('STATUS:CONFIRMED');
    icsLines.push('TRANSP:OPAQUE'); // 'OPAQUE' = Ocupado / Busy en iCalendar (bloquea disponibilidad)
    icsLines.push('CLASS:PUBLIC');
    icsLines.push('END:VEVENT');
  });

  icsLines.push('END:VCALENDAR');
  return icsLines.join('\r\n');
}

/**
 * Importar feriados oficiales de Chile a Supabase dashboard_events
 */
async function importOfficialHolidaysToSupabase(year = 2026) {
  const targetHolidays = OFFICIAL_CHILE_HOLIDAYS.filter(h => h.date.startsWith(String(year)));
  const existingEvents = await getCalendarEvents(true);

  const toInsert = [];
  for (const h of targetHolidays) {
    const alreadyExists = existingEvents.some(e => {
      const eDate = e.event_date ? e.event_date.split('T')[0].split(' ')[0] : '';
      return eDate === h.date;
    });

    if (!alreadyExists) {
      toInsert.push({
        title: `Sin operaciones - ${h.title}`,
        description: `Feriado oficial: ${h.title}. Sin operaciones de Fulfillment en bodega Stocka WMS.`,
        event_date: `${h.date}T03:00:00.000Z`,
        color_type: 'alert',
        target_role: 'all',
        event_type: 'holiday',
        is_non_operational: true,
        is_holiday: true,
        pause_whatsapp_bot: true
      });
    }
  }

  if (toInsert.length === 0) {
    return { success: true, inserted: 0, message: 'Todos los feriados ya se encontraban registrados en el calendario.' };
  }

  // Intentar inserción con nuevas columnas
  let { data, error } = await supabase.from('dashboard_events').insert(toInsert).select();
  
  // Si da error por columnas faltantes, insertar con columnas base
  if (error && (error.message.includes('event_type') || error.message.includes('is_non_operational') || error.code === 'PGRST204')) {
    console.warn('[CalendarService] Fallback de inserción feriados con columnas base.');
    const fallbackInserts = toInsert.map(item => ({
      title: item.title,
      description: item.description,
      event_date: item.event_date,
      color_type: item.color_type,
      target_role: item.target_role
    }));
    const res = await supabase.from('dashboard_events').insert(fallbackInserts).select();
    if (res.error) throw res.error;
    data = res.data;
  } else if (error) {
    throw error;
  }

  await reloadCalendarCache();
  return { success: true, inserted: data ? data.length : toInsert.length, events: data };
}

module.exports = {
  getCalendarEvents,
  reloadCalendarCache,
  isNonWorkingDay,
  generateIcsFeed,
  importOfficialHolidaysToSupabase,
  OFFICIAL_CHILE_HOLIDAYS,
  isEventNonOperational,
  isEventHoliday
};
