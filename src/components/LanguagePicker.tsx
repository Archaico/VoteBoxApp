// src/components/LanguagePicker.tsx
//
// Header button (🌐) that opens a list of the app's languages. Choosing one
// switches the UI immediately and is remembered across restarts.

import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Modal, View, FlatList, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';

export const LanguagePicker: React.FC = () => {
  const { t, i18n } = useTranslation('common');
  const [open, setOpen] = useState(false);

  const choose = async (code: string) => {
    setOpen(false);
    const needsRestart = await setLanguage(code);
    if (needsRestart) Alert.alert(t('language.restartTitle'), t('language.restartMessage'));
  };

  return (
    <>
      <TouchableOpacity
        style={styles.badge}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityLabel={t('language.title')}
      >
        <Text style={styles.badgeIcon}>🌐</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>{t('language.title')}</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={l => l.code}
              renderItem={({ item }) => {
                const selected = item.code === i18n.language;
                return (
                  <TouchableOpacity
                    style={[styles.row, selected && styles.rowSelected]}
                    onPress={() => choose(item.code)}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.rowText, selected && styles.rowTextSelected]}>{item.nativeName}</Text>
                    {selected && <Text style={styles.check}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  badge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: { fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 12, maxHeight: '80%' },
  title: { fontSize: 16, fontWeight: '600', color: '#111827', paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  rowSelected: { backgroundColor: '#f0fdf4' },
  rowText: { fontSize: 15, color: '#111827' },
  rowTextSelected: { fontWeight: '600', color: '#15803d' },
  check: { fontSize: 16, color: '#15803d' },
});
