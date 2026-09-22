// src/api/dashboard.ts - Métricas ejecutivas y resumen para el dashboard móvil
import { supabase } from '../services/supabase';
import { fetchProducts } from './inventory';
import { fetchOrders, OrderItem } from './orders';

export interface DashboardMetrics {
  totalProducts: number;
  outOfStockCount: number;
  pendingOrdersCount: number;
  dispatchedOrdersCount: number;
  recentOrders: OrderItem[];
}

export const fetchDashboardMetrics = async (comercio?: string): Promise<DashboardMetrics> => {
  try {
    const [products, orders] = await Promise.all([
      fetchProducts(comercio),
      fetchOrders(comercio, 'todos'),
    ]);

    const outOfStockCount = products.filter(p => p.available_stock <= 0).length;

    const pendingOrdersCount = orders.filter(
      o => o.status.toLowerCase().includes('pendiente') || 
           o.status.toLowerCase().includes('asignar') ||
           o.status.toLowerCase().includes('picking')
    ).length;

    const dispatchedOrdersCount = orders.filter(
      o => o.status.toLowerCase().includes('despachado') || 
           o.status.toLowerCase().includes('transito') ||
           o.status.toLowerCase().includes('entregado')
    ).length;

    return {
      totalProducts: products.length,
      outOfStockCount,
      pendingOrdersCount,
      dispatchedOrdersCount,
      recentOrders: orders.slice(0, 5),
    };
  } catch (err) {
    console.error('Error in fetchDashboardMetrics:', err);
    return {
      totalProducts: 0,
      outOfStockCount: 0,
      pendingOrdersCount: 0,
      dispatchedOrdersCount: 0,
      recentOrders: [],
    };
  }
};
