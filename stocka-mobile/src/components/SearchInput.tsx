// src/components/SearchInput.tsx - Barra de búsqueda con icono y botón de limpiar
import React from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { Search, X } from 'lucide-react-native';

interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  rightElement?: React.ReactNode;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChangeText,
  placeholder = 'Buscar...',
  onClear,
  rightElement,
}) => {
  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <Search size={18} color={colors.textDim} style={styles.icon} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="never"
        />
        {value.length > 0 && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => {
              onChangeText('');
              if (onClear) onClear();
            }}
          >
            <X size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      {rightElement && <View style={styles.rightSlot}>{rightElement}</View>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 44,
  },
  icon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: colors.textMain,
    fontSize: 14,
    height: '100%',
  },
  clearBtn: {
    padding: 4,
  },
  rightSlot: {
    flexShrink: 0,
  },
});
