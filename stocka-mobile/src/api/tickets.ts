// src/api/tickets.ts - Gestión de tickets de soporte y carga de fotos para la app móvil
import { supabase } from '../services/supabase';

export interface TicketItem {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  description: string;
  comercio: string;
  user_id: string;
  created_at: string;
  updated_at?: string;
}

export interface KamInfo {
  hasKam: boolean;
  nombre: string;
  email: string;
  telefono: string;
  roleLabel: string;
}

export const fetchKamInfo = async (comercio?: string): Promise<KamInfo> => {
  const defaultKam: KamInfo = {
    hasKam: false,
    nombre: 'Soporte General Stocka',
    email: 'gestion@stocka.cl',
    telefono: '+56981354550',
    roleLabel: 'Equipo de Operaciones',
  };

  if (!comercio || comercio === 'no asignado') return defaultKam;

  try {
    const { data } = await supabase
      .from('comercios_adicional_config')
      .select('kam_nombre, kam_email, kam_telefono')
      .eq('comercio', comercio)
      .maybeSingle();

    if (data && data.kam_nombre) {
      return {
        hasKam: true,
        nombre: data.kam_nombre,
        email: data.kam_email || defaultKam.email,
        telefono: data.kam_telefono || defaultKam.telefono,
        roleLabel: 'Tu Ejecutivo KAM Dedicado',
      };
    }
  } catch (err) {
    console.warn('fetchKamInfo error:', err);
  }

  return defaultKam;
};

export const fetchTickets = async (userId: string, comercio?: string): Promise<TicketItem[]> => {
  try {
    let query = supabase.from('tickets').select('*').order('updated_at', { ascending: false });

    if (comercio && comercio !== 'no asignado' && comercio !== 'all') {
      query = query.or(`comercio.eq.${comercio},comercio.ilike.%${comercio}%`);
    } else {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.limit(50);

    if (error) {
      console.error('Error fetching tickets:', error);
      throw error;
    }

    return (data || []) as TicketItem[];
  } catch (err) {
    console.error('fetchTickets exception:', err);
    return [];
  }
};

export const createTicket = async (params: {
  userId: string;
  userEmail: string;
  comercio: string;
  subject: string;
  category: string;
  priority: string;
  description: string;
  photoUri?: string;
}): Promise<{ success: boolean; error?: string }> => {
  try {
    let descriptionFinal = params.description;

    // Si se adjuntó una foto desde la cámara del smartphone, subirla a Supabase Storage
    if (params.photoUri) {
      try {
        const fileExt = params.photoUri.split('.').pop() || 'jpg';
        const fileName = `ticket_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `tickets/${fileName}`;

        // Fetch de la imagen local como blob
        const response = await fetch(params.photoUri);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from('public-docs')
          .upload(filePath, blob, {
            contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
            upsert: true,
          });

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from('public-docs')
            .getPublicUrl(filePath);

          if (publicUrlData?.publicUrl) {
            descriptionFinal += `\n\n[Foto Adjunta desde App Móvil]: ${publicUrlData.publicUrl}`;
          }
        }
      } catch (uploadErr) {
        console.warn('No se pudo subir la foto del ticket a Storage, continuando:', uploadErr);
      }
    }

    const { error } = await supabase.from('tickets').insert([
      {
        user_id: params.userId,
        comercio: params.comercio,
        subject: params.subject,
        category: params.category,
        priority: params.priority,
        status: 'abierto',
        description: descriptionFinal,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;

    return { success: true };
  } catch (err: any) {
    console.error('Error al crear ticket:', err);
    return { success: false, error: err?.message || 'No se pudo crear el ticket' };
  }
};
