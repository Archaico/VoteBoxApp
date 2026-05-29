// src/screens/VotingScreen.tsx
//
// VoteBox Voting Screen with Discussion Tabs
// ─────────────────────────────────────────────────────────────────────────────
// Enhanced version with:
//   • Tab 1: Vote (original voting UI)
//   • Tab 2: Discussion (comments, replies, reactions)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { blockchainService } from '../services/BlockchainService';
import { shareService } from '../services/ShareService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { offlineQueueService } from '../services/OfflineQueueService';
import { toastService } from '../services/ToastService';
import { discussionService } from '../services/DiscussionService';
import { ShareButton } from '../components/ShareButton';
import { QueueIndicator } from '../components/QueueIndicator';
import ProposalDiscussion from '../config/ProposalDiscussion';

interface VotingScreenProps {
  proposalId: string;
  onBack: () => void;
  onVoteSubmitted: () => void;
}

const MOCK_PROPOSAL = {
  id: '1',
  title: 'Increase Community Fund by 10%',
  description: 'Proposal to allocate an additional 10% to the community development fund. This will enable us to support more grassroots initiatives and provide resources for underserved communities. The fund will be distributed through a transparent process with quarterly reviews.',
  creator: 'alice@votebox.org',
  deadline: Date.now() + 5 * 24 * 60 * 60 * 1000,
  votesYes: 145,
  votesNo: 32,
  votesAbstain: 12,
};

type VoteChoice = 'yes' | 'no' | 'abstain' | null;
type TabType = 'vote' | 'discussion';

const VOTER_KEY_STORAGE = '@votebox_voter_key';

