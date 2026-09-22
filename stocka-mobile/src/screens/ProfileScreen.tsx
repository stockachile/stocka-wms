// src/screens/ProfileScreen.tsx - Perfil de usuario, datos del comercio y cierre de sesión
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Alert,
  Linking,
} from 'react-native';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { Header } from '../components/Header';
import {
  Building2,
  Mail,
  ShieldCheck,
  Phone,
  LogOut,
  FileText,
  ExternalLink,
  Smartphone,
} from 'lucide-react-native';

export const ProfileScreen: React.FC = () => {
  const { user, profile, signOut } = useAuth();

  const handleLogout = () => {
    Alert.alert('Cerrar Sesión', '¿Estás seguro de que deseas salir de tu cuenta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar Sesión', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const initials = profile?.full_name
    ? profile.full_name.split(' ').slice(0, 2).map(w => w[0]).join('')
    : user?.email?.substring(0, 2).toUpperCase() || 'ST';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Header title="Mi Cuenta" subtitle="Ajustes y perfil de usuario" />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Tarjeta de Usuario */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.userName}>{profile?.full_name || 'Usuario Stocka'}</Text>
          <Text style={styles.companyName}>{profile?.company_name || 'Comercio Asociado'}</Text>

          <View style={styles.verifiedBadge}>
            <ShieldCheck size={14} color={colors.success} style={{ marginRight: 4 }} />
            <Text style={styles.verifiedText}>Cliente Verificado WMS</Text>
          </View>
        </View>

        {/* Información de la cuenta */}
        <Text style={styles.sectionTitle}>Detalles de la Cuenta</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <Mail size={16} color={colors.primaryLight} style={{ marginRight: 10 }} />
              <Text style={styles.infoLabel}>Correo Electrónico</Text>
            </View>
            <Text style={styles.infoValue}>{user?.email || '—'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <Building2 size={16} color={colors.primaryLight} style={{ marginRight: 10 }} />
              <Text style={styles.infoLabel}>Comercio Asignado</Text>
            </View>
            <Text style={styles.infoValue}>{profile?.comercio || 'no asignado'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <ShieldCheck size={16} color={colors.primaryLight} style={{ marginRight: 10 }} />
              <Text style={styles.infoLabel}>Rol del Sistema</Text>
            </View>
            <Text style={styles.infoValue}>{profile?.role?.toUpperCase() || 'CLIENT'}</Text>
          </View>
        </View>

        {/* Recursos y Soporte */}
        <Text style={styles.sectionTitle}>Operaciones y Soporte</Text>
        <View style={styles.infoCard}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => Linking.openURL('https://wms.stocka.cl/privacy.html')}
          >
            <View style={styles.infoLeft}>
              <FileText size={16} color={colors.textMuted} style={{ marginRight: 10 }} />
              <Text style={styles.menuLabel}>Política de Privacidad</Text>
            </View>
            <ExternalLink size={14} color={colors.textDim} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => Linking.openURL('https://wms.stocka.cl/')}
          >
            <View style={styles.infoLeft}>
              <Smartphone size={16} color={colors.textMuted} style={{ marginRight: 10 }} />
              <Text style={styles.menuLabel}>Versión Web de Escritorio</Text>
            </View>
            <ExternalLink size={14} color={colors.textDim} />
          </TouchableOpacity>
        </View>

        {/* Botón Cerrar Sesión */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <LogOut size={18} color={colors.danger} style={{ marginRight: 8 }} />
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Stocka WMS Mobile · Versión 1.0.0</Text>
      </ScrollView>
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
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textMain,
  },
  companyName: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 10,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMain,
    marginBottom: 10,
    marginTop: 8,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMain,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  menuLabel: {
    fontSize: 13,
    color: colors.textMain,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    marginTop: 10,
  },
  logoutText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '700',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.textDim,
    marginTop: 20,
  },
});
