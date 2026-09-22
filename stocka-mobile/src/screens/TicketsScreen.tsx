// src/screens/TicketsScreen.tsx - Listado de tickets de soporte y mesa de ayuda
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
import { StatusBadge } from '../components/StatusBadge';
import { fetchTickets, fetchKamInfo, TicketItem, KamInfo } from '../api/tickets';
import { LifeBuoy, Plus, MessageCircle, Calendar, Tag } from 'lucide-react-native';

interface TicketsScreenProps {
  navigation: any;
}

export const TicketsScreen: React.FC<TicketsScreenProps> = ({ navigation }) => {
  const { user, profile } = useAuth();
  const comercio = profile?.comercio;

  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [kam, setKam] = useState<KamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTickets = async () => {
    if (!user?.id) return;
    try {
      const [tData, kData] = await Promise.all([
        fetchTickets(user.id, comercio),
        fetchKamInfo(comercio),
      ]);
      setTickets(tData);
      setKam(kData);
    } catch (e) {
      console.error('Error loading tickets:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, [user?.id, comercio]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTickets();
    setRefreshing(false);
  };

  const handleOpenWhatsApp = (phone: string) => {
    const clean = phone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${clean}?text=Hola,%20tengo%20una%20consulta%20para%20soporte%20Stocka%20(${profile?.company_name || comercio || ''})`;
    Linking.openURL(url).catch(err => console.error('Error opening WA:', err));
  };

  const renderTicketItem = ({ item }: { item: TicketItem }) => (
    <View style={styles.ticketCard}>
      <View style={styles.cardHeader}>
        <View style={styles.categoryBadge}>
          <Tag size={12} color={colors.primaryLight} style={{ marginRight: 4 }} />
          <Text style={styles.categoryText}>{item.category || 'General'}</Text>
        </View>
        <StatusBadge status={item.status} type="ticket" />
      </View>

      <Text style={styles.ticketSubject}>{item.subject}</Text>
      <Text style={styles.ticketDescription} numberOfLines={3}>
        {item.description}
      </Text>

      <View style={styles.cardFooter}>
        <View style={styles.dateRow}>
          <Calendar size={12} color={colors.textDim} style={{ marginRight: 4 }} />
          <Text style={styles.dateText}>
            {new Date(item.created_at).toLocaleDateString('es-CL', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>

        <View style={styles.priorityBadge}>
          <Text style={styles.priorityText}>Prioridad: {item.priority || 'Media'}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Header
        title="Soporte"
        subtitle="Mesa de ayuda e incidencias"
        rightAction={
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => navigation.navigate('CreateTicket')}
            activeOpacity={0.8}
          >
            <Plus size={16} color="#fff" />
            <Text style={styles.newBtnText}>Nuevo</Text>
          </TouchableOpacity>
        }
      />

      {/* Tarjeta de KAM Ejecutivo */}
      {kam && (
        <View style={styles.kamContainer}>
          <View style={styles.kamCard}>
            <View style={styles.kamAvatar}>
              <Text style={styles.kamInitials}>
                {kam.nombre.split(' ').slice(0, 2).map(w => w[0]).join('') || 'KAM'}
              </Text>
            </View>
            <View style={styles.kamInfo}>
              <Text style={styles.kamLabel}>{kam.roleLabel}</Text>
              <Text style={styles.kamName}>{kam.nombre}</Text>
              <Text style={styles.kamContact}>{kam.email}</Text>
            </View>
            <TouchableOpacity
              style={styles.kamBtn}
              onPress={() => handleOpenWhatsApp(kam.telefono)}
            >
              <MessageCircle size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Lista de Tickets */}
      {loading ? (
        <View style={styles.loaderCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loaderText}>Cargando casos...</Text>
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={item => item.id}
          renderItem={renderTicketItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <LifeBuoy size={48} color={colors.textDim} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>Sin casos registrados</Text>
              <Text style={styles.emptySub}>
                No tienes solicitudes de soporte abiertas en este momento.
              </Text>
              <TouchableOpacity
                style={styles.emptyCreateBtn}
                onPress={() => navigation.navigate('CreateTicket')}
              >
                <Text style={styles.emptyCreateBtnText}>Crear Primer Ticket</Text>
              </TouchableOpacity>
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
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  newBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  kamContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  kamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kamAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  kamInitials: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  kamInfo: {
    flex: 1,
  },
  kamLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primaryLight,
    textTransform: 'uppercase',
  },
  kamName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMain,
  },
  kamContact: {
    fontSize: 11,
    color: colors.textMuted,
  },
  kamBtn: {
    backgroundColor: colors.success,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  ticketCard: {
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
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryText: {
    fontSize: 11,
    color: colors.primaryLight,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  ticketSubject: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMain,
    marginBottom: 6,
  },
  ticketDescription: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 11,
    color: colors.textDim,
  },
  priorityBadge: {
    backgroundColor: colors.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityText: {
    fontSize: 11,
    color: colors.textDim,
    textTransform: 'capitalize',
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
    marginBottom: 16,
  },
  emptyCreateBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyCreateBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
