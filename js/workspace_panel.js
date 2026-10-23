/**
 * ============================================================================
 * WMS STOCKA - Módulo "Mi Panel de Trabajo" (Stocka Workspace) & Botón Flotante
 * ============================================================================
 * Incluye:
 * - Checklist de Tareas Diarias ("Mi Día") con barra de progreso, subtareas y rutinas
 * - Tablero Kanban interactivo (Por Hacer, En Proceso, En Espera, Completado)
 * - Mural de Notas por colores + Fijados (Pins) + Scratchpad con auto-guardado
 * - Motor de Recordatorios por WhatsApp vía Stox (envío directo, resumen diario y pruebas)
 * - Botón Flotante Expandible ("Mi Espacio" / Alt+W) con micro-herramientas
 *   100% seleccionables por cada usuario para no sobrecargar la pantalla.
 */

import supabase from './supabase.js';

const WHATSAPP_API_URL_DEFAULT = 'https://stocka-whatsapp-bot.onrender.com';
const WHATSAPP_API_KEY_DEFAULT = 'stocka_wa_internal_secret_2026';

function getWaApiConfig() {
  return {
    url: (window.WHATSAPP_API_URL || WHATSAPP_API_URL_DEFAULT).replace(/\/+$/, ''),
    key: window.WHATSAPP_API_KEY || WHATSAPP_API_KEY_DEFAULT
  };
}

function getTodayStrChile() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  } catch (_) {
    return new Date().toISOString().split('T')[0];
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeChileanPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    digits = '56' + digits;
  } else if (digits.length === 8) {
    digits = '569' + digits;
  }
  return digits;
}

function formatTimeShort(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return '';
  }
}

// Definición de las micro-herramientas disponibles para el botón flotante
const FLOATING_TOOLS_CATALOG = [
  {
    key: 'checklist',
    label: 'Checklist de Hoy',
    shortLabel: 'Hoy',
    icon: 'ri-checkbox-circle-line',
    description: 'Lista rápida de pendientes del día para ir marcando con check y agregar tareas al vuelo.'
  },
  {
    key: 'scratchpad',
    label: 'Scratchpad (Nota Rápida)',
    shortLabel: 'Scratchpad',
    icon: 'ri-Draft-line',
    description: 'Bloc de apuntes instantáneo con auto-guardado para copiar SKUs, pedidos o teléfonos.'
  },
  {
    key: 'stox',
    label: 'Recordatorio Express Stox',
    shortLabel: 'Stox WA',
    icon: 'ri-whatsapp-line',
    description: 'Programa un aviso rápido a tu WhatsApp en 15m, 1h, mañana o a una hora exacta.'
  },
  {
    key: 'pinned',
    label: 'Notas Fijadas',
    shortLabel: 'Fijadas',
    icon: 'ri-pushpin-2-line',
    description: 'Muestra tus tarjetas de notas ancladas más importantes con copiado rápido.'
  },
  {
    key: 'timer',
    label: 'Cronómetro / Foco Operativo',
    shortLabel: 'Foco',
    icon: 'ri-timer-flash-line',
    description: 'Temporizador Pomodoro (25 min) o cronómetro libre para medir tiempos operativos.'
  }
];

// Estado global reactivo del Panel de Trabajo
const wsState = {
  initialized: false,
  userId: null,
  userEmail: '',
  userName: 'Usuario Stocka',
  userRole: 'admin',
  profilePhone: '',
  supabaseTablesReady: true,

  activeMainTab: 'day', // 'day' | 'kanban' | 'notes' | 'stox' | 'settings'
  dayFilter: 'all',     // 'all' | 'pending' | 'done' | 'wa'
  notesSearch: '',
  notesColorFilter: 'all',

  settings: {
    whatsapp_phone: '',
    whatsapp_reminders_enabled: true,
    daily_digest_enabled: false,
    daily_digest_time: '08:30',
    floating_btn_enabled: true,
    floating_tools: ['checklist', 'scratchpad', 'stox'],
    auto_rollover_tasks: true,
    scratchpad_content: ''
  },

  tasks: [],
  notes: [],

  // Estado del Botón Flotante
  popoverOpen: false,
  activeFloatingTool: 'checklist',
  showFloatingCustomizer: false,

  // Estado del Cronómetro / Pomodoro
  timer: {
    running: false,
    mode: 'pomodoro', // 'pomodoro' | 'short' | 'stopwatch'
    secondsLeft: 25 * 60,
    elapsedSeconds: 0,
    linkedTaskId: null,
    intervalId: null
  }
};

window.stockaWorkspaceState = wsState;

// ============================================================================
// CAPA DE PERSISTENCIA HÍBRIDA (SUPABASE + LOCALSTORAGE FALLBACK)
// ============================================================================

function getLocalKey(suffix) {
  const uid = wsState.userId || 'anon';
  return `stocka_ws_${suffix}_${uid}`;
}

function saveToLocalMirror() {
  if (!wsState.userId) return;
  try {
    localStorage.setItem(getLocalKey('settings'), JSON.stringify(wsState.settings));
    localStorage.setItem(getLocalKey('tasks'), JSON.stringify(wsState.tasks));
    localStorage.setItem(getLocalKey('notes'), JSON.stringify(wsState.notes));
  } catch (e) {
    console.warn('[Workspace] No se pudo guardar espejo local:', e);
  }
}

function loadFromLocalMirror() {
  if (!wsState.userId) return;
  try {
    const rawSettings = localStorage.getItem(getLocalKey('settings'));
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings);
      wsState.settings = { ...wsState.settings, ...parsed };
    }
    const rawTasks = localStorage.getItem(getLocalKey('tasks'));
    if (rawTasks) {
      wsState.tasks = JSON.parse(rawTasks) || [];
    }
    const rawNotes = localStorage.getItem(getLocalKey('notes'));
    if (rawNotes) {
      wsState.notes = JSON.parse(rawNotes) || [];
    }
  } catch (e) {
    console.warn('[Workspace] Error leyendo espejo local:', e);
  }
}

