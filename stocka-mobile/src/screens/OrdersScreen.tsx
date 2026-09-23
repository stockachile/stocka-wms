// src/screens/OrdersScreen.tsx - Seguimiento de pedidos y despachos para clientes
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/Header';
import { SearchInput } from '../components/SearchInput';
import { StatusBadge } from '../components/StatusBadge';
import { fetchOrders, OrderItem } from '../api/orders';
import { ShoppingBag, Truck, ExternalLink, Calendar, DollarSign, User } from 'lucide-react-native';

interface OrdersScreenProps {
  route?: any;
}

export const OrdersScreen: React.FC<OrdersScreenProps> = ({ route }) => {
  const { profile } = useAuth();
  const comercio = profile?.comercio;

  const initialSearch = route?.params?.search || '';
  const initialFilter = route?.params?.filter || 'todos';

  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialFilter);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadOrders = async (queryText: string = search, status: string = statusFilter) => {
    try {
      const data = await fetchOrders(comercio, status, queryText);
      setOrders(data);
    } catch (e) {
      console.error('Error loading orders:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [comercio]);

  useEffect(() => {
    if (route?.params?.filter) {
      setStatusFilter(route.params.filter);
      loadOrders(search, route.params.filter);
    }
    if (route?.params?.search) {
      setSearch(route.params.search);
      loadOrders(route.params.search, statusFilter);
    }
  }, [route?.params]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  };

  const handleFilterChange = (status: string) => {
    setStatusFilter(status);
    setLoading(true);
    loadOrders(search, status);
  };

  const handleOpenTracking = (courier: string | undefined, tracking: string | undefined, trackingUrl?: string) => {
    if (trackingUrl && trackingUrl.startsWith('http')) {
      Linking.openURL(trackingUrl).catch(err => console.error('Error opening tracking URL:', err));
      return;
    }
    if (!tracking) return;
    const c = (courier || '').toLowerCase();
    let url = `https://www.google.com/search?q=${encodeURIComponent(`${courier || 'envio'} tracking ${tracking}`)}`;

    if (c.includes('bluex') || c.includes('blue express')) {
      url = `https://www.bluex.cl/seguimiento/?tracking=${tracking}`;
    } else if (c.includes('starken')) {
      url = `https://www.starken.cl/seguimiento?codigo=${tracking}`;
    } else if (c.includes('chilexpress')) {
      url = `https://www.chilexpress.cl/orden-transporte/${tracking}`;
    }

    Linking.openURL(url).catch(err => console.error('Error opening tracking URL:', err));
  };

  const renderOrderItem = ({ item }: { item: OrderItem }) => (
    <View style={styles.orderCard}>
      {/* Cabecera del pedido */}
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <View style={styles.orderNumRow}>
            <Text style={styles.orderNumber}>#{item.order_number}</Text>
            <View style={styles.platformBadge}>
              <Text style={styles.platformText}>{item.platform}</Text>
            </View>
          </View>
          <View style={styles.dateRow}>
            <Calendar size={12} color={colors.textDim} style={{ marginRight: 4 }} />
            <Text style={styles.dateText}>
              {new Date(item.created_at).toLocaleDateString('es-CL', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>

        <StatusBadge status={item.status} type="order" />
      </View>

      {/* Datos del Cliente */}
      <View style={styles.customerRow}>
        <User size={14} color={colors.textMuted} style={{ marginRight: 6 }} />
        <Text style={styles.customerName}>{item.customer_name}</Text>
      </View>

      {/* Información de Envío / Courier */}
      <View style={styles.shippingSection}>
        <View style={styles.courierRow}>
          <Truck size={14} color={colors.primaryLight} style={{ marginRight: 6 }} />
          <Text style={styles.courierName}>{item.courier}</Text>
        </View>

        {item.tracking_number ? (
          <TouchableOpacity
            style={styles.trackingBtn}
            onPress={() => handleOpenTracking(item.courier, item.tracking_number, item.tracking_url)}
          >
            <Text style={styles.trackingNumber}>Guía: {item.tracking_number}</Text>
            <ExternalLink size={12} color={colors.primaryLight} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.noTrackingText}>Guía aún no asignada</Text>
        )}
      </View>

      {/* Monto si aplica */}
      {typeof item.total_amount === 'number' && item.total_amount > 0 && (
        <View style={styles.footerRow}>
          <Text style={styles.totalLabel}>Total Orden:</Text>
          <Text style={styles.totalValue}>
            ${item.total_amount.toLocaleString('es-CL')}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Header title="Despachos" subtitle="Seguimiento y estado de entregas" />

      {/* Barra de Búsqueda */}
      <SearchInput
        value={search}
        onChangeText={val => {
          setSearch(val);
          loadOrders(val, statusFilter);
        }}
        placeholder="Buscar por N° pedido, cliente o guía..."
      />

      {/* Filtro por estado */}
      <View style={styles.filterBar}>
        {[
          { key: 'todos', label: 'Todos' },
          { key: 'pendiente', label: 'Pendientes' },
          { key: 'despachado', label: 'En Ruta' },
          { key: 'entregado', label: 'Entregados' },
        ].map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterChip, statusFilter === tab.key && styles.filterChipActive]}
            onPress={() => handleFilterChange(tab.key)}
          >
            <Text style={[styles.filterText, statusFilter === tab.key && styles.filterTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Lista de Pedidos */}
      {loading ? (
        <View style={styles.loaderCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loaderText}>Cargando despachos...</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={item => item.id}
          renderItem={renderOrderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <ShoppingBag size={48} color={colors.textDim} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>No hay despachos</Text>
              <Text style={styles.emptySub}>
                {search
                  ? `No se encontraron despachos para "${search}"`
                  : 'No existen pedidos registrados para este filtro.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  filterBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    borderColor: colors.primary,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  filterTextActive: {
    color: colors.primaryLight,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  orderCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
  },
  orderNumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMain,
  },
  platformBadge: {
    backgroundColor: colors.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  platformText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 11,
    color: colors.textDim,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  customerName: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  shippingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  courierRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  courierName: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMain,
  },
  trackingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  trackingNumber: {
    fontSize: 11,
    color: colors.primaryLight,
    fontWeight: '600',
  },
  noTrackingText: {
    fontSize: 11,
    color: colors.textDim,
    fontStyle: 'italic',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  totalLabel: {
    fontSize: 12,
    color: colors.textDim,
  },
  totalValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
  },
  loaderCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 12,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMain,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
