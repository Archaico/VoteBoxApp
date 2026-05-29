// src/screens/ProposalListScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Proposal {
  id: string;
  title: string;
  description: string;
  options: string[];
  creator: string;
  createdAt?: number;
  deadline: number;
  totalVotes?: number;
  results?: Record<string, number>;
  status?: 'active' | 'closed';
}

interface ProposalListScreenProps {
  onCreateProposal: () => void;
  onVoteProposal: (proposalId: string) => void;
  refreshTrigger?: number;
}

const PROPOSALS_STORAGE_KEY = '@cached_proposals';

export default function ProposalListScreen({
  onCreateProposal,
  onVoteProposal,
  refreshTrigger = 0,
}: ProposalListScreenProps) {
  const insets = useSafeAreaInsets();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    loadProposals();
  }, [refreshTrigger]);

  // Background refresh every 60 seconds — pull-to-refresh is the primary mechanism
  useEffect(() => {
    const interval = setInterval(() => {
      loadProposals(true);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadProposals = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);

      const stored = await AsyncStorage.getItem(PROPOSALS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const loadedProposals: Proposal[] = Array.isArray(parsed) ? parsed : (parsed.data || []);

        const now = Date.now();
        const activeProposals = loadedProposals.filter(p => p.deadline > now);

        if (activeProposals.length !== loadedProposals.length) {
          await AsyncStorage.setItem(
            PROPOSALS_STORAGE_KEY,
            JSON.stringify({ data: activeProposals, timestamp: Date.now() })
          );
        }

        setProposals(activeProposals);
        setLastUpdated(new Date());
      } else {
        setProposals([]);
      }
    } catch (error) {
      console.error('Failed to load proposals:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadProposals();
  };

  const getTimeRemaining = (deadline: number): string => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'Expired';
    const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    return `${minutes}m remaining`;
  };

  const renderProposal = ({ item }: { item: Proposal }) => (
    <TouchableOpacity
      style={styles.proposalCard}
      onPress={() => onVoteProposal(item.id)}
      activeOpacity={0.7}
    >
      <View style={styles.proposalHeader}>
        <Text style={styles.proposalTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.proposalTime}>
          {getTimeRemaining(item.deadline)}
        </Text>
      </View>
      <Text style={styles.proposalDescription} numberOfLines={3}>
        {item.description}
      </Text>
      <View style={styles.proposalFooter}>
        <Text style={styles.proposalOptions}>{item.options.length} options</Text>
        <Text style={styles.proposalVotes}>{item.totalVotes || 0} votes</Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>No Active Proposals</Text>
      <Text style={styles.emptyText}>
        Be the first to create a proposal and start the conversation!
      </Text>
      <TouchableOpacity style={styles.createFirstButton} onPress={onCreateProposal}>
        <Text style={styles.createFirstButtonText}>Create First Proposal</Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#22c55e" />
        <Text style={styles.loadingText}>Loading proposals...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.headerTitle}>VoteBoxApp</Text>
          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              Updated {lastUpdated.toLocaleTimeString()}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.createButton} onPress={onCreateProposal}>
          <Text style={styles.createButtonText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={proposals}
        renderItem={renderProposal}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContainer, { paddingBottom: insets.bottom + 8 }]}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={['#22c55e']}
            tintColor="#22c55e"
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#6b7280' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#111827' },
  lastUpdated: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  createButton: { backgroundColor: '#22c55e', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  createButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  listContainer: { padding: 16 },
  proposalCard: {
    backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2,
  },
  proposalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  proposalTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#111827', marginRight: 8 },
  proposalTime: { fontSize: 12, color: '#22c55e', fontWeight: '500' },
  proposalDescription: { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 12 },
  proposalFooter: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  proposalOptions: { fontSize: 13, color: '#9ca3af' },
  proposalVotes: { fontSize: 13, color: '#22c55e', fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#111827', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  createFirstButton: { backgroundColor: '#22c55e', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  createFirstButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