function seedInitialSampleDataIfEmpty() {
  const initFlagKey = getLocalKey('seeded_v1');
  if (localStorage.getItem(initFlagKey)) return;
  if (wsState.tasks.length > 0 || wsState.notes.length > 0) {
    localStorage.setItem(initFlagKey, '1');
    return;
  }

  const today = getTodayStrChile();
  wsState.tasks = [
    {
      id: crypto.randomUUID ? crypto.randomUUID() : `task_${Date.now()}_1`,
      user_id: wsState.userId,
      title: 'Revisar pendientes prioritarios del día en Stocka WMS',
      description: 'Verificar bandeja de entrada, pedidos urgentes y alertas operativas.',
      is_completed: false,
      completed_at: null,
      status: 'todo',
      priority: 'high',
      category: 'operaciones',
      target_date: today,
      recurrence: 'daily_workdays',
      subtasks: [
        { id: 'st_1', title: 'Revisar módulo de pedidos del día', done: false },
        { id: 'st_2', title: 'Confirmar prioridades con el equipo', done: false }
      ],
      linked_ref: null,
      reminder_at: null,
      reminder_whatsapp: false,
      reminder_sent: false,
      created_at: new Date().toISOString()
    }
  ];

  wsState.notes = [
    {
      id: crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}_1`,
      user_id: wsState.userId,
      title: '📌 Bienvenido a tu Panel de Trabajo',
      content: 'Usa este espacio para guardar apuntes rápidos, códigos, SKUs o recordatorios.\n\n• Puedes fijar notas importantes para verlas en el botón flotante.\n• Configura tu número de WhatsApp en la pestaña "Stox WhatsApp" para recibir tus alertas.',
      color: 'purple',
      tags: ['guia', 'stocka'],
      is_pinned: true,
      is_archived: false,
      reminder_at: null,
      reminder_whatsapp: false,
      reminder_sent: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  localStorage.setItem(initFlagKey, '1');
  saveToLocalMirror();
}

async function syncWorkspaceFromSupabase() {
  if (!wsState.userId) return;

  // 1. Cargar espejo local primero para respuesta instantánea
  loadFromLocalMirror();

  // 2. Consultar Settings en Supabase
  try {
    const { data: settingsRow, error: setErr } = await supabase
      .from('user_workspace_settings')
      .select('*')
      .eq('user_id', wsState.userId)
      .maybeSingle();

    if (setErr) {
      if (setErr.code === '42P01' || setErr.code === 'PGRST205' || String(setErr.message).includes('does not exist')) {
        wsState.supabaseTablesReady = false;
      }
    } else {
      wsState.supabaseTablesReady = true;
      if (settingsRow) {
        wsState.settings = {
          ...wsState.settings,
          ...settingsRow,
          whatsapp_phone: settingsRow.whatsapp_phone || wsState.profilePhone || '',
          floating_tools: Array.isArray(settingsRow.floating_tools)
            ? settingsRow.floating_tools
            : ['checklist', 'scratchpad', 'stox']
        };
      } else {
        wsState.settings.whatsapp_phone = wsState.settings.whatsapp_phone || wsState.profilePhone || '';
        // Crear registro inicial en Supabase
        await supabase.from('user_workspace_settings').upsert({
          user_id: wsState.userId,
          whatsapp_phone: wsState.settings.whatsapp_phone,
          whatsapp_reminders_enabled: wsState.settings.whatsapp_reminders_enabled,
          daily_digest_enabled: wsState.settings.daily_digest_enabled,
          daily_digest_time: wsState.settings.daily_digest_time,
          floating_btn_enabled: wsState.settings.floating_btn_enabled,
          floating_tools: wsState.settings.floating_tools,
          auto_rollover_tasks: wsState.settings.auto_rollover_tasks,
          scratchpad_content: wsState.settings.scratchpad_content || ''
        });
      }
    }
  } catch (e) {
    console.warn('[Workspace] Aviso consultando settings:', e.message);
  }

  if (!wsState.settings.whatsapp_phone && wsState.profilePhone) {
    wsState.settings.whatsapp_phone = wsState.profilePhone;
  }

  // 3. Consultar Tareas y Notas si las tablas existen en Supabase
  if (wsState.supabaseTablesReady) {
    try {
      const { data: dbTasks, error: tErr } = await supabase
        .from('user_workspace_tasks')
        .select('*')
        .eq('user_id', wsState.userId)
        .order('is_completed', { ascending: true })
        .order('created_at', { ascending: false });

      if (!tErr && Array.isArray(dbTasks)) {
        if (dbTasks.length > 0 || wsState.tasks.length === 0) {
          wsState.tasks = dbTasks;
        } else if (wsState.tasks.length > 0 && dbTasks.length === 0) {
          // Subir tareas locales a Supabase si estaba vacío
          for (const localTask of wsState.tasks) {
            await supabase.from('user_workspace_tasks').upsert({
              ...localTask,
              user_id: wsState.userId
            });
          }
        }
      }
    } catch (_) {}

    try {
      const { data: dbNotes, error: nErr } = await supabase
        .from('user_workspace_notes')
        .select('*')
        .eq('user_id', wsState.userId)
        .eq('is_archived', false)
        .order('is_pinned', { ascending: false })
        .order('updated_at', { ascending: false });

      if (!nErr && Array.isArray(dbNotes)) {
        if (dbNotes.length > 0 || wsState.notes.length === 0) {
          wsState.notes = dbNotes;
        } else if (wsState.notes.length > 0 && dbNotes.length === 0) {
          for (const localNote of wsState.notes) {
            await supabase.from('user_workspace_notes').upsert({
              ...localNote,
              user_id: wsState.userId
            });
          }
        }
      }
    } catch (_) {}
  }

  seedInitialSampleDataIfEmpty();
  await processDailyRolloverAndRecurrence();
  saveToLocalMirror();
  updateWorkspaceBadgesAndFAB();
}

/**
 * Procesa:
 * 1. Reinicio diario de tareas recurrentes ("Cada día hábil" o "Todos los días")
 * 2. Arrastre de tareas pendientes de días anteriores a "Hoy" si auto_rollover_tasks está activo
 */
async function processDailyRolloverAndRecurrence() {
  const today = getTodayStrChile();
  const dayOfWeek = new Date().getDay(); // 0 = Domingo
  const isWorkday = dayOfWeek !== 0;
  let modified = false;

  for (const t of wsState.tasks) {
    // Si es tarea recurrente completada en un día anterior, reiniciarla para hoy
    if (
      t.is_completed &&
      t.target_date &&
      t.target_date < today &&
      (t.recurrence === 'daily' || (t.recurrence === 'daily_workdays' && isWorkday))
    ) {
      t.is_completed = false;
      t.completed_at = null;
      t.status = 'todo';
      t.target_date = today;
      t.last_recurrence_date = today;
      if (Array.isArray(t.subtasks)) {
        t.subtasks = t.subtasks.map(st => ({ ...st, done: false }));
      }
      modified = true;
      if (wsState.supabaseTablesReady) {
        supabase.from('user_workspace_tasks').update({
          is_completed: false,
          completed_at: null,
          status: 'todo',
          target_date: today,
          last_recurrence_date: today,
          subtasks: t.subtasks
        }).eq('id', t.id).then(() => {});
      }
    }
  }

  if (modified) {
    saveToLocalMirror();
  }
}

async function persistSettings(partial = {}) {
  wsState.settings = { ...wsState.settings, ...partial };
  saveToLocalMirror();

  if (wsState.supabaseTablesReady && wsState.userId) {
    try {
      await supabase.from('user_workspace_settings').upsert({
        user_id: wsState.userId,
        whatsapp_phone: wsState.settings.whatsapp_phone || null,
        whatsapp_reminders_enabled: !!wsState.settings.whatsapp_reminders_enabled,
        daily_digest_enabled: !!wsState.settings.daily_digest_enabled,
        daily_digest_time: wsState.settings.daily_digest_time || '08:30',
        floating_btn_enabled: wsState.settings.floating_btn_enabled !== false,
        floating_tools: wsState.settings.floating_tools || ['checklist', 'scratchpad', 'stox'],
        auto_rollover_tasks: wsState.settings.auto_rollover_tasks !== false,
        scratchpad_content: wsState.settings.scratchpad_content || ''
      });
    } catch (e) {
      console.warn('[Workspace] Error guardando settings en Supabase:', e.message);
    }
  }

  updateWorkspaceBadgesAndFAB();
}

// ============================================================================
// OPERACIONES CRUD DE TAREAS, SUBTAREAS Y NOTAS
// ============================================================================

async function createWorkspaceTask({
  title,
  description = '',
  priority = 'medium',
  category = 'operaciones',
  targetDate = getTodayStrChile(),
  recurrence = 'none',
  linkedRef = '',
  reminderAt = null,
  reminderWhatsapp = false
}) {
  if (!title || !String(title).trim()) return null;

  const newTask = {
    id: crypto.randomUUID ? crypto.randomUUID() : `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: wsState.userId,
    title: String(title).trim(),
    description: String(description || '').trim(),
    is_completed: false,
    completed_at: null,
    status: 'todo',
    priority: priority || 'medium',
    category: category || 'operaciones',
    target_date: targetDate || getTodayStrChile(),
    recurrence: recurrence || 'none',
    subtasks: [],
    linked_ref: linkedRef ? String(linkedRef).trim() : null,
    reminder_at: reminderAt || null,
    reminder_whatsapp: !!reminderWhatsapp,
    reminder_sent: false,
    reminder_sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  wsState.tasks.unshift(newTask);
  saveToLocalMirror();

  if (wsState.supabaseTablesReady && wsState.userId) {
    try {
      const { data, error } = await supabase
        .from('user_workspace_tasks')
        .insert(newTask)
        .select('*')
        .maybeSingle();
      if (!error && data) {
        const idx = wsState.tasks.findIndex(t => t.id === newTask.id);
        if (idx >= 0) wsState.tasks[idx] = data;
        saveToLocalMirror();
      }
    } catch (e) {
      console.warn('[Workspace] Error insertando tarea en Supabase:', e.message);
    }
  }

  // Si tiene recordatorio de WhatsApp activado, registrarlo también en el servicio de Stox
  if (newTask.reminder_whatsapp && newTask.reminder_at) {
    registerReminderWithStoxBackend({
      id: newTask.id,
      title: newTask.title,
      description: newTask.description,
      priority: newTask.priority,
      category: newTask.category,
      linkedRef: newTask.linked_ref,
      isNote: false,
      reminderAt: newTask.reminder_at
    });
  }

  refreshAllWorkspaceViews();
  return newTask;
}

window.toggleWorkspaceTaskCheck = async function(taskId) {
  const task = wsState.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.is_completed = !task.is_completed;
  task.completed_at = task.is_completed ? new Date().toISOString() : null;
  task.status = task.is_completed ? 'done' : 'todo';
  task.updated_at = new Date().toISOString();

  saveToLocalMirror();
  refreshAllWorkspaceViews();

  if (wsState.supabaseTablesReady && wsState.userId) {
    try {
      await supabase
        .from('user_workspace_tasks')
        .update({
          is_completed: task.is_completed,
          completed_at: task.completed_at,
          status: task.status
        })
        .eq('id', taskId);
    } catch (e) {
      console.warn('[Workspace] Error actualizando check en Supabase:', e.message);
    }
  }
};

window.changeWorkspaceTaskStatus = async function(taskId, newStatus) {
  const task = wsState.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.status = newStatus;
  task.is_completed = newStatus === 'done';
  task.completed_at = task.is_completed ? new Date().toISOString() : null;
  task.updated_at = new Date().toISOString();

  saveToLocalMirror();
  refreshAllWorkspaceViews();

  if (wsState.supabaseTablesReady && wsState.userId) {
    try {
      await supabase
        .from('user_workspace_tasks')
        .update({
          status: task.status,
          is_completed: task.is_completed,
          completed_at: task.completed_at
        })
        .eq('id', taskId);
    } catch (_) {}
  }
};

window.deleteWorkspaceTask = async function(taskId) {
  wsState.tasks = wsState.tasks.filter(t => t.id !== taskId);
  saveToLocalMirror();
  refreshAllWorkspaceViews();

  if (wsState.supabaseTablesReady && wsState.userId) {
    try {
      await supabase.from('user_workspace_tasks').delete().eq('id', taskId);
    } catch (_) {}
  }
};

window.addWorkspaceSubtaskPrompt = async function(taskId) {
  const task = wsState.tasks.find(t => t.id === taskId);
  if (!task) return;

  let text = '';
  if (typeof Swal !== 'undefined') {
    const { value } = await Swal.fire({
      title: 'Añadir sub-paso a la tarea',
      input: 'text',
      inputPlaceholder: 'Ej. Validar bultos en recepción...',
      showCancelButton: true,
      confirmButtonText: 'Añadir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#6366f1'
    });
    text = value;
  } else {
    text = prompt('Escribe el sub-paso para esta tarea:');
  }

  if (!text || !text.trim()) return;
  if (!Array.isArray(task.subtasks)) task.subtasks = [];
  task.subtasks.push({
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    title: text.trim(),
    done: false
  });

  saveToLocalMirror();
  refreshAllWorkspaceViews();

  if (wsState.supabaseTablesReady && wsState.userId) {
    try {
      await supabase
        .from('user_workspace_tasks')
        .update({ subtasks: task.subtasks })
        .eq('id', taskId);
    } catch (_) {}
  }
};

window.toggleWorkspaceSubtask = async function(taskId, subId) {
  const task = wsState.tasks.find(t => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;

  const sub = task.subtasks.find(s => s.id === subId);
  if (!sub) return;
  sub.done = !sub.done;

  saveToLocalMirror();
  refreshAllWorkspaceViews();

  if (wsState.supabaseTablesReady && wsState.userId) {
    try {
      await supabase
        .from('user_workspace_tasks')
        .update({ subtasks: task.subtasks })
        .eq('id', taskId);
    } catch (_) {}
  }
};

// ============================================================================
// MOTOR DE CONEXIÓN CON STOX WHATSAPP
// ============================================================================

async function registerReminderWithStoxBackend({
  id,
  title,
  description,
  priority = 'medium',
  category = 'operaciones',
  linkedRef = null,
  isNote = false,
  reminderAt,
  sendNow = false
}) {
  const phone = normalizeChileanPhone(wsState.settings.whatsapp_phone || wsState.profilePhone);
  if (!phone) return { success: false, error: 'Sin número de WhatsApp configurado' };

  const { url, key } = getWaApiConfig();
  try {
    const resp = await fetch(`${url}/workspace/schedule-reminder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key
      },
      body: JSON.stringify({
        id,
        userId: wsState.userId,
        userName: wsState.userName,
        phone,
        title,
        description,
        priority,
        category,
        linkedRef,
        isNote,
        reminderAt,
        sendNow
      })
    });

    if (resp.ok) {
      return await resp.json();
    }

    // Fallback directo al endpoint /send-message si sendNow es true y el servidor de Render aún no tiene la ruta /workspace/schedule-reminder desplegada
    if (sendNow) {
      return await sendDirectStoxMessage(phone, formatFallbackStoxReminderText({ title, description, priority, linkedRef, isNote }));
    }
    return { success: false };
  } catch (err) {
    if (sendNow) {
      return await sendDirectStoxMessage(phone, formatFallbackStoxReminderText({ title, description, priority, linkedRef, isNote }));
    }
    return { success: false, error: err.message };
  }
}

function formatFallbackStoxReminderText({ title, description, priority, linkedRef, isNote }) {
  const firstName = (wsState.userName || 'Equipo').split(' ')[0];
  const prioMap = { urgent: '🔥 Urgente', high: '🔴 Alta', medium: '🟡 Media', low: '🔵 Baja' };
  return [
    `🤖 *Stox | Tu Asistente Personal WMS*`,
    isNote ? `📌 *RECORDATORIO DE NOTA*` : `🔔 *RECORDATORIO DE TAREA*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `¡Hola *${firstName}*! Tienes un recordatorio de tu Panel de Trabajo:`,
    ``,
    `📌 *${isNote ? 'Nota' : 'Tarea'}:* ${title}`,
    !isNote ? `⚡ *Prioridad:* ${prioMap[priority] || '🟡 Media'}` : null,
    linkedRef ? `🔗 *Referencia WMS:* ${linkedRef}` : null,
    description ? `📝 *Detalle:* ${description}` : null,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🕒 _${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}_`
  ].filter(Boolean).join('\n');
}

async function sendDirectStoxMessage(phone, message) {
  const { url, key } = getWaApiConfig();
  const cleanPhone = normalizeChileanPhone(phone);
  if (!cleanPhone) return { success: false, error: 'Número de teléfono vacío' };

  try {
    const resp = await fetch(`${url}/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key
      },
      body: JSON.stringify({
        to: cleanPhone,
        message,
        withPrefix: false
      })
    });
    return await resp.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

window.sendTaskToStoxWhatsAppNow = async function(taskId) {
  const task = wsState.tasks.find(t => t.id === taskId);
  if (!task) return;

  const phone = normalizeChileanPhone(wsState.settings.whatsapp_phone || wsState.profilePhone);
  if (!phone) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Configura tu WhatsApp',
        text: 'Primero ingresa tu número de teléfono en la pestaña "Stox WhatsApp" o "Configuración" para que Stox pueda escribirte.',
        icon: 'warning',
        confirmButtonColor: '#6366f1'
      });
    }
    wsState.activeMainTab = 'stox';
    refreshAllWorkspaceViews();
    return;
  }

  const text = formatFallbackStoxReminderText({
    title: task.title,
    description: task.description,
    priority: task.priority,
    linkedRef: task.linked_ref,
    isNote: false
  });

  const res = await sendDirectStoxMessage(phone, text);
  if (res && res.success) {
    task.reminder_sent = true;
    task.reminder_sent_at = new Date().toISOString();
    saveToLocalMirror();
    if (typeof window.showToast === 'function') {
      window.showToast('📲 Recordatorio enviado a tu WhatsApp por Stox', 'success');
    } else if (typeof Swal !== 'undefined') {
      Swal.fire({ title: '¡Enviado a tu WhatsApp!', text: `Stox envió el recordatorio de "${task.title}" al +${phone}.`, icon: 'success', timer: 2300, showConfirmButton: false });
    }
  } else {
    if (typeof Swal !== 'undefined') {
      Swal.fire({ title: 'No se pudo enviar', text: res?.error || 'Verifica que el servicio de WhatsApp de Stox esté conectado.', icon: 'error' });
    }
  }
  refreshAllWorkspaceViews();
};

