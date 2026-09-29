const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value.trim();
    }
  });
}

const WMS_URL = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(WMS_URL, WMS_KEY);

const CYBER_SURVEY_ID = 'c7be2026-0000-4000-8000-000000000001';

async function seedCyberSurvey() {
  console.log('🚀 Seeding / Updating Cyber 2026 Survey...');

  // 1. Obtener lista de comercios
  const { data: comercios, error: comErr } = await supabase
    .from('v_comercios_config')
    .select('nombre, sigla')
    .order('nombre');

  if (comErr) {
    console.warn('⚠️ No se pudo obtener v_comercios_config:', comErr.message);
  } else {
    console.log(`📦 Encontrados ${comercios.length} comercios registrados:`, comercios.map(c => c.nombre));
  }

  // 2. Definir encuesta con esquema compatible con surveys.js y admin.html
  const surveyData = {
    id: CYBER_SURVEY_ID,
    title: 'Planificación y Proyecciones Cyber (5-7 Octubre)',
    description: 'Ayúdanos a dimensionar el equipo de bodega, turnos e insumos para que tus despachos salgan en tiempo récord este Cyber.',
    category: 'operational',
    status: 'published',
    target_type: 'all',
    target_merchants: [],
    target_users: [],
    public_token: 'cyber-2026-stocka-public-token',
    is_active: true,
    settings: {
      allow_anonymous: true,
      show_progress_bar: true,
      submit_button_text: 'Enviar Planificación Cyber',
      success_title: '¡Planificación recibida con éxito!',
      success_message: 'Tu información ha sido registrada. Nuestro equipo de operaciones y bodega ya cuenta con tus proyecciones para coordinar turnos, insumos y asegurar una operación impecable.',
      estimated_minutes: 3,
      popup_on_login: true,
      popup_frequency: 'daily',
      popup_message: '¡Se acerca el Cyber! Cuéntanos tus planes y proyecciones de venta para preparar la bodega y tus despachos.'
    },
    pages: [
      {
        id: 'page-datos-contacto',
        title: 'Datos del Comercio y Contacto',
        description: 'Por favor indícanos a qué tienda o comercio representas',
        blocks: [
          {
            id: 'b-comercio',
            type: 'text_short',
            title: 'Nombre de tu Empresa / Marca / Tienda',
            description: 'Escribe el nombre de tu marca registrada en Stocka',
            required: true,
            settings: { placeholder: 'Ej: Mi Marca SpA' }
          },
          {
            id: 'b-contacto-nombre',
            type: 'text_short',
            title: 'Nombre del Encargado / Responsable',
            description: 'Nombre y apellido de quien coordina la campaña',
            required: true,
            settings: { placeholder: 'Ej: Juan Pérez' }
          },
          {
            id: 'b-contacto-email',
            type: 'text_short',
            title: 'Correo Electrónico de Contacto',
            description: 'Para enviar confirmación o coordinaciones operativas',
            required: true,
            settings: { placeholder: 'ejemplo@tutienda.cl' }
          },
          {
            id: 'b-contacto-telefono',
            type: 'text_short',
            title: 'Teléfono / WhatsApp de Contacto',
            description: 'Canal directo para contingencias durante los días del evento',
            required: true,
            settings: { placeholder: '+56 9 1234 5678' }
          }
        ]
      },
      {
        id: 'page-participacion',
        title: 'Participación y Campañas',
        description: 'Tus planes para el evento oficial del 5 al 7 de Octubre',
        blocks: [
          {
            id: 'b-participaran',
            type: 'single_choice',
            title: '¿Participarán en este Cyber?',
            description: 'Confírmanos si tu marca activará promociones u ofertas',
            required: true,
            options: [
              'Sí, participaremos activamente',
              'No participaremos en este evento',
              'Aún por definir / En evaluación'
            ]
          },
          {
            id: 'b-campanas',
            type: 'multiple_choice',
            title: '¿Qué tipo de campañas o promociones activarán?',
            description: 'Selecciona todas las que apliquen',
            required: false,
            options: [
              'Descuentos generales % en toda la tienda / catálogo',
              'Liquidación de temporadas anteriores / Zona Outlet',
              'Lanzamiento de nuevos productos o colecciones exclusivas',
              'Packs, Combos o promociones 2x1 / 3x2',
              'Envío Gratis (Free Shipping) o tarifas de envío bonificadas',
              'Ofertas Flash / Descuentos por horarios o días específicos',
              'Regalos o muestras gratis por compra (Gift with Purchase)',
              'Otra estrategia promocional'
            ]
          },
          {
            id: 'b-fechas-campana',
            type: 'single_choice',
            title: '¿Entre qué fechas esperan realizar sus campañas?',
            description: 'Periodo de vigencia de tus promociones',
            required: false,
            options: [
              'Solo fechas oficiales (Lunes 5 al Miércoles 7 de Octubre)',
              'Adelantado: Desde fin de semana previo (Viernes 2 / Sábado 3 de Octubre)',
              'Cyber Week completo (Lunes 5 al Domingo 11 de Octubre)',
              'Fechas personalizadas'
            ]
          }
        ]
      },
      {
        id: 'page-proyeccion-bodega',
        title: 'Proyección de Ventas y Logística de Bodega',
        description: 'Estimaciones de volumen para dimensionar personal y turnos',
        blocks: [
          {
            id: 'b-aumento-ventas',
            type: 'single_choice',
            title: '¿Cuánto esperan aumentar sus ventas / pedidos respecto a un mes habitual?',
            description: 'Proyección estimada de crecimiento durante el evento',
            required: true,
            options: [
              'Moderado (+20% a +50% de pedidos sobre lo habitual)',
              'Significativo: 2x a 3x del volumen normal (+100% a +200%)',
              'Fuerte impacto: 3x a 5x del volumen normal (+200% a +400%)',
              'Masivo / Peak: Más de 5x del volumen normal (> 400%)'
            ]
          },
          {
            id: 'b-pedidos-estimados',
            type: 'text_short',
            title: 'Estimación aproximada de pedidos totales durante el Cyber',
            description: 'Número orientativo para cálculo de insumos de empaque y pickers',
            required: false,
            settings: { placeholder: 'Ej: 800 pedidos totales' }
          },
          {
            id: 'b-extenderan-ofertas',
            type: 'single_choice',
            title: '¿Extenderán las ofertas más allá de la fecha oficial (5-7 de Octubre)?',
            description: 'Continuidad de ofertas post-miércoles 7',
            required: true,
            options: [
              'Sí, toda la semana (Cyber Week hasta el domingo)',
              'Sí, 1 a 2 días adicionales (Jueves 8 - Viernes 9)',
              'No, finalizaremos puntualmente el Miércoles 7 a las 23:59',
              'Aún por definir (dependerá de stock y resultados iniciales)'
            ]
          },
          {
            id: 'b-abastecimiento-previo',
            type: 'single_choice',
            title: '¿Ingresarán mercadería previa de reposición antes del Cyber a bodega?',
            description: 'Recepción de stock para el evento',
            required: false,
            options: [
              'Sí, enviaremos reposición de stock previa',
              'No, operaremos exclusivamente con el stock actual en bodega'
            ]
          },
          {
            id: 'b-comentarios-bodega',
            type: 'text_long',
            title: 'Requerimientos especiales, packaging o notas para la bodega',
            description: 'Flyers especiales, cintas con marca, cajas particulares, horario de corte o solicitudes clave',
            required: false,
            settings: { placeholder: 'Cuéntanos cualquier detalle operativo importante...' }
          }
        ]
      }
    ]
  };

  const { data: upsertData, error: upsertErr } = await supabase
    .from('surveys')
    .upsert(surveyData, { onConflict: 'id' })
    .select();

  if (upsertErr) {
    console.error('❌ Error al guardar encuesta en Supabase:', upsertErr);
  } else {
    console.log('✅ Encuesta Cyber registrada/actualizada con éxito con ID:', CYBER_SURVEY_ID);
    console.log('🔗 Token público:', surveyData.public_token);
  }
}

seedCyberSurvey();
