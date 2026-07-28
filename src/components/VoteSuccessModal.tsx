// src/components/VoteSuccessModal.tsx

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Platform, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ShareButton } from './ShareButton';
import type { ShareableProposal } from '../services/ShareService';

interface VoteSuccessModalProps {
  visible: boolean;
  proposalId: string;
  txHash: string;
  proposal: ShareableProposal;
  votedChoice: string;
  onClose: () => void;
}

const CopyRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono = false }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      Alert.alert('Copy failed', 'Please copy manually: ' + value);
    }
  };

  return (
    <View style={styles.copyRow}>
      <Text style={styles.copyLabel}>{label}</Text>
      <View style={styles.copyValueRow}>
        <Text style={[styles.copyValue, mono && styles.copyValueMono]} numberOfLines={1} ellipsizeMode="middle">
          {value}
        </Text>
        <TouchableOpacity style={[styles.copyBtn, copied && styles.copyBtnDone]} onPress={handleCopy} activeOpacity={0.7}>
          <Text style={[styles.copyBtnText, copied && styles.copyBtnTextDone]}>
            {copied ? '✓ Copied' : '⎘ Copy'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const VoteSuccessModal: React.FC<VoteSuccessModalProps> = ({ visible, proposalId, txHash, proposal, votedChoice, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
    <View style={styles.cardWrapper}>
      <View style={styles.card}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <Text style={styles.checkmark}>✅</Text>
            <View style={styles.headerText}>
              <Text style={styles.title}>Vote Submitted</Text>
              <Text style={styles.subtitle}>Recorded on the Cardano blockchain</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.chainBadge}>
            <Text style={styles.chainIcon}>⛓</Text>
            <Text style={styles.chainLabel}>Cardano</Text>
            <View style={styles.chainDot} />
            <Text style={styles.chainNetwork}>Testnet</Text>
          </View>

          <CopyRow label="Proposal ID" value={proposalId} mono />
          <CopyRow label="Transaction hash" value={txHash} mono />

          <View style={styles.choiceRow}>
            <Text style={styles.copyLabel}>Your vote</Text>
            <Text style={styles.choiceValue}>
              {votedChoice.charAt(0).toUpperCase() + votedChoice.slice(1)}
            </Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.sharePrompt}>Let others know you voted 👇</Text>

          <ShareButton proposal={proposal} moment="voted" choice={votedChoice} variant="outline" label="Share That You Voted" />

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  cardWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  card: { backgroundColor: '#ffffff', borderRadius: 20, maxHeight: '85%', overflow: 'hidden' },
  scrollContent: { padding: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  checkmark: { fontSize: 40 },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 2 },
  subtitle: { fontSize: 13, color: '#6b7280' },
  divider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 16 },
  chainBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16, gap: 6, alignSelf: 'flex-start' },
  chainIcon: { fontSize: 14 },
  chainLabel: { fontSize: 13, fontWeight: '700', color: '#15803d' },
  chainDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#86efac' },
  chainNetwork: { fontSize: 12, color: '#22c55e', fontWeight: '500' },
  copyRow: { marginBottom: 12 },
  copyLabel: { fontSize: 11, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  copyValueRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', paddingLeft: 12, paddingRight: 4, paddingVertical: 4, gap: 8 },
  copyValue: { flex: 1, fontSize: 13, color: '#374151', paddingVertical: 6 },
  copyValueMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: '#111827' },
  copyBtn: { backgroundColor: '#f3f4f6', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  copyBtnDone: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
  copyBtnText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  copyBtnTextDone: { color: '#15803d' },
  choiceRow: { marginBottom: 4 },
  choiceValue: { fontSize: 15, fontWeight: '700', color: '#22c55e', paddingVertical: 4 },
  sharePrompt: { fontSize: 13, color: '#6b7280', marginBottom: 10, textAlign: 'center' },
  closeBtn: { backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  closeBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