window.scheduleTaskStoxReminderModal = async function(taskId) {
  const task = wsState.tasks.find(t => t.id === taskId);
  if (!task) return;

  const defaultTime = new Date(Date.now() + 30 * 60 * 1000);
  const localIso = new Date(defaultTime.getTime() - defaultTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  if (typeof Swal !== 'undefined') {
    const { value: formValues } = await Swal.fire({
      title: '🤖 Programar Recordatorio con Stox',
      html: `
        <div style="text-align: left; font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.75rem;">
          <div><strong>Tarea:</strong> ${escapeHtml(task.title)}</div>
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 0.3rem;">Fecha y Hora del aviso por WhatsApp:</label>
            <input id="swal-ws-rem-datetime" type="datetime-local" class="swal2-input" style="margin: 0; width: 100%; font-size: 0.9rem;" value="${localIso}">
          </div>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm btn-outline" onclick="const d=new Date(Date.now()+15*60000); document.getElementById('swal-ws-rem-datetime').value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);">En 15 min</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="const d=new Date(Date.now()+60*60000); document.getElementById('swal-ws-rem-datetime').value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);">En 1 hora</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="const d=new Date(); d.setHours(17,0,0,0); document.getElementById('swal-ws-rem-datetime').value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);">Hoy 17:00</button>
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-whatsapp-line"></i> Programar Aviso',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#10b981',
      preConfirm: () => {
        return document.getElementById('swal-ws-rem-datetime').value;
      }
    });

    if (!formValues) return;
    const chosenIso = new Date(formValues).toISOString();
    task.reminder_at = chosenIso;
    task.reminder_whatsapp = true;
    task.reminder_sent = false;
    saveToLocalMirror();

    if (wsState.supabaseTablesReady && wsState.userId) {
      await supabase.from('user_workspace_tasks').update({
        reminder_at: chosenIso,
        reminder_whatsapp: true,
        reminder_sent: false
      }).eq('id', task.id);
    }

    await registerReminderWithStoxBackend({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      category: task.category,
      linkedRef: task.linked_ref,
      isNote: false,
      reminderAt: chosenIso
    });

    refreshAllWorkspaceViews();
    Swal.fire({
      title: '¡Recordatorio Programado!',
      text: `Stox te enviará un WhatsApp el ${formatTimeShort(chosenIso)}.`,
      icon: 'success',
      timer: 2200,
      showConfirmButton: false
    });
  }
};

window.testStoxPersonalWhatsApp = async function(btn) {
  const phoneInput = document.getElementById('ws-cfg-wa-phone');
  if (phoneInput && phoneInput.value.trim()) {
    await persistSettings({ whatsapp_phone: phoneInput.value.trim() });
  }

  const phone = normalizeChileanPhone(wsState.settings.whatsapp_phone || wsState.profilePhone);
  if (!phone || phone.length < 8) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({ title: 'Número requerido', text: 'Ingresa un número de WhatsApp válido (ej. +56 9 1234 5678).', icon: 'warning' });
    }
    return;
  }

  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Enviando WhatsApp...';
  }

  const firstName = (wsState.userName || 'Equipo').split(' ')[0];
  const testMsg = [
    `🤖 *Stox | Tu Asistente Personal WMS*`,
    `✅ *CONEXIÓN DE PANEL DE TRABAJO EXITOSA*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `¡Hola *${firstName}*! Tu número (*+${phone}*) quedó vinculado con éxito a tu *Panel de Trabajo* de Stocka WMS.`,
    ``,
    `Aquí recibirás tus recordatorios programados y tu checklist diario.`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💡 *Comandos rápidos respondiendo a este chat:*`,
    `• *!tarea [texto]* → Añade una tarea a "Mi Día"`,
    `• *!nota [texto]* → Guarda una nota fijada en tu panel`,
    `• *!pendientes* → Muestra tu checklist y avance de hoy`,
    `• *!listo* → Marca como completado tu último recordatorio`
  ].join('\n');

  const res = await sendDirectStoxMessage(phone, testMsg);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }

  if (res && res.success) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: '¡WhatsApp enviado por Stox!',
        text: `Revisa tu WhatsApp (+${phone}). Ya estás listo para recibir recordatorios.`,
        icon: 'success',
        confirmButtonColor: '#10b981'
      });
    }
  } else {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'No se pudo entregar el mensaje',
        text: res?.error || 'Verifica que el bot Stox esté conectado.',
        icon: 'error'
      });
    }
  }
};

window.sendMyDailySummaryToWhatsApp = async function(btn) {
  const phone = normalizeChileanPhone(wsState.settings.whatsapp_phone || wsState.profilePhone);
  if (!phone) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({ title: 'Configura tu WhatsApp', text: 'Ingresa tu número de WhatsApp en la pestaña "Stox WhatsApp".', icon: 'info' });
    }
    wsState.activeMainTab = 'stox';
    refreshAllWorkspaceViews();
    return;
  }

  const today = getTodayStrChile();
  const todayTasks = getTodayTasksList();
  const doneCount = todayTasks.filter(t => t.is_completed).length;
  const pct = todayTasks.length ? Math.round((doneCount / todayTasks.length) * 100) : 0;

  const listLines = todayTasks.length > 0
    ? todayTasks.map((t, i) => `${t.is_completed ? '✅' : '⬜'} ${i + 1}. ${t.title}`).join('\n')
    : '🎉 _No tienes tareas registradas para hoy._';

  const msg = [
    `🤖 *Stox | Mi Resumen del Día (${today})*`,
    `📊 *Avance Actual:* ${doneCount}/${todayTasks.length} tareas completadas (*${pct}%*)`,
    `━━━━━━━━━━━━━━━━━━━━`,
    listLines,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💡 _Responde *!tarea [texto]* para agregar un nuevo pendiente desde tu celular._`
  ].join('\n');

  const orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Enviando...';
  }

  const res = await sendDirectStoxMessage(phone, msg);
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = orig;
  }

  if (res && res.success && typeof Swal !== 'undefined') {
    Swal.fire({ title: '¡Resumen enviado a tu WhatsApp!', icon: 'success', timer: 1800, showConfirmButton: false });
  }
};

// Vigía en el navegador cada 25 segundos para disparar recordatorios vencidos si el usuario tiene el WMS abierto
function startBrowserReminderWatcher() {
  if (window._wsReminderWatcherInterval) clearInterval(window._wsReminderWatcherInterval);
  window._wsReminderWatcherInterval = setInterval(async () => {
    const nowMs = Date.now();
    let changed = false;

    for (const task of wsState.tasks) {
      if (task.is_completed || !task.reminder_at || task.reminder_sent) continue;
      const dueMs = new Date(task.reminder_at).getTime();
      if (isNaN(dueMs) || dueMs > nowMs) continue;

      // Marcar como enviado inmediatamente para evitar doble disparo
      task.reminder_sent = true;
      task.reminder_sent_at = new Date().toISOString();
      changed = true;

      if (wsState.supabaseTablesReady && wsState.userId) {
        supabase.from('user_workspace_tasks').update({
          reminder_sent: true,
          reminder_sent_at: task.reminder_sent_at
        }).eq('id', task.id).then(() => {});
      }

      // 1. Si tenía activado WhatsApp Stox, asegurar envío directo
      if (task.reminder_whatsapp && wsState.settings.whatsapp_reminders_enabled !== false) {
        const phone = normalizeChileanPhone(wsState.settings.whatsapp_phone || wsState.profilePhone);
        if (phone) {
          const text = formatFallbackStoxReminderText({
            title: task.title,
            description: task.description,
            priority: task.priority,
            linkedRef: task.linked_ref,
            isNote: false
          });
          sendDirectStoxMessage(phone, text).catch(() => {});
        }
      }

      // 2. Mostrar notificación emergente en pantalla del WMS
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'info',
          title: `🔔 Recordatorio: ${task.title}`,
          text: task.description || 'Programado en tu Panel de Trabajo',
          showConfirmButton: true,
          confirmButtonText: '✓ Completar',
          confirmButtonColor: '#10b981',
          timer: 10000
        }).then(res => {
          if (res.isConfirmed) {
            window.toggleWorkspaceTaskCheck(task.id);
          }
        });
      }
    }

    if (changed) {
      saveToLocalMirror();
      refreshAllWorkspaceViews();
    }
  }, 25000);
}

// ============================================================================
// HELPERS DE CONSULTA Y MÉTRICAS DE "MI DÍA"
// ============================================================================

function getTodayTasksList() {
  const today = getTodayStrChile();
  const rollover = wsState.settings.auto_rollover_tasks !== false;
  return wsState.tasks.filter(t => {
    const tDate = t.target_date || today;
    if (tDate === today) return true;
    // Si auto_rollover_tasks está activo, incluir tareas no completadas de días pasados
    if (rollover && tDate < today && !t.is_completed) return true;
    return false;
  });
}

function getDailyMetrics() {
  const todayList = getTodayTasksList();
  const total = todayList.length;
  const done = todayList.filter(t => t.is_completed).length;
  const pending = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const withReminders = wsState.tasks.filter(t => !t.is_completed && t.reminder_whatsapp && t.reminder_at && !t.reminder_sent).length;

  return { total, done, pending, pct, withReminders };
}

function updateWorkspaceBadgesAndFAB() {
  const { pending, done, total } = getDailyMetrics();

  // 1. Badge en el Sidebar (Admin y Cliente)
  document.querySelectorAll('.ws-sidebar-pending-badge').forEach(el => {
    if (pending > 0) {
      el.style.display = 'inline-flex';
      el.textContent = String(pending);
    } else {
      el.style.display = 'none';
    }
  });

  // 2. Botón Flotante (FAB)
  const fab = document.getElementById('wms-workspace-fab');
  const fabBadge = document.getElementById('wms-workspace-fab-badge');
  if (fab) {
    fab.style.display = wsState.settings.floating_btn_enabled === false ? 'none' : 'flex';
  }
  if (fabBadge) {
    if (pending > 0) {
      fabBadge.textContent = String(pending);
      fabBadge.classList.remove('all-done');
    } else if (total > 0 && done === total) {
      fabBadge.textContent = '✓';
      fabBadge.classList.add('all-done');
    } else {
      fabBadge.textContent = '0';
      fabBadge.classList.remove('all-done');
    }
  }
}

function refreshAllWorkspaceViews() {
  updateWorkspaceBadgesAndFAB();
  const mainContainer = document.getElementById('ws-main-module-root');
  if (mainContainer) {
    renderWorkspaceMainContent(mainContainer);
  }
  if (wsState.popoverOpen) {
    renderFloatingPopoverContent();
  }
}

// ============================================================================
// RENDERIZADO DEL MÓDULO COMPLETO ("MI PANEL DE TRABAJO")
// ============================================================================

window.renderWorkspacePanel = async function() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  appContent.innerHTML = `
    <div id="ws-main-module-root" class="ws-container">
      <div style="padding: 3rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: #6366f1;"></i>
        <div style="margin-top: 0.5rem;">Cargando tu Panel de Trabajo...</div>
      </div>
    </div>
  `;

  if (!wsState.initialized) {
    await initWorkspaceForCurrentUser();
  } else {
    await syncWorkspaceFromSupabase();
  }

  const root = document.getElementById('ws-main-module-root');
  if (root) {
    renderWorkspaceMainContent(root);
  }
};

window.switchWorkspaceMainTab = function(tabName) {
  wsState.activeMainTab = tabName;
  refreshAllWorkspaceViews();
};

window.setWorkspaceDayFilter = function(filter) {
  wsState.dayFilter = filter;
  refreshAllWorkspaceViews();
};

function renderWorkspaceMainContent(root) {
  const { total, done, pending, pct, withReminders } = getDailyMetrics();
  const todayFormatted = new Date().toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const firstName = (wsState.userName || 'Usuario').split(' ')[0];

  root.innerHTML = `
    <!-- 1. HERO CARD CON PROGRESO DIARIO -->
    <div class="ws-hero-card">
      <div class="ws-hero-left">
        <div class="ws-hero-icon">
          <i class="ri-layout-masonry-fill"></i>
        </div>
        <div>
          <h2 class="ws-hero-title">
            <span>Panel de Trabajo de ${escapeHtml(firstName)}</span>
            <span style="font-size: 0.72rem; padding: 0.18rem 0.6rem; border-radius: 99px; background: rgba(16, 185, 129, 0.14); color: #10b981; font-weight: 700;">
              <i class="ri-whatsapp-line"></i> Stox Activo
            </span>
          </h2>
          <p class="ws-hero-subtitle" style="text-transform: capitalize;">
            📅 ${escapeHtml(todayFormatted)} · Espacio personal de tareas, notas y recordatorios
          </p>
        </div>
      </div>

      <div class="ws-progress-box">
        <div class="ws-progress-info">
          <div class="ws-progress-top">
            <span>Avance de Mi Día</span>
            <span class="ws-progress-pct">${done}/${total} (${pct}%)</span>
          </div>
          <div class="ws-progress-track">
            <div class="ws-progress-fill" style="width: ${pct}%;"></div>
          </div>
        </div>

        <div class="ws-kpi-pills">
          <span class="ws-kpi-pill" title="Tareas pendientes hoy">
            <i class="ri-time-line" style="color: #f59e0b;"></i> ${pending} pendientes
          </span>
          <span class="ws-kpi-pill" title="Recordatorios programados en Stox WhatsApp">
            <i class="ri-whatsapp-line" style="color: #10b981;"></i> ${withReminders} avisos WA
          </span>
          <button type="button" onclick="window.sendMyDailySummaryToWhatsApp(this)" class="btn btn-sm btn-outline" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; border-color: rgba(16, 185, 129, 0.4); color: #10b981; font-weight: 700;" title="Enviar mi checklist de hoy a mi WhatsApp mediante Stox">
            <i class="ri-whatsapp-line"></i> Enviarme resumen hoy
          </button>
        </div>
      </div>
    </div>

    <!-- 2. BARRA DE PESTAÑAS INTERNAS -->
    <div class="ws-nav-tabs">
      <div class="ws-nav-left">
        <button type="button" onclick="window.switchWorkspaceMainTab('day')" class="ws-tab-btn ${wsState.activeMainTab === 'day' ? 'active' : ''}">
          <i class="ri-sun-line"></i> <span>Mi Día (Checklist)</span>
          <span class="ws-tab-badge">${pending}</span>
        </button>
        <button type="button" onclick="window.switchWorkspaceMainTab('kanban')" class="ws-tab-btn ${wsState.activeMainTab === 'kanban' ? 'active' : ''}">
          <i class="ri-kanban-view-2"></i> <span>Tablero & Programadas</span>
          <span class="ws-tab-badge">${wsState.tasks.length}</span>
        </button>
        <button type="button" onclick="window.switchWorkspaceMainTab('notes')" class="ws-tab-btn ${wsState.activeMainTab === 'notes' ? 'active' : ''}">
          <i class="ri-sticky-note-line"></i> <span>Notas & Post-its</span>
          <span class="ws-tab-badge">${wsState.notes.length}</span>
        </button>
        <button type="button" onclick="window.switchWorkspaceMainTab('stox')" class="ws-tab-btn ${wsState.activeMainTab === 'stox' ? 'active' : ''}">
          <i class="ri-whatsapp-line" style="color: #10b981;"></i> <span>Recordatorios Stox (WhatsApp)</span>
        </button>
        <button type="button" onclick="window.switchWorkspaceMainTab('settings')" class="ws-tab-btn ${wsState.activeMainTab === 'settings' ? 'active' : ''}">
          <i class="ri-equalizer-line"></i> <span>Personalizar Botón Flotante</span>
        </button>
      </div>

      <div>
        <button type="button" onclick="window.toggleWorkspaceFloatingPopover(true)" class="btn btn-sm btn-outline" style="font-size: 0.76rem; padding: 0.4rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem;">
          <i class="ri-external-link-line" style="color: #6366f1;"></i> Probar Botón Flotante (Alt+W)
        </button>
      </div>
    </div>

    <!-- 3. CONTENIDO DINÁMICO SEGÚN PESTAÑA -->
    <div id="ws-tab-body-area">
      ${renderActiveTabMarkup()}
    </div>
  `;
}

function renderActiveTabMarkup() {
  switch (wsState.activeMainTab) {
    case 'kanban':
      return renderKanbanTabMarkup();
    case 'notes':
      return renderNotesTabMarkup();
    case 'stox':
      return renderStoxTabMarkup();
    case 'settings':
      return renderSettingsTabMarkup();
    case 'day':
    default:
      return renderDayTabMarkup();
  }
}

