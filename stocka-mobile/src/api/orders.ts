// src/api/orders.ts - Consultas de pedidos y despachos para clientes Stocka
import { supabase } from '../services/supabase';

export interface OrderItem {
  id: string;
  order_number: string;
  platform: string;
  status: string;
  customer_name?: string;
  customer_email?: string;
  courier?: string;
  tracking_number?: string;
  tracking_url?: string;
  total_amount?: number;
  created_at: string;
}

export const fetchOrders = async (
  comercio?: string,
  statusFilter?: string,
  searchQuery?: string
): Promise<OrderItem[]> => {
  try {
    let query = supabase
      .from('orders')
      .select('id, comercio, external_order_number, origen, external_platform, status, estado_wms, customer_name, customer_email, courier, tracking_number, tracking_url, total_value, created_at');

    if (comercio && comercio !== 'no asignado') {
      query = query.eq('comercio', comercio);
    }

    if (statusFilter && statusFilter !== 'todos') {
      if (statusFilter === 'entregado') {
        query = query.or('estado_wms.eq.Entregado,status.in.(entregado,retirado)');
      } else if (statusFilter === 'listo para retiro' || statusFilter === 'listo_retiro') {
        query = query.eq('estado_wms', 'Listo para retiro');
      } else if (statusFilter === 'despachado') {
        query = query.eq('estado_wms', 'Despachado');
      } else if (statusFilter === 'pendiente') {
        query = query.in('estado_wms', ['En procesamiento', 'En preparación', 'Pickeado', 'Listo para retiro']);
      } else {
        query = query.eq('status', statusFilter);
      }
    }

    if (searchQuery && searchQuery.trim()) {
      const clean = searchQuery.trim();
      query = query.or(`external_order_number.ilike.%${clean}%,customer_name.ilike.%${clean}%,tracking_number.ilike.%${clean}%`);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }

    if (!data) return [];

    return data.map((o: any) => ({
      id: o.id,
      order_number: o.external_order_number || o.id.substring(0, 8),
      platform: o.origen || o.external_platform || 'Manual',
      status: o.estado_wms === 'Entregado' ? 'Entregado' : (o.estado_wms || o.status || 'pendiente'),
      customer_name: o.customer_name || 'Cliente sin nombre',
      customer_email: o.customer_email,
      courier: o.courier || 'Por asignar',
      tracking_number: o.tracking_number,
      tracking_url: o.tracking_url,
      total_amount: typeof o.total_value === 'number' ? o.total_value : (parseFloat(o.total_value) || undefined),
      created_at: o.created_at,
    }));
  } catch (err) {
    console.error('fetchOrders caught exception:', err);
    return [];
  }
};
