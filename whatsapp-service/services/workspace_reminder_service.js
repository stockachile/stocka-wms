/**
 * Servicio de Recordatorios, Resumen Diario e Interacción por WhatsApp (Stox)
 * para el Módulo "Mi Panel de Trabajo" (Workspace) de Stocka WMS.
 *
 * Funcionalidades:
 * 1. Evalúa cada 60s recordatorios vencidos en Supabase (user_workspace_tasks / user_workspace_notes)
 *    y en la cola persistente local de respaldo.
 * 2. Envía alertas personalizadas de Stox directo al WhatsApp del usuario.
 * 3. Envía el Resumen Matutino Diario ("Daily Briefing") en días hábiles según la hora configurada por cada usuario.
 * 4. Procesa comandos entrantes por WhatsApp del usuario:
 *    - !listo / !check          -> Marca como completada la última tarea recordada o pendiente.
 *    - !posponer [min]          -> Pospone el recordatorio N minutos (por defecto 30 min).
 *    - !tarea [título]          -> Crea una nueva tarea en "Mi Día" del usuario.
 *    - !nota [contenido]        -> Crea una nota rápida en el Panel de Trabajo del usuario.
 *    - !pendientes / !mistareas -> Envía el checklist actual del día con su porcentaje de avance.
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

// Archivo de estado persistente para cola local de recordatorios y trazabilidad de última tarea recordada
function getStateFilePath() {
  if (process.env.AUTH_DIR) {
    const parent = path.dirname(process.env.AUTH_DIR);
    if (fs.existsSync(parent)) {
      return path.join(parent, 'workspace_reminders_state.json');
    }
  }
  return path.join(__dirname, '../workspace_reminders_state.json');
}

function loadReminderState() {
  const file = getStateFilePath();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        queue: Array.isArray(parsed.queue) ? parsed.queue : [],
        lastRemindedByPhone: parsed.lastRemindedByPhone || {},
        sentIds: parsed.sentIds || {}
      };
    }
  } catch (err) {
    console.error('[WorkspaceReminders] Error leyendo estado local:', err.message);
  }
  return { queue: [], lastRemindedByPhone: {}, sentIds: {} };
}

function saveReminderState(state) {
  const file = getStateFilePath();
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[WorkspaceReminders] Error guardando estado local:', err.message);
  }
}

/**
 * Normaliza un número de teléfono a solo dígitos (formato chileno 569XXXXXXXX)
 */
function normalizePhoneDigits(phone) {
  if (!phone) return '';
  let digits = String(phone).split('@')[0].split(':')[0].replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    digits = '56' + digits;
  } else if (digits.length === 8) {
    digits = '569' + digits;
  }
  return digits;
}

/**
 * Obtiene fecha YYYY-MM-DD y hora HH:MM en Santiago de Chile
 */
function getChileNowParts(date = new Date()) {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago'
  }).format(date);

  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);

  return { dateStr, timeStr };
}

/**
 * Formatea etiqueta de prioridad
 */
function formatPriorityLabel(priority) {
  switch ((priority || 'medium').toLowerCase()) {
    case 'urgent': return '🔥 Urgente';
    case 'high': return '🔴 Alta';
    case 'low': return '🔵 Baja';
    default: return '🟡 Media';
  }
}

/**
 * Busca el teléfono y nombre de un usuario dado su user_id
 */
async function resolveUserContact(userId) {
  if (!userId) return null;
  let phone = null;
  let name = 'Equipo Stocka';
  let remindersEnabled = true;

  try {
    const { data: settings } = await supabase
      .from('user_workspace_settings')
      .select('whatsapp_phone, whatsapp_reminders_enabled')
      .eq('user_id', userId)
      .maybeSingle();

    if (settings) {
      if (settings.whatsapp_reminders_enabled === false) {
        remindersEnabled = false;
      }
      if (settings.whatsapp_phone) {
        phone = settings.whatsapp_phone;
      }
    }
  } catch (_) {}

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_name, phone')
      .eq('id', userId)
      .maybeSingle();

    if (profile) {
      name = profile.full_name || profile.company_name || name;
      if (!phone && profile.phone) {
        phone = profile.phone;
      }
    }
  } catch (_) {}

  return {
    userId,
    name,
    phone: normalizePhoneDigits(phone),
    remindersEnabled
  };
}