// ----------------------------------------------------------------------------
// PESTAÑA 1: MI DÍA (CHECKLIST DIARIO + SCRATCHPAD + STOX)
// ----------------------------------------------------------------------------
function renderDayTabMarkup() {
  const today = getTodayStrChile();
  let list = getTodayTasksList();

  if (wsState.dayFilter === 'pending') {
    list = list.filter(t => !t.is_completed);
  } else if (wsState.dayFilter === 'done') {
    list = list.filter(t => t.is_completed);
  } else if (wsState.dayFilter === 'wa') {
    list = list.filter(t => t.reminder_whatsapp);
  }

  const tasksHtml = list.length === 0
    ? `
      <div style="padding: 3rem 1.5rem; text-align: center; color: var(--color-text-muted);">
        <i class="ri-checkbox-circle-line" style="font-size: 2.6rem; color: #10b981; opacity: 0.45; display: block; margin-bottom: 0.5rem;"></i>
        <div style="font-weight: 700; font-size: 0.92rem; color: var(--color-text-main);">¡Todo al día en esta vista!</div>
        <div style="font-size: 0.8rem; margin-top: 0.25rem;">Añade una nueva tarea arriba o cámbiala de filtro para revisar tu historial.</div>
      </div>
    `
    : list.map(t => renderSingleTaskRowHtml(t, today)).join('');

  const configuredPhone = wsState.settings.whatsapp_phone || wsState.profilePhone || '';

  return `
    <div class="ws-day-grid">
      <!-- COLUMNA IZQUIERDA: CHECKLIST DIARIO -->
      <div class="ws-panel-card">
        <div class="ws-panel-header">
          <h3 class="ws-panel-title">
            <i class="ri-list-check-3" style="color: #6366f1; font-size: 1.1rem;"></i>
            <span>Checklist de Tareas del Día</span>
          </h3>
          <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
            <button type="button" onclick="window.setWorkspaceDayFilter('all')" class="btn btn-sm ${wsState.dayFilter === 'all' ? 'btn-primary' : 'btn-outline'}" style="padding: 0.25rem 0.6rem; font-size: 0.73rem;">Todas</button>
            <button type="button" onclick="window.setWorkspaceDayFilter('pending')" class="btn btn-sm ${wsState.dayFilter === 'pending' ? 'btn-primary' : 'btn-outline'}" style="padding: 0.25rem 0.6rem; font-size: 0.73rem;">Pendientes</button>
            <button type="button" onclick="window.setWorkspaceDayFilter('done')" class="btn btn-sm ${wsState.dayFilter === 'done' ? 'btn-primary' : 'btn-outline'}" style="padding: 0.25rem 0.6rem; font-size: 0.73rem;">Completadas</button>
            <button type="button" onclick="window.setWorkspaceDayFilter('wa')" class="btn btn-sm ${wsState.dayFilter === 'wa' ? 'btn-primary' : 'btn-outline'}" style="padding: 0.25rem 0.6rem; font-size: 0.73rem;"><i class="ri-whatsapp-line"></i> Con aviso</button>
          </div>
        </div>

        <!-- Formulario Rápido de Nueva Tarea -->
        <form class="ws-quick-add-box" onsubmit="event.preventDefault(); window.handleQuickAddTaskSubmit();">
          <div class="ws-quick-add-row">
            <input type="text" id="ws-new-task-title" class="ws-quick-input" placeholder="➕ Añadir nueva tarea para hoy (ej. Validar manifiestos Starken 17:30)..." required autocomplete="off" />
            <button type="submit" class="btn btn-primary" style="padding: 0.6rem 1.1rem; font-size: 0.84rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="ri-add-line"></i> Añadir Tarea
            </button>
          </div>

          <div class="ws-quick-meta-row">
            <select id="ws-new-task-priority" class="ws-select-sm" title="Prioridad">
              <option value="urgent">🔥 Prioridad: Urgente</option>
              <option value="high">🔴 Prioridad: Alta</option>
              <option value="medium" selected>🟡 Prioridad: Media</option>
              <option value="low">🔵 Prioridad: Baja</option>
            </select>

            <select id="ws-new-task-category" class="ws-select-sm" title="Categoría">
              <option value="operaciones">📦 Operaciones</option>
              <option value="picking">🏷️ Picking / Bodega</option>
              <option value="comercios">🏪 Comercios / KAM</option>
              <option value="facturacion">💳 Facturación</option>
              <option value="personal">👤 Personal</option>
            </select>

            <select id="ws-new-task-recurrence" class="ws-select-sm" title="Repetición automática">
              <option value="none">📅 Solo hoy</option>
              <option value="daily_workdays">🔁 Cada día hábil (Lu-Sá)</option>
              <option value="daily">🔁 Todos los días</option>
              <option value="weekly">🔁 Semanal</option>
            </select>

            <input type="text" id="ws-new-task-ref" class="ws-input-sm" placeholder="🔗 #Pedido / SKU (opc)" style="width: 135px;" />

            <label style="display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 0.28rem 0.55rem; border-radius: 7px; border: 1px solid rgba(16, 185, 129, 0.25);">
              <input type="checkbox" id="ws-new-task-wa-enable" onchange="document.getElementById('ws-new-task-wa-time').style.display = this.checked ? 'inline-block' : 'none';" />
              <i class="ri-whatsapp-line"></i> Recordar con Stox
            </label>

            <input type="datetime-local" id="ws-new-task-wa-time" class="ws-input-sm" style="display: none;" />
          </div>
        </form>

        <!-- Lista de Tareas -->
        <div class="ws-tasks-list">
          ${tasksHtml}
        </div>
      </div>

      <!-- COLUMNA DERECHA: SCRATCHPAD EN VIVO + TARJETA STOX -->
      <div style="display: flex; flex-direction: column; gap: 1.15rem;">

        <!-- Scratchpad (Borrador Instantáneo) -->
        <div class="ws-panel-card">
          <div class="ws-panel-header">
            <h3 class="ws-panel-title">
              <i class="ri-quill-pen-line" style="color: #f59e0b;"></i>
              <span>Scratchpad · Apuntes al Vuelo</span>
            </h3>
            <span id="ws-scratchpad-save-indicator" style="font-size: 0.72rem; color: #10b981; font-weight: 700;">
              <i class="ri-check-double-line"></i> Auto-guardado
            </span>
          </div>
          <div style="padding: 0.95rem 1.1rem; display: flex; flex-direction: column; gap: 0.65rem;">
            <textarea
              id="ws-main-scratchpad-input"
              class="ws-scratchpad-textarea"
              placeholder="Escribe aquí cualquier dato rápido mientras trabajas (SKUs, teléfonos, #pedidos, cálculos...). Se guarda solo al instante y también lo ves en tu botón flotante."
              oninput="window.handleWorkspaceScratchpadInput(this.value)"
            >${escapeHtml(wsState.settings.scratchpad_content || '')}</textarea>

            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
              <button type="button" onclick="window.convertScratchpadToNote()" class="btn btn-sm btn-outline" style="font-size: 0.74rem; padding: 0.32rem 0.65rem;">
                <i class="ri-pushpin-line"></i> Guardar como Nota Fijada
              </button>
              <button type="button" onclick="window.convertScratchpadLinesToTasks()" class="btn btn-sm btn-outline" style="font-size: 0.74rem; padding: 0.32rem 0.65rem; color: #6366f1; border-color: rgba(99, 102, 241, 0.35);">
                <i class="ri-list-check-2"></i> Convertir líneas en Tareas
              </button>
            </div>
          </div>
        </div>

        <!-- Resumen Rápido de Stox WhatsApp -->
        <div class="ws-panel-card" style="border-color: rgba(16, 185, 129, 0.35);">
          <div class="ws-panel-header" style="background: rgba(16, 185, 129, 0.08);">
            <h3 class="ws-panel-title" style="color: #10b981;">
              <i class="ri-whatsapp-fill" style="font-size: 1.15rem;"></i>
              <span>Recordatorios Directos con Stox</span>
            </h3>
            <button type="button" onclick="window.switchWorkspaceMainTab('stox')" class="btn btn-sm btn-outline" style="font-size: 0.72rem; padding: 0.22rem 0.55rem;">
              Configurar
            </button>
          </div>
          <div style="padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.8rem;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="color: var(--color-text-muted);">WhatsApp destino:</span>
              <strong style="color: var(--color-text-main);">${configuredPhone ? escapeHtml(configuredPhone) : '<span style="color:#f59e0b;">Sin configurar</span>'}</strong>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="color: var(--color-text-muted);">Resumen matutino:</span>
              <strong style="color: var(--color-text-main);">${wsState.settings.daily_digest_enabled ? `✅ Activo (${escapeHtml(wsState.settings.daily_digest_time)} hrs)` : '⏸️ Desactivado'}</strong>
            </div>

            <!-- Recordatorio Express en 2 clics -->
            <div style="border-top: 1px dashed var(--color-border); padding-top: 0.7rem;">
              <div style="font-weight: 700; margin-bottom: 0.4rem; color: var(--color-text-main);">⚡ Crear Recordatorio Express en WhatsApp:</div>
              <input type="text" id="ws-side-express-title" class="ws-quick-input" style="width: 100%; box-sizing: border-box; padding: 0.48rem 0.7rem; font-size: 0.8rem; margin-bottom: 0.45rem;" placeholder="¿Qué quieres que Stox te recuerde?" />
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.35rem;">
                <button type="button" onclick="window.createExpressStoxReminder(15, 'ws-side-express-title')" class="btn btn-sm btn-outline" style="font-size: 0.72rem; padding: 0.35rem;">En 15 min</button>
                <button type="button" onclick="window.createExpressStoxReminder(60, 'ws-side-express-title')" class="btn btn-sm btn-outline" style="font-size: 0.72rem; padding: 0.35rem;">En 1 hora</button>
                <button type="button" onclick="window.createExpressStoxReminder('tomorrow9', 'ws-side-express-title')" class="btn btn-sm btn-outline" style="font-size: 0.72rem; padding: 0.35rem;">Mañana 9am</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function renderSingleTaskRowHtml(t, todayStr) {
  const prioMap = {
    urgent: { label: '🔥 Urgente', cls: 'ws-badge-urgent' },
    high:   { label: '🔴 Alta', cls: 'ws-badge-high' },
    medium: { label: '🟡 Media', cls: 'ws-badge-medium' },
    low:    { label: '🔵 Baja', cls: 'ws-badge-low' }
  };
  const pInfo = prioMap[t.priority] || prioMap.medium;

  const recMap = {
    daily_workdays: '🔁 Diaria hábil',
    daily: '🔁 Diaria',
    weekly: '🔁 Semanal',
    monthly: '🔁 Mensual'
  };
  const recLabel = recMap[t.recurrence] || null;
  const isOverdue = !t.is_completed && t.target_date && t.target_date < todayStr;
  const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];

  return `
    <div class="ws-task-item ${t.is_completed ? 'is-done' : ''}">
      <div class="ws-task-main-row">
        <div class="ws-task-left">
          <button
            type="button"
            class="ws-check-btn ${t.is_completed ? 'checked' : ''}"
            onclick="window.toggleWorkspaceTaskCheck('${t.id}')"
            title="${t.is_completed ? 'Desmarcar tarea' : 'Marcar como completada'}"
          >
            <i class="ri-check-line" style="font-size: 0.9rem; font-weight: 900;"></i>
          </button>

          <div style="flex: 1; min-width: 0;">
            <div class="ws-task-title" onclick="window.toggleWorkspaceTaskCheck('${t.id}')">
              ${escapeHtml(t.title)}
            </div>
            ${t.description ? `<div class="ws-task-desc">${escapeHtml(t.description)}</div>` : ''}

            <div class="ws-task-badges">
              <span class="ws-badge ${pInfo.cls}">${pInfo.label}</span>
              <span class="ws-badge ws-badge-cat">${escapeHtml(t.category || 'operaciones')}</span>
              ${recLabel ? `<span class="ws-badge ws-badge-rec">${recLabel}</span>` : ''}
              ${isOverdue ? `<span class="ws-badge ws-badge-urgent">⚠️ Pendiente de ${escapeHtml(t.target_date)}</span>` : ''}
              ${t.linked_ref ? `<span class="ws-badge ws-badge-cat" style="color: #6366f1; border-color: rgba(99,102,241,0.3);"><i class="ri-links-line"></i> ${escapeHtml(t.linked_ref)}</span>` : ''}
              ${t.reminder_whatsapp && t.reminder_at ? `
                <span class="ws-badge ws-badge-wa" title="${t.reminder_sent ? 'Recordatorio ya enviado por Stox' : 'Recordatorio programado en Stox WhatsApp'}">
                  <i class="ri-whatsapp-line"></i> ${t.reminder_sent ? 'Enviado' : formatTimeShort(t.reminder_at)}
                </span>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="ws-task-actions">
          <button type="button" class="ws-icon-btn" onclick="window.scheduleTaskStoxReminderModal('${t.id}')" title="Programar hora de recordatorio por WhatsApp (Stox)">
            <i class="ri-alarm-line" style="color: #10b981;"></i>
          </button>
          <button type="button" class="ws-icon-btn" onclick="window.sendTaskToStoxWhatsAppNow('${t.id}')" title="Enviar ahora mismo a mi WhatsApp con Stox">
            <i class="ri-whatsapp-line" style="color: #10b981;"></i>
          </button>
          <button type="button" class="ws-icon-btn" onclick="window.addWorkspaceSubtaskPrompt('${t.id}')" title="Añadir sub-paso / checklist interno">
            <i class="ri-Node-tree" style="color: #6366f1;"></i>
          </button>
          <button type="button" class="ws-icon-btn danger" onclick="window.deleteWorkspaceTask('${t.id}')" title="Eliminar tarea">
            <i class="ri-delete-bin-6-line"></i>
          </button>
        </div>
      </div>

      ${subtasks.length > 0 ? `
        <div class="ws-subtasks-wrap">
          ${subtasks.map(st => `
            <label class="ws-subtask-row" style="cursor: pointer;">
              <input type="checkbox" ${st.done ? 'checked' : ''} onchange="window.toggleWorkspaceSubtask('${t.id}', '${st.id}')" style="accent-color: #10b981; cursor: pointer;" />
              <span style="${st.done ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(st.title)}</span>
            </label>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ----------------------------------------------------------------------------
// PESTAÑA 2: TABLERO KANBAN & TAREAS PROGRAMADAS
// ----------------------------------------------------------------------------
function renderKanbanTabMarkup() {
  const columns = [
    { key: 'todo', label: '⏳ Por Hacer', color: '#f59e0b' },
    { key: 'in_progress', label: '⚡ En Curso', color: '#3b82f6' },
    { key: 'waiting', label: '⏸️ En Espera', color: '#8b5cf6' },
    { key: 'done', label: '✅ Completadas', color: '#10b981' }
  ];

  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="ws-panel-card" style="padding: 0.9rem 1.2rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <div>
          <strong style="font-size: 0.9rem; color: var(--color-text-main);">📋 Tablero Kanban Operativo</strong>
          <span style="font-size: 0.8rem; color: var(--color-text-muted); margin-left: 0.5rem;">Mueve tus tareas de estado con un clic o programa tareas para fechas futuras.</span>
        </div>
        <button type="button" onclick="window.openNewScheduledTaskModal()" class="btn btn-sm btn-primary" style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <i class="ri-calendar-todo-line"></i> Programar Tarea Futura
        </button>
      </div>

      <div class="ws-kanban-board">
        ${columns.map(col => {
          const colTasks = wsState.tasks.filter(t => {
            const st = t.is_completed ? 'done' : (t.status === 'done' ? 'todo' : (t.status || 'todo'));
            return st === col.key;
          });

          return `
            <div class="ws-kanban-col">
              <div class="ws-kanban-col-header" style="border-top: 3px solid ${col.color};">
                <span>${col.label}</span>
                <span class="ws-tab-badge">${colTasks.length}</span>
              </div>
              <div class="ws-kanban-col-body">
                ${colTasks.length === 0 ? `<div style="text-align: center; padding: 1.5rem 0.5rem; font-size: 0.76rem; color: var(--color-text-muted);">Sin tareas en esta etapa</div>` : ''}
                ${colTasks.map(t => `
                  <div class="ws-kanban-card">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.4rem;">
                      <strong style="font-size: 0.82rem; color: var(--color-text-main); ${t.is_completed ? 'text-decoration: line-through; opacity: 0.65;' : ''}">${escapeHtml(t.title)}</strong>
                      <button type="button" class="ws-icon-btn danger" style="width:22px;height:22px;" onclick="window.deleteWorkspaceTask('${t.id}')"><i class="ri-close-line"></i></button>
                    </div>
                    ${t.description ? `<div style="font-size: 0.74rem; color: var(--color-text-muted);">${escapeHtml(t.description)}</div>` : ''}
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; margin-top: 0.25rem; flex-wrap: wrap;">
                      <span style="font-size: 0.7rem; color: var(--color-text-muted);"><i class="ri-calendar-line"></i> ${escapeHtml(t.target_date || '')}</span>
                      <select onchange="window.changeWorkspaceTaskStatus('${t.id}', this.value)" class="ws-select-sm" style="padding: 0.15rem 0.35rem; font-size: 0.7rem;">
                        <option value="todo" ${(!t.is_completed && t.status === 'todo') ? 'selected' : ''}>Por Hacer</option>
                        <option value="in_progress" ${(!t.is_completed && t.status === 'in_progress') ? 'selected' : ''}>En Curso</option>
                        <option value="waiting" ${(!t.is_completed && t.status === 'waiting') ? 'selected' : ''}>En Espera</option>
                        <option value="done" ${t.is_completed ? 'selected' : ''}>Completada ✓</option>
                      </select>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// PESTAÑA 3: MURAL DE NOTAS Y POST-ITS
// ----------------------------------------------------------------------------
function renderNotesTabMarkup() {
  const q = (wsState.notesSearch || '').toLowerCase().trim();
  const cFilter = wsState.notesColorFilter || 'all';

  const filtered = wsState.notes.filter(n => {
    if (n.is_archived) return false;
    if (cFilter !== 'all' && n.color !== cFilter) return false;
    if (q) {
      const hay = `${n.title || ''} ${n.content || ''} ${(n.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return `
    <div style="display: flex; flex-direction: column; gap: 1.15rem;">
      <!-- Barra superior de creación y búsqueda de notas -->
      <div class="ws-panel-card" style="padding: 1rem 1.25rem; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.85rem;">
        <div style="display: flex; align-items: center; gap: 0.65rem; flex: 1; min-width: 240px;">
          <input
            type="text"
            class="ws-quick-input"
            placeholder="🔍 Buscar en mis notas por título, SKU, código o contenido..."
            value="${escapeHtml(wsState.notesSearch)}"
            oninput="window.handleWorkspaceNotesSearch(this.value)"
          />
          <select class="ws-select-sm" onchange="window.handleWorkspaceNotesColorFilter(this.value)" style="padding: 0.55rem 0.7rem;">
            <option value="all" ${cFilter === 'all' ? 'selected' : ''}>🎨 Todos los colores</option>
            <option value="amber" ${cFilter === 'amber' ? 'selected' : ''}>🟡 Amarillo</option>
            <option value="blue" ${cFilter === 'blue' ? 'selected' : ''}>🔵 Azul</option>
            <option value="emerald" ${cFilter === 'emerald' ? 'selected' : ''}>🟢 Verde</option>
            <option value="purple" ${cFilter === 'purple' ? 'selected' : ''}>🟣 Morado</option>
            <option value="rose" ${cFilter === 'rose' ? 'selected' : ''}>🔴 Coral</option>
          </select>
        </div>

        <button type="button" onclick="window.openWorkspaceNoteModal()" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 700;">
          <i class="ri-sticky-note-add-line"></i> + Nueva Nota
        </button>
      </div>

      <!-- Cuadrícula de Notas -->
      <div class="ws-notes-grid">
        ${filtered.length === 0 ? `
          <div class="ws-panel-card" style="grid-column: 1 / -1; padding: 3rem; text-align: center; color: var(--color-text-muted);">
            <i class="ri-sticky-note-line" style="font-size: 2.5rem; opacity: 0.35; display: block; margin-bottom: 0.5rem;"></i>
            No hay notas que coincidan. Pulsa <strong>+ Nueva Nota</strong> para crear un apunte o tarjeta fijada.
          </div>
        ` : filtered.map(n => `
          <div class="ws-note-card color-${escapeHtml(n.color || 'default')}">
            <div>
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem;">
                <h4 style="margin: 0; font-size: 0.92rem; font-weight: 800; color: var(--color-text-main);">
                  ${n.is_pinned ? '<i class="ri-pushpin-2-fill" style="color: #f59e0b; margin-right: 0.25rem;" title="Nota fijada en botón flotante"></i>' : ''}
                  ${escapeHtml(n.title || 'Nota sin título')}
                </h4>
                <div style="display: flex; align-items: center; gap: 0.2rem;">
                  <button type="button" class="ws-icon-btn" onclick="window.togglePinWorkspaceNote('${n.id}')" title="${n.is_pinned ? 'Desfijar nota' : 'Fijar nota en el botón flotante'}">
                    <i class="${n.is_pinned ? 'ri-pushpin-2-fill' : 'ri-pushpin-line'}" style="${n.is_pinned ? 'color:#f59e0b;' : ''}"></i>
                  </button>
                  <button type="button" class="ws-icon-btn" onclick="window.openWorkspaceNoteModal('${n.id}')" title="Editar nota">
                    <i class="ri-edit-line"></i>
                  </button>
                  <button type="button" class="ws-icon-btn danger" onclick="window.deleteWorkspaceNote('${n.id}')" title="Eliminar nota">
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </div>
              </div>
              <div style="font-size: 0.82rem; color: var(--color-text-main); white-space: pre-wrap; line-height: 1.5; max-height: 200px; overflow-y: auto;">${escapeHtml(n.content)}</div>
            </div>

            <div style="border-top: 1px dashed var(--color-border); padding-top: 0.6rem; display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap;">
              <button type="button" onclick="window.convertNoteToDailyTask('${n.id}')" class="btn btn-sm btn-outline" style="font-size: 0.72rem; padding: 0.22rem 0.5rem;" title="Crear una tarea en Mi Día a partir de esta nota">
                <i class="ri-checkbox-circle-line"></i> Pasar a Mi Día
              </button>
              <button type="button" onclick="window.sendNoteToStoxWhatsApp('${n.id}')" class="btn btn-sm btn-outline" style="font-size: 0.72rem; padding: 0.22rem 0.5rem; color: #10b981; border-color: rgba(16,185,129,0.35);" title="Enviar esta nota a mi WhatsApp con Stox">
                <i class="ri-whatsapp-line"></i> Enviar a mi WA
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// PESTAÑA 4: CENTRO DE RECORDATORIOS STOX WHATSAPP
// ----------------------------------------------------------------------------
function renderStoxTabMarkup() {
  const phone = wsState.settings.whatsapp_phone || wsState.profilePhone || '';
  const scheduledTasks = wsState.tasks.filter(t => t.reminder_whatsapp && t.reminder_at && !t.is_completed);

  return `
    <div class="ws-day-grid">
      <!-- Configuración y Estado de Stox -->
      <div class="ws-panel-card">
        <div class="ws-panel-header" style="background: rgba(16, 185, 129, 0.08);">
          <h3 class="ws-panel-title" style="color: #10b981;">
            <i class="ri-whatsapp-fill" style="font-size: 1.2rem;"></i>
            <span>Configuración de Recordatorios por WhatsApp (Stox)</span>
          </h3>
        </div>

        <div style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1.15rem;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem;">
            <div>
              <label style="display: block; font-size: 0.8rem; font-weight: 700; margin-bottom: 0.35rem; color: var(--color-text-main);">
                📱 Tu Número de WhatsApp para Recordatorios
              </label>
              <input
                type="text"
                id="ws-cfg-wa-phone"
                class="ws-quick-input"
                style="width: 100%; box-sizing: border-box;"
                placeholder="Ej. +56 9 8765 4321"
                value="${escapeHtml(phone)}"
              />
              <small style="font-size: 0.73rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">
                Stox enviará tus alertas personales directamente a este número.
              </small>
            </div>

            <div>
              <label style="display: block; font-size: 0.8rem; font-weight: 700; margin-bottom: 0.35rem; color: var(--color-text-main);">
                ☀️ Hora de Resumen Matutino Diario (Días Hábiles)
              </label>
              <div style="display: flex; align-items: center; gap: 0.65rem;">
                <label style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; font-weight: 600; cursor: pointer;">
                  <input type="checkbox" id="ws-cfg-digest-enabled" ${wsState.settings.daily_digest_enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:#10b981;" />
                  Recibir resumen diario
                </label>
                <input
                  type="time"
                  id="ws-cfg-digest-time"
                  class="ws-input-sm"
                  value="${escapeHtml(wsState.settings.daily_digest_time || '08:30')}"
                />
              </div>
              <small style="font-size: 0.73rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">
                Respeta automáticamente domingos y feriados del calendario operacional de Stocka.
              </small>
            </div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--color-border);">
            <button type="button" onclick="window.testStoxPersonalWhatsApp(this)" class="btn btn-outline" style="border-color: #10b981; color: #10b981; font-weight: 700; display: inline-flex; align-items: center; gap: 0.4rem;">
              <i class="ri-whatsapp-line"></i> 📲 Probar envío de Stox a mi WhatsApp
            </button>

            <button type="button" onclick="window.saveWorkspaceStoxConfig()" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 700;">
              <i class="ri-save-line"></i> Guardar Configuración de WhatsApp
            </button>
          </div>

          <!-- Lista de Recordatorios Programados -->
          <div style="margin-top: 0.5rem;">
            <h4 style="margin: 0 0 0.65rem 0; font-size: 0.88rem; font-weight: 700; color: var(--color-text-main);">
              🔔 Próximos Recordatorios Programados (${scheduledTasks.length})
            </h4>
            ${scheduledTasks.length === 0 ? `
              <div style="padding: 1.5rem; background: var(--color-bg); border: 1px dashed var(--color-border); border-radius: 10px; text-align: center; font-size: 0.8rem; color: var(--color-text-muted);">
                No tienes recordatorios pendientes en cola. Pulsa el ícono <i class="ri-alarm-line" style="color:#10b981;"></i> en cualquier tarea para programar un aviso.
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                ${scheduledTasks.map(t => `
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.7rem 0.95rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 10px;">
                    <div>
                      <div style="font-size: 0.84rem; font-weight: 700; color: var(--color-text-main);">${escapeHtml(t.title)}</div>
                      <div style="font-size: 0.75rem; color: #10b981; font-weight: 600;">
                        <i class="ri-time-line"></i> Programado: ${formatTimeShort(t.reminder_at)} · ${t.reminder_sent ? '✅ Ya enviado' : '⏳ En espera de envío'}
                      </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <button type="button" onclick="window.sendTaskToStoxWhatsAppNow('${t.id}')" class="btn btn-sm btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.55rem; color: #10b981;">
                        Enviar ahora
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>

      <!-- Comandos de WhatsApp con Stox -->
      <div class="ws-panel-card">
        <div class="ws-panel-header">
          <h3 class="ws-panel-title">
            <i class="ri-robot-2-line" style="color: #6366f1;"></i>
            <span>Comandos por WhatsApp con Stox</span>
          </h3>
        </div>
        <div style="padding: 1.1rem; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.8rem;">
          <p style="margin: 0; color: var(--color-text-muted); line-height: 1.45;">
            Cuando Stox te envíe un recordatorio (o en cualquier momento desde tu celular), puedes escribirle directamente estos comandos:
          </p>
          <div style="padding: 0.65rem 0.8rem; border-radius: 9px; background: var(--color-bg); border: 1px solid var(--color-border);">
            <strong style="color: #10b981;">!listo</strong> o <strong style="color: #10b981;">!check</strong>
            <div style="color: var(--color-text-muted); font-size: 0.75rem; margin-top: 0.15rem;">Marca automáticamente como completada la última tarea que Stox te recordó.</div>
          </div>
          <div style="padding: 0.65rem 0.8rem; border-radius: 9px; background: var(--color-bg); border: 1px solid var(--color-border);">
            <strong style="color: #f59e0b;">!posponer 30</strong>
            <div style="color: var(--color-text-muted); font-size: 0.75rem; margin-top: 0.15rem;">Pospone el recordatorio 30 minutos (o los minutos que indiques) y vuelve a avisarte.</div>
          </div>
          <div style="padding: 0.65rem 0.8rem; border-radius: 9px; background: var(--color-bg); border: 1px solid var(--color-border);">
            <strong style="color: #6366f1;">!tarea Revisar stock de cliente</strong>
            <div style="color: var(--color-text-muted); font-size: 0.75rem; margin-top: 0.15rem;">Añade esa tarea inmediatamente a tu lista de <strong>Mi Día</strong> en el WMS.</div>
          </div>
          <div style="padding: 0.65rem 0.8rem; border-radius: 9px; background: var(--color-bg); border: 1px solid var(--color-border);">
            <strong style="color: #8b5cf6;">!nota Código candado bodega 4920</strong>
            <div style="color: var(--color-text-muted); font-size: 0.75rem; margin-top: 0.15rem;">Crea una nota fijada en tu Panel de Trabajo desde tu celular.</div>
          </div>
          <div style="padding: 0.65rem 0.8rem; border-radius: 9px; background: var(--color-bg); border: 1px solid var(--color-border);">
            <strong style="color: #3b82f6;">!pendientes</strong>
            <div style="color: var(--color-text-muted); font-size: 0.75rem; margin-top: 0.15rem;">Stox te responde con tu lista de hoy y tu porcentaje de avance.</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// PESTAÑA 5: PERSONALIZACIÓN DEL BOTÓN FLOTANTE Y PREFERENCIAS
// ----------------------------------------------------------------------------
function renderSettingsTabMarkup() {
  const activeTools = Array.isArray(wsState.settings.floating_tools)
    ? wsState.settings.floating_tools
    : ['checklist', 'scratchpad', 'stox'];

  return `
    <div class="ws-day-grid">
      <div class="ws-panel-card">
        <div class="ws-panel-header">
          <h3 class="ws-panel-title">
            <i class="ri-equalizer-line" style="color: #6366f1;"></i>
            <span>Selecciona las Herramientas de tu Botón Flotante</span>
          </h3>
        </div>
        <div style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <p style="margin: 0; font-size: 0.83rem; color: var(--color-text-muted); line-height: 1.5;">
            Para no sobrecargar tu pantalla mientras trabajas en otros módulos del WMS, elige <strong>únicamente las herramientas que quieras tener a mano</strong> al desplegar el botón flotante (<code>Alt + W</code>):
          </p>

          <div style="display: flex; flex-direction: column; gap: 0.65rem;">
            ${FLOATING_TOOLS_CATALOG.map(tool => {
              const checked = activeTools.includes(tool.key);
              return `
                <label style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.85rem 1rem; border-radius: 11px; background: var(--color-bg); border: 1.5px solid ${checked ? '#6366f1' : 'var(--color-border)'}; cursor: pointer; transition: all 0.15s;">
                  <div style="display: flex; align-items: center; gap: 0.8rem;">
                    <div style="width: 38px; height: 38px; border-radius: 10px; background: ${checked ? 'rgba(99,102,241,0.15)' : 'var(--color-surface)'}; color: ${checked ? '#6366f1' : 'var(--color-text-muted)'}; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
                      <i class="${tool.icon}"></i>
                    </div>
                    <div>
                      <div style="font-size: 0.88rem; font-weight: 700; color: var(--color-text-main);">${tool.label}</div>
                      <div style="font-size: 0.76rem; color: var(--color-text-muted);">${tool.description}</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    ${checked ? 'checked' : ''}
                    onchange="window.toggleUserFloatingTool('${tool.key}', this.checked)"
                    style="width: 18px; height: 18px; accent-color: #6366f1; cursor: pointer; flex-shrink: 0;"
                  />
                </label>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="ws-panel-card">
        <div class="ws-panel-header">
          <h3 class="ws-panel-title">
            <i class="ri-settings-4-line" style="color: #10b981;"></i>
            <span>Preferencias Generales del Panel</span>
          </h3>
        </div>
        <div style="padding: 1.2rem; display: flex; flex-direction: column; gap: 0.9rem; font-size: 0.82rem;">
          <label style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; cursor: pointer;">
            <div>
              <div style="font-weight: 700; color: var(--color-text-main);">Mostrar Botón Flotante Rápido</div>
              <div style="font-size: 0.74rem; color: var(--color-text-muted);">Muestra el botón de acceso rápido en la esquina derecha en todas las vistas.</div>
            </div>
            <input type="checkbox" ${wsState.settings.floating_btn_enabled !== false ? 'checked' : ''} onchange="window.updateWorkspaceBooleanSetting('floating_btn_enabled', this.checked)" style="width:18px;height:18px;accent-color:#6366f1;" />
          </label>

          <hr style="border: none; border-top: 1px solid var(--color-border); margin: 0;" />

          <label style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; cursor: pointer;">
            <div>
              <div style="font-weight: 700; color: var(--color-text-main);">Arrastrar tareas no completadas al día siguiente</div>
              <div style="font-size: 0.74rem; color: var(--color-text-muted);">Si una tarea de ayer quedó sin check, se mantiene visible en "Mi Día" hoy.</div>
            </div>
            <input type="checkbox" ${wsState.settings.auto_rollover_tasks !== false ? 'checked' : ''} onchange="window.updateWorkspaceBooleanSetting('auto_rollover_tasks', this.checked)" style="width:18px;height:18px;accent-color:#6366f1;" />
          </label>

          <hr style="border: none; border-top: 1px solid var(--color-border); margin: 0;" />

          <div style="padding: 0.75rem; border-radius: 10px; background: var(--color-bg); border: 1px solid var(--color-border);">
            <div style="font-weight: 700; color: var(--color-text-main); margin-bottom: 0.25rem;">
              Estado de Sincronización en Nube (Supabase)
            </div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">
              ${wsState.supabaseTablesReady
                ? '✅ Conectado a las tablas <code>user_workspace_tasks</code>, <code>user_workspace_notes</code> y <code>user_workspace_settings</code>.'
                : 'ℹ️ Modo Híbrido Local Activo. Ejecuta el script <code>supabase_schema_workspace_panel.sql</code> en el SQL Editor de Supabase para habilitar sincronización multi-dispositivo.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// HANDLERS DE INTERACCIÓN DEL MÓDULO COMPLETO
// ============================================================================

window.handleQuickAddTaskSubmit = async function() {
  const titleEl = document.getElementById('ws-new-task-title');
  const prioEl = document.getElementById('ws-new-task-priority');
  const catEl = document.getElementById('ws-new-task-category');
  const recEl = document.getElementById('ws-new-task-recurrence');
  const refEl = document.getElementById('ws-new-task-ref');
  const waCheckEl = document.getElementById('ws-new-task-wa-enable');
  const waTimeEl = document.getElementById('ws-new-task-wa-time');

  if (!titleEl || !titleEl.value.trim()) return;

  let reminderAt = null;
  const reminderWhatsapp = !!(waCheckEl && waCheckEl.checked);
  if (reminderWhatsapp) {
    if (waTimeEl && waTimeEl.value) {
      reminderAt = new Date(waTimeEl.value).toISOString();
    } else {
      // Por defecto en 1 hora si marcó recordar pero no especificó hora
      reminderAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }
  }

  await createWorkspaceTask({
    title: titleEl.value.trim(),
    priority: prioEl ? prioEl.value : 'medium',
    category: catEl ? catEl.value : 'operaciones',
    recurrence: recEl ? recEl.value : 'none',
    linkedRef: refEl ? refEl.value.trim() : '',
    reminderAt,
    reminderWhatsapp
  });

  titleEl.value = '';
  if (refEl) refEl.value = '';
};

window.handleWorkspaceScratchpadInput = function(value) {
  wsState.settings.scratchpad_content = value;
  saveToLocalMirror();

  // Sincronizar también si el otro textarea (flotante o principal) está en el DOM
  const mainSp = document.getElementById('ws-main-scratchpad-input');
  const floatSp = document.getElementById('ws-float-scratchpad-input');
  if (mainSp && mainSp.value !== value) mainSp.value = value;
  if (floatSp && floatSp.value !== value) floatSp.value = value;

  const ind = document.getElementById('ws-scratchpad-save-indicator');
  if (ind) ind.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

  clearTimeout(window._wsScratchpadTimer);
  window._wsScratchpadTimer = setTimeout(async () => {
    await persistSettings({ scratchpad_content: value });
    const indAfter = document.getElementById('ws-scratchpad-save-indicator');
    if (indAfter) indAfter.innerHTML = '<i class="ri-check-double-line"></i> Auto-guardado';
  }, 550);
};

window.convertScratchpadToNote = async function() {
  const content = (wsState.settings.scratchpad_content || '').trim();
  if (!content) return;

  const newNote = {
    id: crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}`,
    user_id: wsState.userId,
    title: `Apunte rápido (${new Date().toLocaleDateString('es-CL')})`,
    content,
    color: 'amber',
    tags: ['scratchpad'],
    is_pinned: true,
    is_archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  wsState.notes.unshift(newNote);
  saveToLocalMirror();
  if (wsState.supabaseTablesReady && wsState.userId) {
    supabase.from('user_workspace_notes').insert(newNote).then(() => {});
  }

  refreshAllWorkspaceViews();
  if (typeof Swal !== 'undefined') {
    Swal.fire({ title: '¡Guardado en tus Notas Fijadas!', icon: 'success', timer: 1600, showConfirmButton: false });
  }
};

window.convertScratchpadLinesToTasks = async function() {
  const raw = (wsState.settings.scratchpad_content || '').trim();
  if (!raw) return;

  const lines = raw
    .split('\n')
    .map(l => l.replace(/^[-•*☑️⬜\[\]\s]+/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return;

  for (const line of lines) {
    await createWorkspaceTask({ title: line, priority: 'medium', category: 'operaciones' });
  }

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: `¡${lines.length} ${lines.length === 1 ? 'tarea creada' : 'tareas creadas'}!`,
      text: 'Se agregaron las líneas de tu Scratchpad al checklist de Mi Día.',
      icon: 'success',
      timer: 1900,
      showConfirmButton: false
    });
  }
};

window.createExpressStoxReminder = async function(whenSpec, inputId) {
  const input = document.getElementById(inputId);
  const title = input ? input.value.trim() : '';
  if (!title) {
    if (input) input.focus();
    return;
  }

  let targetDateObj = new Date();
  if (whenSpec === 'tomorrow9') {
    targetDateObj.setDate(targetDateObj.getDate() + 1);
    targetDateObj.setHours(9, 0, 0, 0);
  } else {
    const mins = Number(whenSpec) || 15;
    targetDateObj = new Date(Date.now() + mins * 60 * 1000);
  }

  const reminderIso = targetDateObj.toISOString();
  await createWorkspaceTask({
    title,
    priority: 'high',
    category: 'operaciones',
    targetDate: targetDateObj.toISOString().split('T')[0],
    reminderAt: reminderIso,
    reminderWhatsapp: true
  });

  if (input) input.value = '';
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: `🤖 Stox te avisará por WhatsApp (${formatTimeShort(reminderIso)})`,
      showConfirmButton: false,
      timer: 3000
    });
  }
};

window.openNewScheduledTaskModal = async function() {
  const today = getTodayStrChile();
  if (typeof Swal === 'undefined') return;

  const { value: form } = await Swal.fire({
    title: '📅 Programar Tarea',
    html: `
      <div style="text-align:left; font-size:0.84rem; display:flex; flex-direction:column; gap:0.7rem;">
        <div>
          <label style="font-weight:700; display:block; margin-bottom:0.25rem;">Título de la tarea *</label>
          <input id="swal-sched-title" class="swal2-input" style="margin:0;width:100%;font-size:0.88rem;" placeholder="Ej. Auditoría mensual de stock..." />
        </div>
        <div>
          <label style="font-weight:700; display:block; margin-bottom:0.25rem;">Descripción / Notas</label>
          <textarea id="swal-sched-desc" class="swal2-textarea" style="margin:0;width:100%;font-size:0.84rem;height:70px;" placeholder="Detalles adicionales..."></textarea>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;">
          <div>
            <label style="font-weight:700; display:block; margin-bottom:0.25rem;">Fecha Objetivo</label>
            <input type="date" id="swal-sched-date" class="swal2-input" style="margin:0;width:100%;font-size:0.84rem;" value="${today}" />
          </div>
          <div>
            <label style="font-weight:700; display:block; margin-bottom:0.25rem;">Prioridad</label>
            <select id="swal-sched-prio" class="swal2-input" style="margin:0;width:100%;font-size:0.84rem;">
              <option value="urgent">🔥 Urgente</option>
              <option value="high">🔴 Alta</option>
              <option value="medium" selected>🟡 Media</option>
              <option value="low">🔵 Baja</option>
            </select>
          </div>
        </div>
        <div>
          <label style="font-weight:700; display:block; margin-bottom:0.25rem;">🤖 Recordatorio por WhatsApp (Stox) - Opcional</label>
          <input type="datetime-local" id="swal-sched-wa" class="swal2-input" style="margin:0;width:100%;font-size:0.84rem;" />
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Guardar Tarea',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#6366f1',
    preConfirm: () => {
      const title = document.getElementById('swal-sched-title').value.trim();
      if (!title) {
        Swal.showValidationMessage('Escribe un título para la tarea');
        return false;
      }
      return {
        title,
        description: document.getElementById('swal-sched-desc').value.trim(),
        targetDate: document.getElementById('swal-sched-date').value || today,
        priority: document.getElementById('swal-sched-prio').value,
        waTime: document.getElementById('swal-sched-wa').value
      };
    }
  });

  if (!form) return;
  await createWorkspaceTask({
    title: form.title,
    description: form.description,
    targetDate: form.targetDate,
    priority: form.priority,
    reminderAt: form.waTime ? new Date(form.waTime).toISOString() : null,
    reminderWhatsapp: !!form.waTime
  });
};

// Notas CRUD
window.handleWorkspaceNotesSearch = function(val) {
  wsState.notesSearch = val;
  const area = document.getElementById('ws-tab-body-area');
  if (area && wsState.activeMainTab === 'notes') {
    area.innerHTML = renderNotesTabMarkup();
    const input = area.querySelector('input[type="text"]');
    if (input) {
      input.focus();
      input.setSelectionRange(val.length, val.length);
    }
  }
};

window.handleWorkspaceNotesColorFilter = function(color) {
  wsState.notesColorFilter = color;
  refreshAllWorkspaceViews();
};

window.openWorkspaceNoteModal = async function(noteId = null) {
  const existing = noteId ? wsState.notes.find(n => n.id === noteId) : null;
  if (typeof Swal === 'undefined') return;

  const { value: form } = await Swal.fire({
    title: existing ? '✏️ Editar Nota' : '📝 Nueva Nota Personal',
    html: `
      <div style="text-align:left; font-size:0.84rem; display:flex; flex-direction:column; gap:0.7rem;">
        <div>
          <label style="font-weight:700; display:block; margin-bottom:0.25rem;">Título</label>
          <input id="swal-note-title" class="swal2-input" style="margin:0;width:100%;font-size:0.88rem;" placeholder="Ej. Reglas de embalaje / Códigos..." value="${escapeHtml(existing?.title || '')}" />
        </div>
        <div>
          <label style="font-weight:700; display:block; margin-bottom:0.25rem;">Contenido *</label>
          <textarea id="swal-note-content" class="swal2-textarea" style="margin:0;width:100%;font-size:0.84rem;height:120px;" placeholder="Escribe tu nota aquí...">${escapeHtml(existing?.content || '')}</textarea>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; align-items:center;">
          <div>
            <label style="font-weight:700; display:block; margin-bottom:0.25rem;">Color de Tarjeta</label>
            <select id="swal-note-color" class="swal2-input" style="margin:0;width:100%;font-size:0.84rem;">
              <option value="default" ${existing?.color === 'default' ? 'selected' : ''}>⚪ Neutro</option>
              <option value="amber" ${existing?.color === 'amber' ? 'selected' : ''}>🟡 Amarillo</option>
              <option value="blue" ${existing?.color === 'blue' ? 'selected' : ''}>🔵 Azul</option>
              <option value="emerald" ${existing?.color === 'emerald' ? 'selected' : ''}>🟢 Verde</option>
              <option value="purple" ${existing?.color === 'purple' ? 'selected' : ''}>🟣 Morado</option>
              <option value="rose" ${existing?.color === 'rose' ? 'selected' : ''}>🔴 Coral</option>
            </select>
          </div>
          <label style="display:flex; align-items:center; gap:0.45rem; cursor:pointer; font-weight:700; margin-top:1.2rem;">
            <input type="checkbox" id="swal-note-pinned" ${existing ? (existing.is_pinned ? 'checked' : '') : 'checked'} style="width:17px;height:17px;accent-color:#f59e0b;" />
            📌 Fijar en Botón Flotante
          </label>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Guardar Nota',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#6366f1',
    preConfirm: () => {
      const content = document.getElementById('swal-note-content').value.trim();
      if (!content) {
        Swal.showValidationMessage('El contenido de la nota no puede estar vacío');
        return false;
      }
      return {
        title: document.getElementById('swal-note-title').value.trim() || 'Nota',
        content,
        color: document.getElementById('swal-note-color').value,
        is_pinned: document.getElementById('swal-note-pinned').checked
      };
    }
  });

  if (!form) return;

  if (existing) {
    existing.title = form.title;
    existing.content = form.content;
    existing.color = form.color;
    existing.is_pinned = form.is_pinned;
    existing.updated_at = new Date().toISOString();
    saveToLocalMirror();

    if (wsState.supabaseTablesReady && wsState.userId) {
      await supabase.from('user_workspace_notes').update({
        title: existing.title,
        content: existing.content,
        color: existing.color,
        is_pinned: existing.is_pinned
      }).eq('id', existing.id);
    }
  } else {
    const newNote = {
      id: crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}`,
      user_id: wsState.userId,
      title: form.title,
      content: form.content,
      color: form.color,
      tags: [],
      is_pinned: form.is_pinned,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    wsState.notes.unshift(newNote);
    saveToLocalMirror();

    if (wsState.supabaseTablesReady && wsState.userId) {
      await supabase.from('user_workspace_notes').insert(newNote);
    }
  }

  refreshAllWorkspaceViews();
};

window.togglePinWorkspaceNote = async function(noteId) {
  const note = wsState.notes.find(n => n.id === noteId);
  if (!note) return;
  note.is_pinned = !note.is_pinned;
  note.updated_at = new Date().toISOString();
  saveToLocalMirror();
  refreshAllWorkspaceViews();

  if (wsState.supabaseTablesReady && wsState.userId) {
    await supabase.from('user_workspace_notes').update({ is_pinned: note.is_pinned }).eq('id', noteId);
  }
};

window.deleteWorkspaceNote = async function(noteId) {
  wsState.notes = wsState.notes.filter(n => n.id !== noteId);
  saveToLocalMirror();
  refreshAllWorkspaceViews();

  if (wsState.supabaseTablesReady && wsState.userId) {
    await supabase.from('user_workspace_notes').delete().eq('id', noteId);
  }
};

window.convertNoteToDailyTask = async function(noteId) {
  const note = wsState.notes.find(n => n.id === noteId);
  if (!note) return;

  await createWorkspaceTask({
    title: note.title || note.content.slice(0, 80),
    description: note.content,
    priority: 'medium',
    category: 'operaciones'
  });

  if (typeof Swal !== 'undefined') {
    Swal.fire({ title: '¡Agregada a Mi Día!', icon: 'success', timer: 1600, showConfirmButton: false });
  }
};

window.sendNoteToStoxWhatsApp = async function(noteId) {
  const note = wsState.notes.find(n => n.id === noteId);
  if (!note) return;
  const phone = normalizeChileanPhone(wsState.settings.whatsapp_phone || wsState.profilePhone);
  if (!phone) {
    wsState.activeMainTab = 'stox';
    refreshAllWorkspaceViews();
    return;
  }

  const msg = formatFallbackStoxReminderText({
    title: note.title || 'Nota de tu Panel',
    description: note.content,
    isNote: true
  });
  const res = await sendDirectStoxMessage(phone, msg);
  if (res && res.success && typeof Swal !== 'undefined') {
    Swal.fire({ title: '¡Nota enviada a tu WhatsApp!', icon: 'success', timer: 1700, showConfirmButton: false });
  }
};

window.saveWorkspaceStoxConfig = async function() {
  const phoneEl = document.getElementById('ws-cfg-wa-phone');
  const digEnableEl = document.getElementById('ws-cfg-digest-enabled');
  const digTimeEl = document.getElementById('ws-cfg-digest-time');

  await persistSettings({
    whatsapp_phone: phoneEl ? phoneEl.value.trim() : wsState.settings.whatsapp_phone,
    daily_digest_enabled: digEnableEl ? digEnableEl.checked : false,
    daily_digest_time: digTimeEl ? digTimeEl.value : '08:30'
  });

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Configuración Guardada',
      text: 'Tus preferencias de recordatorios con Stox WhatsApp se han actualizado.',
      icon: 'success',
      timer: 1800,
      showConfirmButton: false
    });
  }
  refreshAllWorkspaceViews();
};

window.toggleUserFloatingTool = async function(toolKey, enabled) {
  let current = Array.isArray(wsState.settings.floating_tools)
    ? [...wsState.settings.floating_tools]
    : ['checklist', 'scratchpad', 'stox'];

  if (enabled && !current.includes(toolKey)) {
    current.push(toolKey);
  } else if (!enabled) {
    current = current.filter(k => k !== toolKey);
  }

  // Asegurar orden consistente según catálogo
  const ordered = FLOATING_TOOLS_CATALOG.map(t => t.key).filter(k => current.includes(k));
  if (ordered.length > 0 && !ordered.includes(wsState.activeFloatingTool)) {
    wsState.activeFloatingTool = ordered[0];
  }

  await persistSettings({ floating_tools: ordered });
  refreshAllWorkspaceViews();
};

window.updateWorkspaceBooleanSetting = async function(key, val) {
  await persistSettings({ [key]: !!val });
  refreshAllWorkspaceViews();
};

// ============================================================================
// BOTÓN FLOTANTE EXPANDIBLE Y PERSONALIZABLE ("MI ESPACIO" / QUICK WORKSPACE)
// ============================================================================

function injectFloatingWorkspaceDOM() {
  if (document.getElementById('wms-workspace-fab')) return;

  // Detectar si estamos en dashboard de cliente para ajustar altura del botón flotante
  const isClientDashboard = !!document.querySelector('aside.sidebar[data-sidebar-role="client"]');
  if (isClientDashboard) {
    document.body.classList.add('client-workspace-mode');
  }

  const html = `
    <!-- Botón Flotante Expandible Mi Panel de Trabajo -->
    <button
      type="button"
      id="wms-workspace-fab"
      class="wms-workspace-fab"
      title="Mi Espacio de Trabajo Rápido (Alt + W)"
      onclick="window.toggleWorkspaceFloatingPopover()"
    >
      <i class="ri-checkbox-multiple-line"></i>
      <span id="wms-workspace-fab-badge" class="ws-fab-badge">0</span>
    </button>

    <!-- Popover Expandible con Herramientas Seleccionadas por el Usuario -->
    <div id="wms-workspace-popover" class="wms-workspace-popover" role="dialog" aria-label="Mi Espacio de Trabajo Rápido">
      <div class="ws-pop-header">
        <div class="ws-pop-header-left">
          <i class="ri-layout-masonry-fill" style="font-size: 1.1rem;"></i>
          <h4>Mi Espacio Rápido</h4>
          <span id="ws-pop-progress-pill" style="font-size: 0.7rem; padding: 0.1rem 0.45rem; border-radius: 99px; background: rgba(255,255,255,0.2); font-weight: 700;">0/0</span>
        </div>
        <div class="ws-pop-header-actions">
          <button type="button" class="ws-pop-top-btn" onclick="window.toggleFloatingCustomizerView()" title="Elegir qué herramientas aparecen aquí">
            <i class="ri-equalizer-line"></i>
          </button>
          <button type="button" class="ws-pop-top-btn" onclick="window.openFullWorkspaceFromFloating()" title="Abrir el Módulo Completo">
            <i class="ri-fullscreen-line"></i> <span>Panel</span>
          </button>
          <button type="button" class="ws-pop-top-btn" onclick="window.toggleWorkspaceFloatingPopover(false)" title="Cerrar (Esc)">
            <i class="ri-close-line"></i>
          </button>
        </div>
      </div>

      <!-- Barra de pestañas de las micro-herramientas elegidas por el usuario -->
      <div id="wms-workspace-pop-tabs" class="ws-pop-tabs"></div>

      <!-- Cuerpo de la herramienta activa -->
      <div id="wms-workspace-pop-body" class="ws-pop-body"></div>

      <div class="ws-pop-footer">
        <span><i class="ri-whatsapp-line" style="color: #10b981;"></i> Conectado con Stox</span>
        <span>Atajo: <kbd style="padding: 1px 5px; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-surface);">Alt + W</kbd></span>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  // Atajo de teclado Alt + W para abrir/cerrar en cualquier pantalla del WMS
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      window.toggleWorkspaceFloatingPopover();
    } else if (e.key === 'Escape' && wsState.popoverOpen) {
      window.toggleWorkspaceFloatingPopover(false);
    }
  });
}

window.toggleWorkspaceFloatingPopover = function(forceState) {
  const popover = document.getElementById('wms-workspace-popover');
  if (!popover) return;

  wsState.popoverOpen = typeof forceState === 'boolean' ? forceState : !wsState.popoverOpen;
  popover.classList.toggle('open', wsState.popoverOpen);

  if (wsState.popoverOpen) {
    renderFloatingPopoverContent();
  }
};

window.toggleFloatingCustomizerView = function() {
  wsState.showFloatingCustomizer = !wsState.showFloatingCustomizer;
  renderFloatingPopoverContent();
};

window.selectFloatingToolTab = function(toolKey) {
  wsState.showFloatingCustomizer = false;
  wsState.activeFloatingTool = toolKey;
  renderFloatingPopoverContent();
};

window.openFullWorkspaceFromFloating = function() {
  window.toggleWorkspaceFloatingPopover(false);
  const navItem = document.querySelector('.nav-item[data-view="workspace"]');
  if (navItem) {
    navItem.click();
  } else {
    window.renderWorkspacePanel();
  }
};

function renderFloatingPopoverContent() {
  const tabsEl = document.getElementById('wms-workspace-pop-tabs');
  const bodyEl = document.getElementById('wms-workspace-pop-body');
  const pillEl = document.getElementById('ws-pop-progress-pill');
  if (!tabsEl || !bodyEl) return;

  const { done, total, pct } = getDailyMetrics();
  if (pillEl) {
    pillEl.textContent = `${done}/${total} (${pct}%)`;
  }

  const enabledKeys = Array.isArray(wsState.settings.floating_tools)
    ? wsState.settings.floating_tools
    : ['checklist', 'scratchpad', 'stox'];

  const activeCatalog = FLOATING_TOOLS_CATALOG.filter(t => enabledKeys.includes(t.key));
  if (activeCatalog.length > 0 && !enabledKeys.includes(wsState.activeFloatingTool)) {
    wsState.activeFloatingTool = activeCatalog[0].key;
  }

  // Renderizar barra de pestañas
  tabsEl.innerHTML = activeCatalog.map(t => `
    <button
      type="button"
      class="ws-pop-tab ${!wsState.showFloatingCustomizer && wsState.activeFloatingTool === t.key ? 'active' : ''}"
      onclick="window.selectFloatingToolTab('${t.key}')"
    >
      <i class="${t.icon}"></i> <span>${t.shortLabel}</span>
    </button>
  `).join('');

  // Si el usuario abrió el selector de herramientas ("⚙️ Personalizar") dentro del botón flotante
  if (wsState.showFloatingCustomizer || activeCatalog.length === 0) {
    bodyEl.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.55rem;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <strong style="font-size: 0.82rem; color: var(--color-text-main);">⚙️ Elige tus herramientas rápidas:</strong>
          ${activeCatalog.length > 0 ? `<button type="button" onclick="window.toggleFloatingCustomizerView()" class="btn btn-sm btn-primary" style="padding: 0.2rem 0.55rem; font-size: 0.72rem;">Listo</button>` : ''}
        </div>
        <div style="font-size: 0.74rem; color: var(--color-text-muted);">
          Activa solo lo que uses a diario para mantener este botón ligero:
        </div>
        ${FLOATING_TOOLS_CATALOG.map(t => {
          const isOn = enabledKeys.includes(t.key);
          return `
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 0.55rem 0.7rem; border-radius: 9px; background: var(--color-bg); border: 1px solid ${isOn ? '#6366f1' : 'var(--color-border)'}; cursor: pointer; font-size: 0.78rem;">
              <span style="display: inline-flex; align-items: center; gap: 0.45rem; font-weight: 600; color: var(--color-text-main);">
                <i class="${t.icon}" style="color: #6366f1;"></i> ${t.label}
              </span>
              <input type="checkbox" ${isOn ? 'checked' : ''} onchange="window.toggleUserFloatingTool('${t.key}', this.checked)" style="accent-color: #6366f1; width: 16px; height: 16px;" />
            </label>
          `;
        }).join('')}
      </div>
    `;
    return;
  }

  // Renderizar la micro-herramienta seleccionada
  if (wsState.activeFloatingTool === 'checklist') {
    const todayTasks = getTodayTasksList();
    bodyEl.innerHTML = `
      <form onsubmit="event.preventDefault(); window.handleFloatingQuickTaskAdd();" style="display: flex; gap: 0.4rem;">
        <input type="text" id="ws-float-quick-task-input" class="ws-quick-input" style="min-width: 0; padding: 0.45rem 0.65rem; font-size: 0.8rem;" placeholder="➕ Añadir tarea rápida para hoy..." autocomplete="off" />
        <button type="submit" class="btn btn-sm btn-primary" style="padding: 0.45rem 0.75rem; font-size: 0.78rem; font-weight: 700;">+</button>
      </form>

      <div style="display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.2rem;">
        ${todayTasks.length === 0 ? `
          <div style="text-align: center; padding: 1.5rem 0.5rem; font-size: 0.78rem; color: var(--color-text-muted);">
            🎉 No tienes tareas pendientes hoy.
          </div>
        ` : todayTasks.map(t => `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.5rem 0.65rem; border-radius: 9px; background: var(--color-bg); border: 1px solid var(--color-border);">
            <div style="display: flex; align-items: center; gap: 0.55rem; min-width: 0; flex: 1; cursor: pointer;" onclick="window.toggleWorkspaceTaskCheck('${t.id}')">
              <button type="button" class="ws-check-btn ${t.is_completed ? 'checked' : ''}" style="width: 18px; height: 18px;">
                <i class="ri-check-line" style="font-size: 0.78rem;"></i>
              </button>
              <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ${t.is_completed ? 'text-decoration: line-through; opacity: 0.55;' : ''}" title="${escapeHtml(t.title)}">
                ${escapeHtml(t.title)}
              </span>
            </div>
            <button type="button" class="ws-icon-btn" style="width: 24px; height: 24px;" onclick="window.sendTaskToStoxWhatsAppNow('${t.id}')" title="Enviar recordatorio a mi WhatsApp con Stox">
              <i class="ri-whatsapp-line" style="color: #10b981; font-size: 0.85rem;"></i>
            </button>
          </div>
        `).join('')}
      </div>
    `;
  } else if (wsState.activeFloatingTool === 'scratchpad') {
    bodyEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--color-text-muted);">
        <span>📝 Borrador instantáneo (auto-guardado)</span>
        <button type="button" onclick="window.convertScratchpadToNote()" style="border: none; background: transparent; color: #6366f1; font-weight: 700; cursor: pointer; font-size: 0.73rem;">📌 Fijar como nota</button>
      </div>
      <textarea
        id="ws-float-scratchpad-input"
        class="ws-scratchpad-textarea"
        style="min-height: 170px;"
        placeholder="Apunta SKUs, guías, teléfonos o notas rápidas sin salir de tu módulo actual..."
        oninput="window.handleWorkspaceScratchpadInput(this.value)"
      >${escapeHtml(wsState.settings.scratchpad_content || '')}</textarea>
    `;
  } else if (wsState.activeFloatingTool === 'stox') {
    const phone = wsState.settings.whatsapp_phone || wsState.profilePhone || '';
    bodyEl.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.65rem;">
        <div style="font-size: 0.76rem; color: var(--color-text-muted); display: flex; justify-content: space-between;">
          <span>🤖 Aviso directo por WhatsApp:</span>
          <strong style="color: #10b981;">${phone ? escapeHtml(phone) : 'Sin teléfono'}</strong>
        </div>
        <input
          type="text"
          id="ws-float-express-wa-input"
          class="ws-quick-input"
          style="padding: 0.5rem 0.7rem; font-size: 0.8rem;"
          placeholder="¿Qué quieres que Stox te recuerde?"
        />
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem;">
          <button type="button" onclick="window.createExpressStoxReminder(15, 'ws-float-express-wa-input')" class="btn btn-sm btn-outline" style="font-size: 0.73rem; padding: 0.4rem;">⏰ En 15m</button>
          <button type="button" onclick="window.createExpressStoxReminder(60, 'ws-float-express-wa-input')" class="btn btn-sm btn-outline" style="font-size: 0.73rem; padding: 0.4rem;">⏰ En 1h</button>
          <button type="button" onclick="window.createExpressStoxReminder('tomorrow9', 'ws-float-express-wa-input')" class="btn btn-sm btn-outline" style="font-size: 0.73rem; padding: 0.4rem;">☀️ Mañana 9h</button>
        </div>
        <button type="button" onclick="window.sendMyDailySummaryToWhatsApp(this)" class="btn btn-sm btn-outline" style="width: 100%; justify-content: center; border-color: rgba(16,185,129,0.4); color: #10b981; font-weight: 700; font-size: 0.76rem; padding: 0.45rem;">
          <i class="ri-whatsapp-line"></i> Enviarme mi lista de hoy a WhatsApp
        </button>
      </div>
    `;
  } else if (wsState.activeFloatingTool === 'pinned') {
    const pinnedNotes = wsState.notes.filter(n => n.is_pinned && !n.is_archived);
    bodyEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.76rem; font-weight: 700; color: var(--color-text-main);">📌 Mis Notas Fijadas (${pinnedNotes.length})</span>
        <button type="button" onclick="window.openWorkspaceNoteModal()" class="btn btn-sm btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;">+ Nota</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${pinnedNotes.length === 0 ? `
          <div style="text-align: center; padding: 1.5rem 0.5rem; font-size: 0.76rem; color: var(--color-text-muted);">
            No tienes notas fijadas. Pulsa 📌 en cualquier nota para verla aquí.
          </div>
        ` : pinnedNotes.map(n => `
          <div style="padding: 0.65rem 0.75rem; border-radius: 9px; background: var(--color-bg); border: 1px solid var(--color-border); font-size: 0.78rem;">
            <div style="font-weight: 700; color: var(--color-text-main); margin-bottom: 0.2rem;">${escapeHtml(n.title)}</div>
            <div style="color: var(--color-text-muted); white-space: pre-wrap; max-height: 85px; overflow-y: auto;">${escapeHtml(n.content)}</div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (wsState.activeFloatingTool === 'timer') {
    const secs = wsState.timer.mode === 'stopwatch' ? wsState.timer.elapsedSeconds : wsState.timer.secondsLeft;
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');

    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 0.5rem 0; display: flex; flex-direction: column; gap: 0.65rem;">
        <div style="display: flex; justify-content: center; gap: 0.35rem;">
          <button type="button" onclick="window.setWorkspaceTimerMode('pomodoro')" class="btn btn-sm ${wsState.timer.mode === 'pomodoro' ? 'btn-primary' : 'btn-outline'}" style="font-size: 0.72rem; padding: 0.22rem 0.55rem;">🍅 Pomodoro 25m</button>
          <button type="button" onclick="window.setWorkspaceTimerMode('short')" class="btn btn-sm ${wsState.timer.mode === 'short' ? 'btn-primary' : 'btn-outline'}" style="font-size: 0.72rem; padding: 0.22rem 0.55rem;">☕ Pausa 5m</button>
          <button type="button" onclick="window.setWorkspaceTimerMode('stopwatch')" class="btn btn-sm ${wsState.timer.mode === 'stopwatch' ? 'btn-primary' : 'btn-outline'}" style="font-size: 0.72rem; padding: 0.22rem 0.55rem;">⏱️ Cronómetro</button>
        </div>

        <div id="ws-float-timer-display" style="font-size: 2.2rem; font-weight: 900; color: #6366f1; font-variant-numeric: tabular-nums; letter-spacing: 1px;">
          ${mm}:${ss}
        </div>

        <div style="display: flex; justify-content: center; gap: 0.5rem;">
          <button type="button" onclick="window.toggleWorkspaceTimerStartStop()" class="btn btn-sm btn-primary" style="padding: 0.4rem 1rem; font-size: 0.8rem; font-weight: 700;">
            ${wsState.timer.running ? '⏸️ Pausar' : '▶️ Iniciar'}
          </button>
          <button type="button" onclick="window.resetWorkspaceTimer()" class="btn btn-sm btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">
            Reiniciar
          </button>
        </div>
      </div>
    `;
  }
}

window.handleFloatingQuickTaskAdd = async function() {
  const input = document.getElementById('ws-float-quick-task-input');
  if (!input || !input.value.trim()) return;
  const title = input.value.trim();
  input.value = '';
  await createWorkspaceTask({ title, priority: 'medium', category: 'operaciones' });
};

// Funciones del Cronómetro / Pomodoro
window.setWorkspaceTimerMode = function(mode) {
  if (wsState.timer.intervalId) {
    clearInterval(wsState.timer.intervalId);
    wsState.timer.intervalId = null;
  }
  wsState.timer.running = false;
  wsState.timer.mode = mode;
  wsState.timer.elapsedSeconds = 0;
  wsState.timer.secondsLeft = mode === 'pomodoro' ? 25 * 60 : (mode === 'short' ? 5 * 60 : 0);
  renderFloatingPopoverContent();
};

window.toggleWorkspaceTimerStartStop = function() {
  if (wsState.timer.running) {
    clearInterval(wsState.timer.intervalId);
    wsState.timer.intervalId = null;
    wsState.timer.running = false;
    renderFloatingPopoverContent();
    return;
  }

  wsState.timer.running = true;
  wsState.timer.intervalId = setInterval(() => {
    if (wsState.timer.mode === 'stopwatch') {
      wsState.timer.elapsedSeconds++;
    } else {
      if (wsState.timer.secondsLeft > 0) {
        wsState.timer.secondsLeft--;
      } else {
        clearInterval(wsState.timer.intervalId);
        wsState.timer.intervalId = null;
        wsState.timer.running = false;
        if (typeof Swal !== 'undefined') {
          Swal.fire({
            title: '⏰ ¡Bloque de tiempo completado!',
            text: 'Has finalizado tu sesión de enfoque en el Panel de Trabajo.',
            icon: 'success',
            confirmButtonColor: '#6366f1'
          });
        }
      }
    }

    const disp = document.getElementById('ws-float-timer-display');
    if (disp) {
      const secs = wsState.timer.mode === 'stopwatch' ? wsState.timer.elapsedSeconds : wsState.timer.secondsLeft;
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      disp.textContent = `${mm}:${ss}`;
    }
  }, 1000);
  renderFloatingPopoverContent();
};

window.resetWorkspaceTimer = function() {
  window.setWorkspaceTimerMode(wsState.timer.mode);
};

// ============================================================================
// INICIALIZACIÓN AUTOMÁTICA AL CARGAR LA PÁGINA
// ============================================================================

async function initWorkspaceForCurrentUser() {
  try {
    // De momento el Panel de Trabajo está habilitado exclusivamente para el portal de Administración (Admin)
    const isClientPortal = !!document.querySelector('aside.sidebar[data-sidebar-role="client"]');
    if (isClientPortal) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    wsState.userId = user.id;
    wsState.userEmail = user.email || '';

    // Obtener datos del perfil (nombre, teléfono y rol)
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, company_name, phone, role')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        wsState.userName = profile.full_name || profile.company_name || user.email || 'Usuario Stocka';
        wsState.profilePhone = profile.phone || '';
        wsState.userRole = profile.role || 'admin';
      }
    } catch (_) {}

    // Bloquear si el usuario no es admin
    if (wsState.userRole !== 'admin') return;

    injectFloatingWorkspaceDOM();
    wsState.initialized = true;
    await syncWorkspaceFromSupabase();
    startBrowserReminderWatcher();
  } catch (err) {
    console.warn('[Workspace] Error inicializando Panel de Trabajo:', err.message);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initWorkspaceForCurrentUser, 350);
  });
} else {
  setTimeout(initWorkspaceForCurrentUser, 350);
}
