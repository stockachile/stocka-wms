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
  total_amount?: number;
  created_at: string;
  shipping_status?: string;
}

export const fetchOrders = async (
  comercio?: string,
  statusFilter?: string,
  searchQuery?: string
): Promise<OrderItem[]> => {
  try {
    let query = supabase
      .from('orders')
      .select('id, comercio, external_order_number, origen, external_platform, status, customer_name, customer_email, courier, tracking_number, total_amount, created_at, shipping_status');

    if (comercio && comercio !== 'no asignado') {
      query = query.eq('comercio', comercio);
    }

    if (statusFilter && statusFilter !== 'todos') {
      query = query.eq('status', statusFilter);
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
      status: o.status || 'pendiente',
      customer_name: o.customer_name || 'Cliente sin nombre',
      customer_email: o.customer_email,
      courier: o.courier || 'Por asignar',
      tracking_number: o.tracking_number,
      total_amount: o.total_amount,
      created_at: o.created_at,
      shipping_status: o.shipping_status || o.status,
    }));
  } catch (err) {
    console.error('fetchOrders caught exception:', err);
    return [];
  }
};
