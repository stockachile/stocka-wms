// src/screens/InventoryScreen.tsx - Consulta de catálogo, stock disponible y escaneo de códigos
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/Header';
import { SearchInput } from '../components/SearchInput';
import { StatusBadge } from '../components/StatusBadge';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { fetchProducts, ProductItem } from '../api/inventory';
import { QrCode, Package, Building2, Barcode as BarcodeIcon } from 'lucide-react-native';

interface InventoryScreenProps {
  route?: any;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ route }) => {
  const { profile } = useAuth();
  const comercio = profile?.comercio;

  const initialSearch = route?.params?.search || '';
  const initialFilter = route?.params?.filter || 'todos';

  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<'todos' | 'con_stock' | 'out_of_stock'>(
    initialFilter === 'out_of_stock' ? 'out_of_stock' : 'todos'
  );
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);

  const loadInventory = async (searchQuery: string = search) => {
    try {
      const data = await fetchProducts(comercio, searchQuery);
      setProducts(data);
    } catch (e) {
      console.error('Error loading inventory:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
  }, [comercio]);

  // Si cambia el parámetro de búsqueda proveniente de otra pantalla (ej. escáner del dashboard)
  useEffect(() => {
    if (route?.params?.search) {
      setSearch(route.params.search);
      loadInventory(route.params.search);
    }
  }, [route?.params?.search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInventory();
    setRefreshing(false);
  };

  const filteredProducts = products.filter(p => {
    if (filter === 'con_stock') return p.available_stock > 0;
    if (filter === 'out_of_stock') return p.available_stock <= 0;
    return true;
  });

  const renderProductItem = ({ item }: { item: ProductItem }) => (
    <View style={styles.productCard}>
      <View style={styles.cardHeader}>
        {/* Imagen del producto o placeholder */}
        <View style={styles.imageContainer}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.productImage} resizeMode="cover" />
          ) : (
            <Package size={24} color={colors.textDim} />
          )}
        </View>

        {/* Info del producto */}
        <View style={styles.infoContainer}>
          <Text style={styles.skuText}>{item.sku}</Text>
          <Text style={styles.nameText} numberOfLines={2}>{item.name}</Text>

          {item.barcode && (
            <View style={styles.barcodeRow}>
              <BarcodeIcon size={12} color={colors.textDim} style={{ marginRight: 4 }} />
              <Text style={styles.barcodeText}>{item.barcode}</Text>
            </View>
          )}
        </View>

        {/* Badge de Stock */}
        <View style={styles.stockColumn}>
          <Text style={styles.stockLabel}>Disponible</Text>
          <StatusBadge status={String(item.available_stock)} type="stock" />
        </View>
      </View>

      {/* Detalle por bodegas */}
      {item.warehouses_detail.length > 0 && (
        <View style={styles.warehouseDetail}>
          {item.warehouses_detail.map((wh, idx) => (
            <View key={idx} style={styles.whRow}>
              <View style={styles.whLeft}>
                <Building2 size={12} color={colors.textDim} style={{ marginRight: 4 }} />
                <Text style={styles.whName}>{wh.warehouse_name}:</Text>
              </View>
              <Text style={styles.whQty}>
                {wh.quantity} un. {wh.committed_quantity > 0 ? `(${wh.committed_quantity} reservadas)` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Header title="Inventario" subtitle="Consulta de stock en tiempo real" />

      {/* Barra de búsqueda con botón de escáner */}
      <SearchInput
        value={search}
        onChangeText={val => {
          setSearch(val);
          loadInventory(val);
        }}
        placeholder="Buscar por SKU, nombre o código..."
        rightElement={
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={() => setScannerVisible(true)}
            activeOpacity={0.8}
          >
            <QrCode size={18} color="#fff" />
          </TouchableOpacity>
        }
      />

      {/* Filtros rápidos */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'todos' && styles.filterChipActive]}
          onPress={() => setFilter('todos')}
        >
          <Text style={[styles.filterText, filter === 'todos' && styles.filterTextActive]}>
            Todos ({products.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'con_stock' && styles.filterChipActive]}
          onPress={() => setFilter('con_stock')}
        >
          <Text style={[styles.filterText, filter === 'con_stock' && styles.filterTextActive]}>
            Con Stock ({products.filter(p => p.available_stock > 0).length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'out_of_stock' && styles.filterChipActive]}
          onPress={() => setFilter('out_of_stock')}
        >
          <Text style={[styles.filterText, filter === 'out_of_stock' && styles.filterTextActive]}>
            Agotados ({products.filter(p => p.available_stock <= 0).length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Lista de productos */}
      {loading ? (
        <View style={styles.loaderCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loaderText}>Consultando inventario...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={item => item.id}
          renderItem={renderProductItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Package size={48} color={colors.textDim} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>No se encontraron productos</Text>
              <Text style={styles.emptySub}>
                {search ? `Ningún producto coincide con "${search}"` : 'No hay productos registrados para este comercio.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Modal de Escaneo con Cámara */}
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScan={code => {
          setSearch(code);
          loadInventory(code);
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
  scanBtn: {
    backgroundColor: colors.primary,
    height: 44,
    width: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  imageContainer: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 12,
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  infoContainer: {
    flex: 1,
    paddingRight: 8,
  },
  skuText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryLight,
    letterSpacing: 0.5,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMain,
    marginTop: 2,
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  barcodeText: {
    fontSize: 11,
    color: colors.textDim,
  },
  stockColumn: {
    alignItems: 'flex-end',
    minWidth: 70,
  },
  stockLabel: {
    fontSize: 10,
    color: colors.textDim,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  warehouseDetail: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  whRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  whLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  whName: {
    fontSize: 11,
    color: colors.textMuted,
  },
  whQty: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMain,
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