/**
 * Busca a qué usuario de WMS pertenece un número de WhatsApp entrante
 */
async function findUserByPhone(rawPhoneOrJid) {
  const targetDigits = normalizePhoneDigits(rawPhoneOrJid);
  if (!targetDigits || targetDigits.length < 8) return null;
  const last8 = targetDigits.slice(-8);

  // 1. Buscar primero en user_workspace_settings
  try {
    const { data: wsList } = await supabase
      .from('user_workspace_settings')
      .select('user_id, whatsapp_phone')
      .not('whatsapp_phone', 'is', null);

    if (Array.isArray(wsList)) {
      const matched = wsList.find(r => normalizePhoneDigits(r.whatsapp_phone).endsWith(last8));
      if (matched) {
        const contact = await resolveUserContact(matched.user_id);
        return { userId: matched.user_id, name: contact?.name || 'Usuario', phone: targetDigits };
      }
    }
  } catch (_) {}

  // 2. Buscar en profiles
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, company_name, phone')
      .not('phone', 'is', null);

    if (Array.isArray(profiles)) {
      const matched = profiles.find(p => normalizePhoneDigits(p.phone).endsWith(last8));
      if (matched) {
        return {
          userId: matched.id,
          name: matched.full_name || matched.company_name || 'Usuario',
          phone: targetDigits
        };
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Construye el texto de WhatsApp para un recordatorio de tarea o nota
 */
function buildReminderMessage({ userName, title, description, priority, category, linkedRef, isNote = false }) {
  const firstName = (userName || 'Hola').split(' ')[0];
  const headerType = isNote ? '📌 *RECORDATORIO DE NOTA*' : '🔔 *RECORDATORIO DE TAREA*';

  const lines = [
    `🤖 *Stox | Tu Asistente Personal WMS*`,
    headerType,
    `━━━━━━━━━━━━━━━━━━━━`,
    `¡Hola *${firstName}*! Tienes un recordatorio programado en tu Panel de Trabajo:`,
    ``,
    `📌 *${isNote ? 'Nota' : 'Tarea'}:* ${title || 'Pendiente sin título'}`,
    !isNote ? `⚡ *Prioridad:* ${formatPriorityLabel(priority)}` : null,
    category ? `🏷️ *Categoría:* ${String(category).toUpperCase()}` : null,
    linkedRef ? `🔗 *Referencia WMS:* ${linkedRef}` : null,
    description ? `📝 *Detalle:* ${description}` : null,
    `━━━━━━━━━━━━━━━━━━━━`,
    !isNote ? `💡 *Acciones rápidas respondiendo aquí:*` : null,
    !isNote ? `• Escribe *!listo* para marcarla como completada ✅` : null,
    `• Escribe *!posponer 30* para volver a avisarte en 30 min ⏰`,
    `• Escribe *!pendientes* para ver tu lista de hoy 📋`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🕒 _${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}_`
  ];

  return lines.filter(l => l !== null).join('\n');
}

/**
 * Agenda un recordatorio en la cola local persistente (respaldo e inmediatez)
 */
function scheduleLocalReminderItem(item) {
  const state = loadReminderState();
  const id = item.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const existingIdx = state.queue.findIndex(q => q.id === id);

  const record = {
    id,
    userId: item.userId || null,
    userName: item.userName || 'Usuario Stocka',
    phone: normalizePhoneDigits(item.phone),
    title: item.title || 'Recordatorio',
    description: item.description || '',
    priority: item.priority || 'medium',
    category: item.category || 'operaciones',
    linkedRef: item.linkedRef || null,
    isNote: !!item.isNote,
    reminderAt: item.reminderAt || new Date().toISOString(),
    sent: false,
    createdAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    state.queue[existingIdx] = record;
  } else {
    state.queue.push(record);
  }

  saveReminderState(state);
  return record;
}

/**
 * Ciclo principal ejecutado cada 60s desde whatsapp-service/index.js
 */
async function processDueWorkspaceReminders(sock, formatJid, { isNonWorking = false } = {}) {
  if (!sock) return { processed: 0 };

  const nowIso = new Date().toISOString();
  const state = loadReminderState();
  let sentCount = 0;

  // 1. Procesar recordatorios de tareas en Supabase (user_workspace_tasks)
  try {
    const { data: dueTasks, error: tasksErr } = await supabase
      .from('user_workspace_tasks')
      .select('*')
      .eq('reminder_whatsapp', true)
      .eq('reminder_sent', false)
      .eq('is_completed', false)
      .lte('reminder_at', nowIso)
      .limit(25);

    if (!tasksErr && Array.isArray(dueTasks) && dueTasks.length > 0) {
      for (const task of dueTasks) {
        if (state.sentIds[`task_${task.id}_${task.reminder_at}`]) continue;

        const contact = await resolveUserContact(task.user_id);
        if (!contact || !contact.phone || !contact.remindersEnabled) {
          // Marcar como procesado para no ciclar si no tiene teléfono
          await supabase
            .from('user_workspace_tasks')
            .update({ reminder_sent: true, reminder_sent_at: nowIso })
            .eq('id', task.id);
          continue;
        }

        const jid = formatJid(contact.phone);
        const text = buildReminderMessage({
          userName: contact.name,
          title: task.title,
          description: task.description,
          priority: task.priority,
          category: task.category,
          linkedRef: task.linked_ref,
          isNote: false
        });

        try {
          await sock.sendMessage(jid, { text });
          sentCount++;

          await supabase
            .from('user_workspace_tasks')
            .update({ reminder_sent: true, reminder_sent_at: nowIso })
            .eq('id', task.id);

          state.sentIds[`task_${task.id}_${task.reminder_at}`] = nowIso;
          state.lastRemindedByPhone[contact.phone] = {
            taskId: task.id,
            userId: task.user_id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            source: 'supabase_task',
            remindedAt: nowIso
          };

          // También quitar de la cola local si estaba duplicado
          state.queue = state.queue.filter(q => q.id !== task.id);
        } catch (sendErr) {
          console.error(`[WorkspaceReminders] Error enviando WA de tarea ${task.id}:`, sendErr.message);
        }
      }
    }
  } catch (err) {
    // Silencioso si la tabla aún no existe
  }

  // 2. Procesar recordatorios de notas en Supabase (user_workspace_notes)
  try {
    const { data: dueNotes, error: notesErr } = await supabase
      .from('user_workspace_notes')
      .select('*')
      .eq('reminder_whatsapp', true)
      .eq('reminder_sent', false)
      .eq('is_archived', false)
      .lte('reminder_at', nowIso)
      .limit(20);

    if (!notesErr && Array.isArray(dueNotes) && dueNotes.length > 0) {
      for (const note of dueNotes) {
        if (state.sentIds[`note_${note.id}_${note.reminder_at}`]) continue;

        const contact = await resolveUserContact(note.user_id);
        if (!contact || !contact.phone || !contact.remindersEnabled) {
          await supabase
            .from('user_workspace_notes')
            .update({ reminder_sent: true, reminder_sent_at: nowIso })
            .eq('id', note.id);
          continue;
        }

        const jid = formatJid(contact.phone);
        const text = buildReminderMessage({
          userName: contact.name,
          title: note.title || 'Nota Rápida',
          description: note.content,
          isNote: true
        });

        try {
          await sock.sendMessage(jid, { text });
          sentCount++;

          await supabase
            .from('user_workspace_notes')
            .update({ reminder_sent: true, reminder_sent_at: nowIso })
            .eq('id', note.id);

          state.sentIds[`note_${note.id}_${note.reminder_at}`] = nowIso;
        } catch (sendErr) {
          console.error(`[WorkspaceReminders] Error enviando WA de nota ${note.id}:`, sendErr.message);
        }
      }
    }
  } catch (_) {}

  // 3. Procesar cola local de respaldo (para recordatorios express o cuando aún no se corre el SQL)
  const nowMs = Date.now();
  for (const item of state.queue) {
    if (item.sent) continue;
    const dueMs = new Date(item.reminderAt).getTime();
    if (isNaN(dueMs) || dueMs > nowMs) continue;

    if (state.sentIds[`task_${item.id}_${item.reminderAt}`]) {
      item.sent = true;
      continue;
    }

    let targetPhone = item.phone;
    let userName = item.userName || 'Usuario';
    if (!targetPhone && item.userId) {
      const contact = await resolveUserContact(item.userId);
      if (contact) {
        targetPhone = contact.phone;
        userName = contact.name;
      }
    }

    if (!targetPhone) {
      item.sent = true;
      continue;
    }

    try {
      const jid = formatJid(targetPhone);
      const text = buildReminderMessage({
        userName,
        title: item.title,
        description: item.description,
        priority: item.priority,
        category: item.category,
        linkedRef: item.linkedRef,
        isNote: item.isNote
      });

      await sock.sendMessage(jid, { text });
      item.sent = true;
      item.sentAt = nowIso;
      sentCount++;

      state.lastRemindedByPhone[targetPhone] = {
        taskId: item.id,
        userId: item.userId,
        title: item.title,
        description: item.description,
        priority: item.priority,
        source: 'local_queue',
        remindedAt: nowIso
      };
    } catch (err) {
      console.error('[WorkspaceReminders] Error enviando item de cola local:', err.message);
    }
  }

  // Limpiar ítems enviados antiguos (> 48h) de la cola local
  state.queue = state.queue.filter(q => !q.sent);
  saveReminderState(state);

  // 4. Procesar Resumen Matutino Diario ("Daily Briefing") en días hábiles
  if (!isNonWorking) {
    await processDailyBriefings(sock, formatJid);
  }

  return { processed: sentCount };
}

/**
 * Envía el resumen matutino de tareas pendientes a los usuarios que lo tengan activo
 */
async function processDailyBriefings(sock, formatJid) {
  const { dateStr, timeStr } = getChileNowParts();

  try {
    const { data: configs, error } = await supabase
      .from('user_workspace_settings')
      .select('*')
      .eq('daily_digest_enabled', true)
      .eq('whatsapp_reminders_enabled', true);

    if (error || !Array.isArray(configs) || configs.length === 0) return;

    for (const cfg of configs) {
      if (cfg.last_digest_sent_date === dateStr) continue;
      const targetTime = (cfg.daily_digest_time || '08:30').slice(0, 5);
      if (timeStr < targetTime) continue;

      const contact = await resolveUserContact(cfg.user_id);
      if (!contact || !contact.phone) continue;

      // Obtener tareas pendientes para hoy o atrasadas
      const { data: tasks } = await supabase
        .from('user_workspace_tasks')
        .select('*')
        .eq('user_id', cfg.user_id)
        .eq('is_completed', false)
        .lte('target_date', dateStr)
        .order('priority', { ascending: false })
        .limit(15);

      // Marcar como enviado hoy para evitar reintentos continuos
      await supabase
        .from('user_workspace_settings')
        .update({ last_digest_sent_date: dateStr })
        .eq('user_id', cfg.user_id);

      if (!tasks || tasks.length === 0) continue;

      const firstName = (contact.name || 'Equipo').split(' ')[0];
      const taskLines = tasks.map((t, idx) => {
        const pIcon = t.priority === 'urgent' ? '🔥' : (t.priority === 'high' ? '🔴' : '▫️');
        const overdue = t.target_date && t.target_date < dateStr ? ' _(Atrasada)_' : '';
        return `${idx + 1}. ${pIcon} ${t.title}${overdue}`;
      }).join('\n');

      const digestMsg = [
        `🤖 *Stox | Resumen Matutino de Trabajo*`,
        `☀️ *¡Buenos días, ${firstName}!*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📋 Tienes *${tasks.length} ${tasks.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}* para hoy (*${dateStr}*):`,
        ``,
        taskLines,
        `━━━━━━━━━━━━━━━━━━━━`,
        `💡 _Puedes escribir *!tarea [texto]* en cualquier momento para añadir un pendiente o *!listo* para ir tachando._`,
        `🚀 ¡Mucho éxito en la jornada de hoy!`
      ].join('\n');

      try {
        await sock.sendMessage(formatJid(contact.phone), { text: digestMsg });
      } catch (err) {
        console.error('[WorkspaceReminders] Error enviando resumen matutino:', err.message);
      }
    }
  } catch (_) {}
}

/**
 * Procesa comandos de WhatsApp enviados por el usuario a Stox (!listo, !posponer, !tarea, !nota, !pendientes)
 * Retorna true si el mensaje fue un comando del Panel de Trabajo y fue respondido.
 */
async function handleIncomingWorkspaceCommand(sock, fromJid, rawText) {
  if (!sock || !fromJid || !rawText) return false;
  if (fromJid.endsWith('@g.us')) return false; // Solo chats individuales con Stox

  const text = String(rawText).trim();
  const lower = text.toLowerCase();

  const isCommand =
    lower === '!listo' ||
    lower === '!check' ||
    lower.startsWith('!posponer') ||
    lower.startsWith('!tarea ') ||
    lower.startsWith('!nota ') ||
    lower === '!pendientes' ||
    lower === '!mistareas' ||
    lower === '!mis tareas';

  if (!isCommand) return false;

  const phoneDigits = normalizePhoneDigits(fromJid);
  const userInfo = await findUserByPhone(fromJid);
  const state = loadReminderState();
  const lastReminded = state.lastRemindedByPhone[phoneDigits];
  const { dateStr } = getChileNowParts();

  // 1. Comando !listo o !check
  if (lower === '!listo' || lower === '!check') {
    let completedTitle = null;

    if (lastReminded && lastReminded.taskId) {
      try {
        const { data: updated, error } = await supabase
          .from('user_workspace_tasks')
          .update({
            is_completed: true,
            status: 'done',
            completed_at: new Date().toISOString()
          })
          .eq('id', lastReminded.taskId)
          .select('title')
          .maybeSingle();

        if (!error && updated) {
          completedTitle = updated.title;
        } else {
          completedTitle = lastReminded.title;
        }
      } catch (_) {
        completedTitle = lastReminded.title;
      }
      delete state.lastRemindedByPhone[phoneDigits];
      saveReminderState(state);
    } else if (userInfo?.userId) {
      // Buscar la tarea pendiente más prioritaria de hoy
      try {
        const { data: nextTask } = await supabase
          .from('user_workspace_tasks')
          .select('id, title')
          .eq('user_id', userInfo.userId)
          .eq('is_completed', false)
          .lte('target_date', dateStr)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (nextTask) {
          await supabase
            .from('user_workspace_tasks')
            .update({
              is_completed: true,
              status: 'done',
              completed_at: new Date().toISOString()
            })
            .eq('id', nextTask.id);
          completedTitle = nextTask.title;
        }
      } catch (_) {}
    }

    if (completedTitle) {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n✅ ¡Excelente! He marcado la tarea *"${completedTitle}"* como *Completada* en tu Panel de Trabajo de Stocka WMS.`
      });
    } else {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\nℹ️ No encontré un recordatorio activo reciente para marcar. Puedes ver tus tareas escribiendo *!pendientes*.`
      });
    }
    return true;
  }

  // 2. Comando !posponer [minutos]
  if (lower.startsWith('!posponer')) {
    const parts = text.split(/\s+/);
    const mins = Math.max(1, Math.min(1440, parseInt(parts[1], 10) || 30));
    const newReminderIso = new Date(Date.now() + mins * 60 * 1000).toISOString();
    const newTimeLabel = new Date(newReminderIso).toLocaleTimeString('es-CL', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (lastReminded) {
      try {
        if (lastReminded.source === 'supabase_task' && lastReminded.taskId) {
          await supabase
            .from('user_workspace_tasks')
            .update({
              reminder_at: newReminderIso,
              reminder_whatsapp: true,
              reminder_sent: false
            })
            .eq('id', lastReminded.taskId);
        } else {
          scheduleLocalReminderItem({
            id: lastReminded.taskId,
            userId: lastReminded.userId,
            phone: phoneDigits,
            title: lastReminded.title,
            description: lastReminded.description,
            priority: lastReminded.priority,
            reminderAt: newReminderIso
          });
        }
      } catch (_) {}

      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n⏰ ¡Perfecto! He pospuesto *"${lastReminded.title}"* por *${mins} minutos*. Te volveré a avisar a las *${newTimeLabel} hrs*.`
      });
    } else {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\nℹ️ No hay un recordatorio reciente activo para posponer. Puedes crear uno escribiendo *!tarea [texto]*.`
      });
    }
    return true;
  }

  // 3. Comando !tarea [texto]
  if (lower.startsWith('!tarea ')) {
    const taskTitle = text.slice(7).trim();
    if (!taskTitle) return false;

    if (!userInfo?.userId) {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n⚠️ Tu número (*+${phoneDigits}*) aún no está vinculado a un usuario del Panel de Trabajo en Stocka WMS. Ingresa a *Mi Panel de Trabajo > Configurar Stox WhatsApp* para vincularlo.`
      });
      return true;
    }

    try {
      await supabase.from('user_workspace_tasks').insert({
        user_id: userInfo.userId,
        title: taskTitle,
        description: 'Creada desde WhatsApp vía Stox',
        priority: 'medium',
        category: 'operaciones',
        status: 'todo',
        target_date: dateStr,
        is_completed: false
      });

      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n☑️ *¡Tarea agregada a Mi Día!*\n📌 *"${taskTitle}"*\nYa aparece disponible en tu Panel de Trabajo y en tu Botón Flotante del WMS.`
      });
    } catch (err) {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n⚠️ No se pudo guardar la tarea en la base de datos (${err.message}).`
      });
    }
    return true;
  }

  // 4. Comando !nota [texto]
  if (lower.startsWith('!nota ')) {
    const noteBody = text.slice(6).trim();
    if (!noteBody) return false;

    if (!userInfo?.userId) {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n⚠️ Vincula primero tu número en *Mi Panel de Trabajo > Configurar Stox WhatsApp*.`
      });
      return true;
    }

    try {
      await supabase.from('user_workspace_notes').insert({
        user_id: userInfo.userId,
        title: `Nota desde WhatsApp (${new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' })})`,
        content: noteBody,
        color: 'emerald',
        is_pinned: true
      });

      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n📌 *¡Nota guardada y fijada en tu Panel de Trabajo!*\n📝 _"${noteBody}"_`
      });
    } catch (err) {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n⚠️ No se pudo guardar la nota (${err.message}).`
      });
    }
    return true;
  }

  // 5. Comando !pendientes o !mis tareas
  if (lower === '!pendientes' || lower === '!mistareas' || lower === '!mis tareas') {
    if (!userInfo?.userId) {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n⚠️ Tu número no está vinculado aún en *Mi Panel de Trabajo*.`
      });
      return true;
    }

    try {
      const { data: todayTasks } = await supabase
        .from('user_workspace_tasks')
        .select('*')
        .eq('user_id', userInfo.userId)
        .lte('target_date', dateStr)
        .order('is_completed', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(15);

      if (!todayTasks || todayTasks.length === 0) {
        await sock.sendMessage(fromJid, {
          text: `🤖 *Stox:*\n🎉 ¡No tienes tareas registradas para hoy en tu Panel de Trabajo! Envía *!tarea [texto]* si deseas añadir una.`
        });
        return true;
      }

      const doneCount = todayTasks.filter(t => t.is_completed).length;
      const pct = Math.round((doneCount / todayTasks.length) * 100);
      const listStr = todayTasks.map(t => `${t.is_completed ? '✅' : '⬜'} ${t.title}`).join('\n');

      const reply = [
        `🤖 *Stox | Tu Checklist de Hoy (${dateStr})*`,
        `📊 *Avance:* ${doneCount}/${todayTasks.length} completadas (*${pct}%*)`,
        `━━━━━━━━━━━━━━━━━━━━`,
        listStr,
        `━━━━━━━━━━━━━━━━━━━━`,
        `💡 _Usa *!tarea [texto]* para agregar un pendiente o *!listo* para completar el último._`
      ].join('\n');

      await sock.sendMessage(fromJid, { text: reply });
    } catch (err) {
      await sock.sendMessage(fromJid, {
        text: `🤖 *Stox:*\n⚠️ Error consultando tus tareas: ${err.message}`
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  processDueWorkspaceReminders,
  handleIncomingWorkspaceCommand,
  scheduleLocalReminderItem,
  buildReminderMessage,
  normalizePhoneDigits,
  resolveUserContact
};
