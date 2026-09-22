// src/api/inventory.ts - Consultas de productos y stock para la app móvil
import { supabase } from '../services/supabase';

export interface ProductItem {
  id: string;
  sku: string;
  name: string;
  barcode?: string;
  image_url?: string;
  comercio?: string;
  status?: string;
  total_stock: number;
  available_stock: number;
  warehouses_detail: Array<{
    warehouse_name: string;
    quantity: number;
    committed_quantity: number;
  }>;
}

export const fetchProducts = async (comercio?: string, searchQuery?: string): Promise<ProductItem[]> => {
  try {
    let query = supabase.from('products').select(`
      id,
      sku,
      name,
      barcode,
      image_url,
      comercio,
      status,
      inventory (
        quantity,
        committed_quantity,
        warehouses (name)
      )
    `);

    if (comercio && comercio !== 'no asignado') {
      query = query.eq('comercio', comercio);
    }

    if (searchQuery && searchQuery.trim()) {
      const clean = searchQuery.trim();
      query = query.or(`sku.ilike.%${clean}%,name.ilike.%${clean}%,barcode.ilike.%${clean}%`);
    }

    const { data, error } = await query.order('name').limit(100);

    if (error) {
      console.error('Error fetching products:', error);
      throw error;
    }

    if (!data) return [];

    return data.map((p: any) => {
      let total = 0;
      let committed = 0;
      const whDetails: any[] = [];

      if (Array.isArray(p.inventory)) {
        p.inventory.forEach((inv: any) => {
          const q = Number(inv.quantity) || 0;
          const c = Number(inv.committed_quantity) || 0;
          total += q;
          committed += c;
          whDetails.push({
            warehouse_name: inv.warehouses?.name || 'Bodega Principal',
            quantity: q,
            committed_quantity: c,
          });
        });
      }

      return {
        id: p.id,
        sku: p.sku || 'SIN-SKU',
        name: p.name || 'Producto sin nombre',
        barcode: p.barcode,
        image_url: p.image_url,
        comercio: p.comercio,
        status: p.status,
        total_stock: total,
        available_stock: Math.max(0, total - committed),
        warehouses_detail: whDetails,
      };
    });
  } catch (err) {
    console.error('fetchProducts caught exception:', err);
    return [];
  }
};

export const fetchProductByBarcode = async (barcode: string, comercio?: string): Promise<ProductItem | null> => {
  try {
    let query = supabase.from('products').select(`
      id,
      sku,
      name,
      barcode,
      image_url,
      comercio,
      status,
      inventory (
        quantity,
        committed_quantity,
        warehouses (name)
      )
    `).or(`barcode.eq.${barcode},sku.eq.${barcode}`);

    if (comercio && comercio !== 'no asignado') {
      query = query.eq('comercio', comercio);
    }

    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;

    let total = 0;
    let committed = 0;
    const whDetails: any[] = [];

    if (Array.isArray(data.inventory)) {
      data.inventory.forEach((inv: any) => {
        const q = Number(inv.quantity) || 0;
        const c = Number(inv.committed_quantity) || 0;
        total += q;
        committed += c;
        whDetails.push({
          warehouse_name: inv.warehouses?.name || 'Bodega Principal',
          quantity: q,
          committed_quantity: c,
        });
      });
    }

    return {
      id: data.id,
      sku: data.sku,
      name: data.name,
      barcode: data.barcode,
      image_url: data.image_url,
      comercio: data.comercio,
      status: data.status,
      total_stock: total,
      available_stock: Math.max(0, total - committed),
      warehouses_detail: whDetails,
    };
  } catch (err) {
    console.error('fetchProductByBarcode exception:', err);
    return null;
  }
};
