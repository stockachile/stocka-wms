// src/components/StatusBadge.tsx - Badge estandarizado para estados de pedidos, tickets y stock
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

interface StatusBadgeProps {
  status: string;
  type?: 'order' | 'ticket' | 'stock';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'order' }) => {
  const norm = (status || '').toLowerCase().trim();

  let bg = 'rgba(148, 163, 184, 0.12)';
  let text = colors.textMuted;
  let label = status;

  if (type === 'order') {
    if (norm.includes('entregado') || norm.includes('completado') || norm.includes('finalizado')) {
      bg = colors.successLight;
      text = colors.success;
      label = 'Entregado';
    } else if (norm.includes('despachado') || norm.includes('transito') || norm.includes('en_ruta')) {
      bg = colors.infoLight;
      text = colors.info;
      label = 'En Tránsito';
    } else if (norm.includes('picking') || norm.includes('preparacion') || norm.includes('empaque')) {
      bg = colors.warningLight;
      text = colors.warning;
      label = 'En Picking';
    } else if (norm.includes('cancelado') || norm.includes('anulado') || norm.includes('falla')) {
      bg = colors.dangerLight;
      text = colors.danger;
      label = 'Cancelado';
    } else {
      bg = 'rgba(37, 99, 235, 0.12)';
      text = colors.primaryLight;
      label = 'Pendiente';
    }
  } else if (type === 'ticket') {
    if (norm === 'abierto') {
      bg = colors.dangerLight;
      text = colors.danger;
      label = 'Abierto';
    } else if (norm === 'en_proceso') {
      bg = colors.warningLight;
      text = colors.warning;
      label = 'En Proceso';
    } else if (norm === 'resuelto' || norm === 'cerrado') {
      bg = colors.successLight;
      text = colors.success;
      label = norm === 'resuelto' ? 'Resuelto' : 'Cerrado';
    }
  } else if (type === 'stock') {
    const qty = Number(status);
    if (qty > 10) {
      bg = colors.successLight;
      text = colors.success;
      label = `${qty} un.`;
    } else if (qty > 0) {
      bg = colors.warningLight;
      text = colors.warning;
      label = `${qty} un. (Bajo)`;
    } else {
      bg = colors.dangerLight;
      text = colors.danger;
      label = 'Agotado';
    }
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
