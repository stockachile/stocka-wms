// src/screens/CreateTicketScreen.tsx - Formulario para levantar tickets e incidencias con fotos desde el smartphone
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { createTicket } from '../api/tickets';
import { ArrowLeft, Camera, Image as ImageIcon, X, CheckCircle2 } from 'lucide-react-native';

interface CreateTicketScreenProps {
  navigation: any;
}

export const CreateTicketScreen: React.FC<CreateTicketScreenProps> = ({ navigation }) => {
  const { user, profile } = useAuth();
  const comercio = profile?.comercio || 'no asignado';

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('incidencia');
  const [priority, setPriority] = useState('media');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso Denegado', 'Se requiere acceso a la cámara para tomar fotografías del caso.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!subject.trim()) {
      Alert.alert('Campo Requerido', 'Por favor ingresa un asunto para el caso.');
      return;
    }

    if (!description.trim()) {
      Alert.alert('Campo Requerido', 'Por favor describe los detalles de la consulta o incidencia.');
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'Sesión no activa.');
      return;
    }

    setLoading(true);

    const res = await createTicket({
      userId: user.id,
      userEmail: user.email || '',
      comercio,
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
      photoUri: photoUri || undefined,
    });

    setLoading(false);

    if (res.success) {
      Alert.alert('¡Caso Creado!', 'Tu solicitud ha sido enviada al equipo de operaciones de Stocka.', [
        {
          text: 'Aceptar',
          onPress: () => navigation.goBack(),
        },
      ]);
    } else {
      Alert.alert('Error', res.error || 'No se pudo registrar el caso.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Header con botón atrás */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nuevo Caso de Soporte</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Asunto */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Asunto / Título del Caso *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej. Daño en producto SKU-104 o Consulta de cobro"
            placeholderTextColor={colors.textDim}
            value={subject}
            onChangeText={setSubject}
          />
        </View>

        {/* Categoría */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Categoría</Text>
          <View style={styles.pillsRow}>
            {[
              { id: 'incidencia', label: 'Incidencia Bodega' },
              { id: 'pedidos', label: 'Despachos' },
              { id: 'facturacion', label: 'Facturación' },
              { id: 'otros', label: 'Otra Consulta' },
            ].map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.pill, category === cat.id && styles.pillActive]}
                onPress={() => setCategory(cat.id)}
              >
                <Text style={[styles.pillText, category === cat.id && styles.pillTextActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Prioridad */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Nivel de Prioridad</Text>
          <View style={styles.pillsRow}>
            {[
              { id: 'baja', label: 'Baja' },
              { id: 'media', label: 'Media' },
              { id: 'alta', label: 'Alta' },
              { id: 'urgente', label: 'Urgente' },
            ].map(p => (
              <TouchableOpacity
                key={p.id}
                style={[styles.pill, priority === p.id && styles.pillActive]}
                onPress={() => setPriority(p.id)}
              >
                <Text style={[styles.pillText, priority === p.id && styles.pillTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Descripción */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Descripción Detallada *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Explica detalladamente la situación, incluyendo números de orden, SKU o fecha..."
            placeholderTextColor={colors.textDim}
            multiline
            numberOfLines={4}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />
        </View>

        {/* Adjuntar Foto con Cámara */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Evidencia Fotográfica (Opcional)</Text>
          {photoUri ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
              <TouchableOpacity style={styles.removePhotoBtn} onPress={() => setPhotoUri(null)}>
                <X size={16} color="#fff" />
              </TouchableOpacity>
              <View style={styles.photoAttachedBadge}>
                <CheckCircle2 size={12} color="#fff" style={{ marginRight: 4 }} />
                <Text style={styles.photoAttachedText}>Foto adjunta lista para enviar</Text>
              </View>
            </View>
          ) : (
            <View style={styles.photoButtonsRow}>
              <TouchableOpacity style={styles.photoActionBtn} onPress={handleTakePhoto}>
                <Camera size={20} color={colors.primaryLight} style={{ marginBottom: 4 }} />
                <Text style={styles.photoActionText}>Tomar Foto</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.photoActionBtn} onPress={handlePickImage}>
                <ImageIcon size={20} color={colors.primaryLight} style={{ marginBottom: 4 }} />
                <Text style={styles.photoActionText}>Subir de Galería</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Botón Enviar */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Enviar Caso a Soporte</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMain,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMain,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 48,
    color: colors.textMain,
    fontSize: 14,
  },
  textArea: {
    height: 120,
    paddingTop: 12,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    borderColor: colors.primary,
  },
  pillText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  pillTextActive: {
    color: colors.primaryLight,
    fontWeight: '700',
  },
  photoButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  photoActionBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMain,
  },
  previewContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    height: 180,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAttachedBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  photoAttachedText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
