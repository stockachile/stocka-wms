// src/screens/DashboardScreen.tsx - Pantalla principal del cliente con métricas y accesos rápidos
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Linking,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/Header';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { fetchDashboardMetrics, DashboardMetrics } from '../api/dashboard';
import { fetchKamInfo, KamInfo } from '../api/tickets';
import {
  Clock,
  Truck,
  AlertTriangle,
  Boxes,
  QrCode,
  LifeBuoy,
  MessageCircle,
  ChevronRight,
  ExternalLink,
} from 'lucide-react-native';

interface DashboardScreenProps {
  navigation: any;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const { profile } = useAuth();
  const comercio = profile?.comercio;

  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalProducts: 0,
    outOfStockCount: 0,
    pendingOrdersCount: 0,
    dispatchedOrdersCount: 0,
    recentOrders: [],
  });
  const [kam, setKam] = useState<KamInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);

  const loadData = async () => {
    try {
      const [m, k] = await Promise.all([
        fetchDashboardMetrics(comercio),
        fetchKamInfo(comercio),
      ]);
      setMetrics(m);
      setKam(k);
    } catch (e) {
      console.error('Error loading dashboard data:', e);
    }
  };

  useEffect(() => {
    loadData();
  }, [comercio]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleOpenWhatsApp = (phone: string) => {
    const clean = phone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${clean}?text=Hola,%20necesito%20asistencia%20con%20mi%20cuenta%20de%20Stocka%20WMS%20(${profile?.company_name || comercio || ''})`;
    Linking.openURL(url).catch(err => console.error('No se pudo abrir WhatsApp:', err));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Header
        title="Mi Bodega"
        rightAction={
          <TouchableOpacity
            style={styles.scanHeaderBtn}
            onPress={() => setScannerVisible(true)}
          >
            <QrCode size={18} color={colors.primaryLight} />
            <Text style={styles.scanHeaderBtnText}>Escanear</Text>
          </TouchableOpacity>
        }
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Banner de KAM Asignado */}
        {kam && (
          <View style={styles.kamCard}>
            <View style={styles.kamAvatar}>
              <Text style={styles.kamInitials}>
                {kam.nombre.split(' ').slice(0, 2).map(w => w[0]).join('') || 'KAM'}
              </Text>
            </View>
            <View style={styles.kamInfo}>
              <Text style={styles.kamLabel}>{kam.roleLabel}</Text>
              <Text style={styles.kamName}>{kam.nombre}</Text>
              <Text style={styles.kamContact}>{kam.telefono}</Text>
            </View>
            <TouchableOpacity
              style={styles.kamWaBtn}
              onPress={() => handleOpenWhatsApp(kam.telefono)}
              activeOpacity={0.8}
            >
              <MessageCircle size={16} color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.kamWaBtnText}>WhatsApp</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Métricas Principales */}
        <Text style={styles.sectionTitle}>Estado de Operaciones</Text>
        <View style={styles.metricsGrid}>
          <MetricCard
            title="Por Despachar"
            value={metrics.pendingOrdersCount}
            icon={<Clock size={20} color={colors.warning} />}
            accentColor={colors.warning}
            onPress={() => navigation.navigate('OrdersTab', { filter: 'pendiente' })}
          />
          <MetricCard
            title="En Tránsito"
            value={metrics.dispatchedOrdersCount}
            icon={<Truck size={20} color={colors.info} />}
            accentColor={colors.info}
            onPress={() => navigation.navigate('OrdersTab', { filter: 'despachado' })}
          />
        </View>

        <View style={styles.metricsGrid}>
          <MetricCard
            title="Quiebres de Stock"
            value={metrics.outOfStockCount}
            icon={<AlertTriangle size={20} color={colors.danger} />}
            accentColor={colors.danger}
            subtitle={metrics.outOfStockCount > 0 ? 'Requiere reabastecimiento' : 'Stock en niveles óptimos'}
            onPress={() => navigation.navigate('InventoryTab', { filter: 'out_of_stock' })}
          />
          <MetricCard
            title="SKUs Activos"
            value={metrics.totalProducts}
            icon={<Boxes size={20} color={colors.success} />}
            accentColor={colors.success}
            onPress={() => navigation.navigate('InventoryTab')}
          />
        </View>

        {/* Acciones Rápidas */}
        <Text style={styles.sectionTitle}>Acciones Rápidas</Text>
        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => setScannerVisible(true)}
          >
            <View style={[styles.qaIconWrap, { backgroundColor: 'rgba(37, 99, 235, 0.15)' }]}>
              <QrCode size={22} color={colors.primaryLight} />
            </View>
            <Text style={styles.qaTitle}>Consultar Barcode</Text>
            <Text style={styles.qaSub}>Ver stock con cámara</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => navigation.navigate('TicketsTab', { screen: 'CreateTicket' })}
          >
            <View style={[styles.qaIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <LifeBuoy size={22} color={colors.danger} />
            </View>
            <Text style={styles.qaTitle}>Nuevo Caso</Text>
            <Text style={styles.qaSub}>Reportar a bodega</Text>
          </TouchableOpacity>
        </View>

        {/* Últimos Pedidos Recientes */}
        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>Últimos Pedidos</Text>
          <TouchableOpacity onPress={() => navigation.navigate('OrdersTab')}>
            <Text style={styles.viewAllText}>Ver todos</Text>
          </TouchableOpacity>
        </View>

        {metrics.recentOrders.length === 0 ? (
          <View style={styles.emptyOrders}>
            <Text style={styles.emptyOrdersText}>No hay pedidos registrados recientemente.</Text>
          </View>
        ) : (
          metrics.recentOrders.map(order => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              onPress={() => navigation.navigate('OrdersTab', { search: order.order_number })}
            >
              <View style={styles.orderLeft}>
                <View style={styles.orderTopRow}>
                  <Text style={styles.orderNumber}>#{order.order_number}</Text>
                  <Text style={styles.orderPlatform}>{order.platform}</Text>
                </View>
                <Text style={styles.orderCustomer}>{order.customer_name}</Text>
                <Text style={styles.orderDate}>
                  {new Date(order.created_at).toLocaleDateString('es-CL', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <View style={styles.orderRight}>
                <StatusBadge status={order.status} type="order" />
                <ChevronRight size={18} color={colors.textDim} style={{ marginTop: 8 }} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Modal de Escáner de Código de Barras */}
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={scannedCode => {
          navigation.navigate('InventoryTab', { search: scannedCode });
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  scanHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.25)',
  },
  scanHeaderBtnText: {
    color: colors.primaryLight,
    fontWeight: '700',
    fontSize: 13,
  },
  kamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  kamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  kamInitials: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  kamInfo: {
    flex: 1,
  },
  kamLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primaryLight,
    textTransform: 'uppercase',
  },
  kamName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMain,
    marginTop: 1,
  },
  kamContact: {
    fontSize: 12,
    color: colors.textMuted,
  },
  kamWaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.success,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  kamWaBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMain,
    marginBottom: 12,
    marginTop: 8,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  quickActionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qaIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  qaTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMain,
  },
  qaSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  viewAllText: {
    color: colors.primaryLight,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyOrders: {
    backgroundColor: colors.surface,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyOrdersText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  orderLeft: {
    flex: 1,
  },
  orderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  orderNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMain,
  },
  orderPlatform: {
    fontSize: 11,
    color: colors.textMuted,
    backgroundColor: colors.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  orderCustomer: {
    fontSize: 13,
    color: colors.textMuted,
  },
  orderDate: {
    fontSize: 11,
    color: colors.textDim,
    marginTop: 4,
  },
  orderRight: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
});