const getOrCreateVoterKey = async (): Promise<string> => {
  try {
    const existing = await AsyncStorage.getItem(VOTER_KEY_STORAGE);
    if (existing) return existing;
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 15)
      + Math.random().toString(36).substring(2, 15);
    const voterKey = `vb_${timestamp}_${randomPart}`;
    await AsyncStorage.setItem(VOTER_KEY_STORAGE, voterKey);
    return voterKey;
  } catch (error) {
    console.error('Voter key storage error:', error);
    return `vb_ephemeral_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }
};

export default function VotingScreen({
  proposalId,
  onBack,
  onVoteSubmitted,
}: VotingScreenProps) {
  const insets = useSafeAreaInsets();
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('vote');
  const [commentCount, setCommentCount] = useState(0);

  // Voting state
  const [selectedVote, setSelectedVote] = useState<VoteChoice>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [voteStatus, setVoteStatus] = useState('');
  const [proposal, setProposal] = useState(MOCK_PROPOSAL);
  const [voterKey, setVoterKey] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [votedChoice, setVotedChoice] = useState<string>('');

  useEffect(() => {
    loadProposal();
    getOrCreateVoterKey().then(key => setVoterKey(key));
    checkIfAlreadyVoted();
    loadCommentCount();
  }, [proposalId]);

  const loadCommentCount = async () => {
    const count = await discussionService.getCommentCount(proposalId);
    setCommentCount(count);
  };

  const checkIfAlreadyVoted = async () => {
    try {
      const voted = await AsyncStorage.getItem(`@voted_${proposalId}`);
      if (voted) {
        setHasVoted(true);
        setVotedChoice(voted);
      }
    } catch (error) {
      console.error('Error checking vote status:', error);
    }
  };

  const loadProposal = async () => {
    try {
      setIsLoading(true);
      await blockchainService.initialize();
      const proposals = await blockchainService.getProposals();
      const found = proposals.find(p => p.id === proposalId);
      if (found) {
        setProposal({
          id: found.id,
          title: found.title,
          description: found.description,
          creator: found.creator || 'Unknown',
          deadline: found.deadline,
          votesYes: found.results ? found.results['yes'] || 0 : 0,
          votesNo: found.results ? found.results['no'] || 0 : 0,
          votesAbstain: found.results ? found.results['abstain'] || 0 : 0,
        });
      }
    } catch (error) {
      console.log('Using mock proposal data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoteSubmit = async () => {
    if (!selectedVote) {
      toastService.warning('Please select your vote first');
      return;
    }

    const activeVoterKey = voterKey || await getOrCreateVoterKey();
    setIsSubmitting(true);
    setVoteStatus('Preparing your vote...');

    try {
      setVoteStatus('Connecting to Cardano network...');
      await blockchainService.initialize();

      setVoteStatus('Submitting vote to blockchain...');
      const txHash = await blockchainService.submitVote({
        proposalId: proposal.id,
        choice: selectedVote,
        voterPubKey: activeVoterKey,
        timestamp: Date.now(),
      });

      await AsyncStorage.setItem(`@voted_${proposalId}`, selectedVote);
      setHasVoted(true);
      setVotedChoice(selectedVote);

      toastService.success('✅ Vote submitted successfully!');
      
      if (txHash) {
        console.log('Transaction hash:', txHash);
      }

      setTimeout(() => {
        onVoteSubmitted();
      }, 1500);

    } catch (error: any) {
      console.error('Vote submission error:', error);

      if (error.message?.includes('network')) {
        toastService.warning('⚠️ Vote queued - will submit when online');
        
        await offlineQueueService.queueVote({
          proposalId: proposal.id,
          choice: selectedVote,
          voterPubKey: activeVoterKey,
          timestamp: Date.now(),
        });
      } else {
        toastService.error(`❌ Vote failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsSubmitting(false);
      setVoteStatus('');
    }
  };

  const totalVotes = proposal.votesYes + proposal.votesNo + proposal.votesAbstain;
  const yesPercentage = totalVotes > 0 ? Math.round((proposal.votesYes / totalVotes) * 100) : 0;
  const noPercentage = totalVotes > 0 ? Math.round((proposal.votesNo / totalVotes) * 100) : 0;
  const abstainPercentage = totalVotes > 0 ? Math.round((proposal.votesAbstain / totalVotes) * 100) : 0;

  const timeRemaining = proposal.deadline - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60 * 24)));

  // Render tab buttons
  const renderTabs = () => (
    <View style={[styles.tabBar, { paddingTop: insets.top + 4 }]}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'vote' && styles.tabActive]}
        onPress={() => setActiveTab('vote')}
      >
        <Text style={[styles.tabText, activeTab === 'vote' && styles.tabTextActive]}>
          Vote
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'discussion' && styles.tabActive]}
        onPress={() => setActiveTab('discussion')}
      >
        <Text style={[styles.tabText, activeTab === 'discussion' && styles.tabTextActive]}>
          Discussion{commentCount > 0 ? ` (${commentCount})` : ''}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Render vote tab content (original voting UI)
  const renderVoteTab = () => (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <ShareButton 
            proposal={{
              id: proposal.id,
              title: proposal.title,
              description: proposal.description,
              deadline: proposal.deadline,
              totalVotes: totalVotes,
              results: {
                'Yes': proposal.votesYes,
                'No': proposal.votesNo,
                'Abstain': proposal.votesAbstain,
              },
              creator: proposal.creator,
            }}
            moment="invite"
          />
          <QueueIndicator />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#22c55e" />
          <Text style={styles.loadingText}>Loading proposal...</Text>
        </View>
      ) : (
        <>
          {/* Proposal Details */}
          <View style={styles.proposalCard}>
            <Text style={styles.proposalTitle}>{proposal.title}</Text>
            <Text style={styles.proposalDescription}>{proposal.description}</Text>
            
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Created by:</Text>
              <Text style={styles.metaValue} numberOfLines={1} ellipsizeMode="middle">{proposal.creator}</Text>
            </View>
            
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Deadline:</Text>
              <Text style={styles.deadlineValue}>
                {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
              </Text>
            </View>
          </View>

          {/* Current Results */}
          <View style={styles.resultsCard}>
            <Text style={styles.sectionTitle}>Current Results</Text>
            <Text style={styles.totalVotes}>{totalVotes} total votes</Text>

            <View style={styles.resultRow}>
              <View style={styles.resultLabel}>
                <Text style={styles.resultText}>Yes</Text>
                <Text style={styles.resultPercent}>{yesPercentage}%</Text>
              </View>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBar, styles.progressYes, { width: `${yesPercentage}%` }]} />
              </View>
              <Text style={styles.resultCount}>{proposal.votesYes}</Text>
            </View>

            <View style={styles.resultRow}>
              <View style={styles.resultLabel}>
                <Text style={styles.resultText}>No</Text>
                <Text style={styles.resultPercent}>{noPercentage}%</Text>
              </View>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBar, styles.progressNo, { width: `${noPercentage}%` }]} />
              </View>
              <Text style={styles.resultCount}>{proposal.votesNo}</Text>
            </View>

            <View style={styles.resultRow}>
              <View style={styles.resultLabel}>
                <Text style={styles.resultText}>Abstain</Text>
                <Text style={styles.resultPercent}>{abstainPercentage}%</Text>
              </View>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBar, styles.progressAbstain, { width: `${abstainPercentage}%` }]} />
              </View>
              <Text style={styles.resultCount}>{proposal.votesAbstain}</Text>
            </View>
          </View>

          {/* Voting Section */}
          {!hasVoted ? (
            <View style={styles.votingCard}>
              <Text style={styles.sectionTitle}>Cast Your Vote</Text>
              
              <View style={styles.privacyNotice}>
                <Text style={styles.privacyText}>
                  🔒 Your vote is completely anonymous and cannot be traced back to you
                </Text>
              </View>

              <View style={styles.voteOptions}>
                <TouchableOpacity
                  style={[styles.voteButton, selectedVote === 'yes' && styles.voteButtonSelected]}
                  onPress={() => setSelectedVote('yes')}
                >
                  <Text style={[styles.voteButtonText, selectedVote === 'yes' && styles.voteButtonTextSelected]}>
                    ✅ Yes
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.voteButton, selectedVote === 'no' && styles.voteButtonSelected]}
                  onPress={() => setSelectedVote('no')}
                >
                  <Text style={[styles.voteButtonText, selectedVote === 'no' && styles.voteButtonTextSelected]}>
                    ❌ No
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.voteButton, selectedVote === 'abstain' && styles.voteButtonSelected]}
                  onPress={() => setSelectedVote('abstain')}
                >
                  <Text style={[styles.voteButtonText, selectedVote === 'abstain' && styles.voteButtonTextSelected]}>
                    ⚪ Abstain
                  </Text>
                </TouchableOpacity>
              </View>

              {voteStatus && <Text style={styles.statusText}>{voteStatus}</Text>}

              <TouchableOpacity
                style={[styles.submitButton, (!selectedVote || isSubmitting) && styles.submitButtonDisabled]}
                onPress={handleVoteSubmit}
                disabled={!selectedVote || isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Vote</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.votedCard}>
              <Text style={styles.votedTitle}>✅ You've Already Voted</Text>
              <Text style={styles.votedChoice}>
                Your vote: <Text style={styles.votedChoiceValue}>{votedChoice.toUpperCase()}</Text>
              </Text>
              <Text style={styles.votedNote}>
                You cannot change your vote once submitted.
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );

  // Render discussion tab content
  const renderDiscussionTab = () => (
    <ProposalDiscussion
      proposalId={proposalId}
      userAddress={voterKey}
    />
  );

  return (
    <View style={styles.screenContainer}>
      {renderTabs()}
      {activeTab === 'vote' ? renderVoteTab() : renderDiscussionTab()}
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#22c55e',
  },
  tabText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#22c55e',
    fontWeight: '700',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  backButton: {
    padding: 8,
  },
  backText: {
    fontSize: 16,
    color: '#22c55e',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  proposalCard: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  proposalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  proposalDescription: {
    fontSize: 15,
    color: '#444',
    lineHeight: 22,
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  metaLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
    marginRight: 8,
  },
  metaValue: {
    fontSize: 14,
    color: '#444',
    flex: 1,
  },
  deadlineValue: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '600',
  },
  resultsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  totalVotes: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  resultLabel: {
    width: 80,
  },
  resultText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  resultPercent: {
    fontSize: 12,
    color: '#666',
  },
  progressBarContainer: {
    flex: 1,
    height: 24,
    backgroundColor: '#e5e5e5',
    borderRadius: 12,
    overflow: 'hidden',
    marginHorizontal: 12,
  },
  progressBar: {
    height: '100%',
    borderRadius: 12,
  },
  progressYes: {
    backgroundColor: '#22c55e',
  },
  progressNo: {
    backgroundColor: '#ef4444',
  },
  progressAbstain: {
    backgroundColor: '#94a3b8',
  },
  resultCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    width: 40,
    textAlign: 'right',
  },
  votingCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  privacyNotice: {
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  privacyText: {
    fontSize: 13,
    color: '#166534',
    textAlign: 'center',
  },
  voteOptions: {
    marginBottom: 16,
  },
  voteButton: {
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  voteButtonSelected: {
    backgroundColor: '#f0fdf4',
    borderColor: '#22c55e',
  },
  voteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  voteButtonTextSelected: {
    color: '#22c55e',
  },
  statusText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: '#22c55e',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  votedCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  votedTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#22c55e',
    marginBottom: 12,
  },
  votedChoice: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  votedChoiceValue: {
    fontWeight: 'bold',
    color: '#22c55e',
  },
  votedNote: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
  },
});
