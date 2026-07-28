// src/screens/VotingScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { blockchainService } from '../services/BlockchainService';
import { notificationService } from '../services/NotificationService';
import { shareService } from '../services/ShareService';
import { offlineQueueService } from '../services/OfflineQueueService';
import { toastService } from '../services/ToastService';
import { discussionService } from '../services/DiscussionService';
import { voterIdentityService } from '../services/VoterIdentityService';
import { ShareButton } from '../components/ShareButton';
import { QueueIndicator } from '../components/QueueIndicator';
import { VoteSuccessModal } from '../components/VoteSuccessModal';
import { AttachmentImage } from '../components/AttachmentImage';
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
  attachments: [] as string[],
};

type VoteChoice = 'yes' | 'no' | 'abstain' | null;
type TabType = 'vote' | 'discussion';

export default function VotingScreen({
  proposalId,
  onBack,
  onVoteSubmitted,
}: VotingScreenProps) {
  const [activeTab, setActiveTab] = useState<TabType>('vote');
  const [commentCount, setCommentCount] = useState(0);

  const [selectedVote, setSelectedVote] = useState<VoteChoice>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [voteStatus, setVoteStatus] = useState('');
  const [proposal, setProposal] = useState(MOCK_PROPOSAL);
  const [voterId, setVoterId] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [votedChoice, setVotedChoice] = useState<string>('');

  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [submittedTxHash, setSubmittedTxHash] = useState('');
  const [viewingAttachment, setViewingAttachment] = useState<string | null>(null);

  useEffect(() => {
    loadProposal();
    voterIdentityService.getVoterId().then(id => setVoterId(id));
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
          votesYes: found.results ? (found.results['yes'] ?? found.results['Yes'] ?? 0) : 0,
          votesNo: found.results ? (found.results['no'] ?? found.results['No'] ?? 0) : 0,
          votesAbstain: found.results ? (found.results['abstain'] ?? found.results['Abstain'] ?? 0) : 0,
          attachments: found.attachments ?? [],
        });
        notificationService.checkFinalisedProposals(proposals).catch(() => {});
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
    if (proposal.deadline <= Date.now()) {
      toastService.error('Voting has closed for this proposal');
      return;
    }

    const activeVoterId = voterId || await voterIdentityService.getVoterId();
    setIsSubmitting(true);
    setVoteStatus('Preparing your vote...');

    try {
      setVoteStatus('Connecting to Cardano network...');
      await blockchainService.initialize();

      setVoteStatus('Submitting vote to blockchain...');
      const txHash = await blockchainService.submitVote({
        proposalId: proposal.id,
        choice: selectedVote,
        voterPubKey: activeVoterId,
        timestamp: Date.now(),
      });

      await AsyncStorage.setItem(`@voted_${proposalId}`, selectedVote);
      setHasVoted(true);
      setVotedChoice(selectedVote);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notificationService.subscribeToProposal(proposalId, 'voter', proposal.deadline, proposal.title).catch(() => {});
      notificationService.notifyVoteSubmitted(proposal.title).catch(() => {});

      setSubmittedTxHash(txHash || '');
      setShowSuccessModal(true);
    } catch (error: any) {
      console.error('Vote submission error:', error);

      if (error.message?.includes('network')) {
        toastService.warning('⚠️ Vote queued - will submit when online');
        await offlineQueueService.queueVote({
          proposalId: proposal.id,
          choice: selectedVote,
          voterPubKey: activeVoterId,
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
  const daysRemaining = Math.max(0, Math.ceil((proposal.deadline - Date.now()) / (1000 * 60 * 60 * 24)));
  const isExpired = proposal.deadline <= Date.now();

  const renderTabs = () => (
    <View style={styles.tabBar}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'vote' && styles.tabActive]}
        onPress={() => setActiveTab('vote')}
      >
        <Text style={[styles.tabText, activeTab === 'vote' && styles.tabTextActive]}>Vote</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'discussion' && styles.tabActive]}
        onPress={() => setActiveTab('discussion')}
      >
        <Text style={[styles.tabText, activeTab === 'discussion' && styles.tabTextActive]}>
          Discussion {commentCount > 0 ? `(${commentCount})` : ''}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderVoteTab = () => (
    <ScrollView style={styles.container}>
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
              results: { 'Yes': proposal.votesYes, 'No': proposal.votesNo, 'Abstain': proposal.votesAbstain },
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
          <View style={styles.proposalCard}>
            <Text style={styles.proposalTitle}>{proposal.title}</Text>
            <Text style={styles.proposalDescription}>{proposal.description}</Text>
            {proposal.attachments.length > 0 && (
              <View style={styles.attachmentRow}>
                {proposal.attachments.map((cid) => (
                  <TouchableOpacity key={cid} onPress={() => setViewingAttachment(cid)}>
                    <AttachmentImage cid={cid} style={styles.attachmentThumb} resizeMode="cover" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Created by:</Text>
              <Text style={styles.metaValue}>{proposal.creator}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Deadline:</Text>
              <Text style={styles.deadlineValue}>
                {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
              </Text>
            </View>
          </View>

          <View style={styles.resultsCard}>
            <Text style={styles.sectionTitle}>Current Results</Text>
            <Text style={styles.totalVotes}>{totalVotes} total votes</Text>

            {[
              { label: 'Yes', pct: yesPercentage, count: proposal.votesYes, style: styles.progressYes },
              { label: 'No', pct: noPercentage, count: proposal.votesNo, style: styles.progressNo },
              { label: 'Abstain', pct: abstainPercentage, count: proposal.votesAbstain, style: styles.progressAbstain },
            ].map(({ label, pct, count, style }) => (
              <View key={label} style={styles.resultRow}>
                <View style={styles.resultLabel}>
                  <Text style={styles.resultText}>{label}</Text>
                  <Text style={styles.resultPercent}>{pct}%</Text>
                </View>
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressBar, style, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.resultCount}>{count}</Text>
              </View>
            ))}
          </View>

          {hasVoted ? (
            <View style={styles.votedCard}>
              <Text style={styles.votedTitle}>✅ You've Already Voted</Text>
              <Text style={styles.votedChoice}>
                Your vote: <Text style={styles.votedChoiceValue}>{votedChoice.toUpperCase()}</Text>
              </Text>
              <Text style={styles.votedNote}>You cannot change your vote once submitted.</Text>
            </View>
          ) : isExpired ? (
            <View style={styles.votedCard}>
              <Text style={styles.votedTitle}>🔒 Voting Has Closed</Text>
              <Text style={styles.votedNote}>
                This proposal's deadline has passed. Votes are no longer being accepted.
              </Text>
            </View>
          ) : (
            <View style={styles.votingCard}>
              <Text style={styles.sectionTitle}>Cast Your Vote</Text>
              <View style={styles.privacyNotice}>
                <Text style={styles.privacyText}>
                  🔒 Your vote is completely anonymous and cannot be traced back to you
                </Text>
              </View>
              <View style={styles.voteOptions}>
                {(['yes', 'no', 'abstain'] as VoteChoice[]).map((choice) => (
                  <TouchableOpacity
                    key={choice}
                    style={[styles.voteButton, selectedVote === choice && styles.voteButtonSelected]}
                    onPress={() => setSelectedVote(choice)}
                  >
                    <Text style={[styles.voteButtonText, selectedVote === choice && styles.voteButtonTextSelected]}>
                      {choice === 'yes' ? '✅ Yes' : choice === 'no' ? '❌ No' : '⚪ Abstain'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {voteStatus ? <Text style={styles.statusText}>{voteStatus}</Text> : null}
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
          )}
        </>
      )}
    </ScrollView>
  );

  const renderDiscussionTab = () => (
    <ProposalDiscussion
      proposalId={proposalId}
      userAddress={voterId}
      proposalTitle={proposal.title}
      proposalDeadline={proposal.deadline}
    />
  );

  return (
    <View style={styles.screenContainer}>
      {renderTabs()}
      {activeTab === 'vote' ? renderVoteTab() : renderDiscussionTab()}

      <VoteSuccessModal
        visible={showSuccessModal}
        proposalId={proposal.id}
        txHash={submittedTxHash}
        proposal={{
          id: proposal.id,
          title: proposal.title,
          description: proposal.description,
          deadline: proposal.deadline,
          totalVotes: totalVotes,
        }}
        votedChoice={votedChoice}
        onClose={() => {
          setShowSuccessModal(false);
          onVoteSubmitted();
        }}
      />

      <Modal visible={!!viewingAttachment} transparent animationType="fade">
        <TouchableOpacity
          style={styles.attachmentViewerBackdrop}
          activeOpacity={1}
          onPress={() => setViewingAttachment(null)}
        >
          {viewingAttachment && (
            <AttachmentImage
              cid={viewingAttachment}
              style={styles.attachmentViewerImage}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#f5f5f5' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e0e0e0', paddingTop: 8 },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#22c55e' },
  tabText: { fontSize: 16, color: '#666', fontWeight: '500' },
  tabTextActive: { color: '#22c55e', fontWeight: '700' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e0e0e0',
  },
  headerActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  backButton: { padding: 8 },
  backText: { fontSize: 16, color: '#22c55e', fontWeight: '600' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 16, fontSize: 16, color: '#666' },
  proposalCard: {
    backgroundColor: '#fff', margin: 16, padding: 20, borderRadius: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  proposalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 12 },
  proposalDescription: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 16 },
  attachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  attachmentThumb: { width: 90, height: 90, borderRadius: 8, backgroundColor: '#f3f4f6' },
  attachmentViewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  attachmentViewerImage: { width: '95%', height: '80%' },
  metaRow: { flexDirection: 'row', marginBottom: 8 },
  metaLabel: { fontSize: 14, color: '#666', fontWeight: '600', marginRight: 8 },
  metaValue: { fontSize: 14, color: '#444' },
  deadlineValue: { fontSize: 14, color: '#ef4444', fontWeight: '600' },
  resultsCard: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, padding: 20, borderRadius: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 8 },
  totalVotes: { fontSize: 14, color: '#666', marginBottom: 16 },
  resultRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  resultLabel: { width: 80 },
  resultText: { fontSize: 14, fontWeight: '600', color: '#333' },
  resultPercent: { fontSize: 12, color: '#666' },
  progressBarContainer: { flex: 1, height: 24, backgroundColor: '#e5e5e5', borderRadius: 12, overflow: 'hidden', marginHorizontal: 12 },
  progressBar: { height: '100%', borderRadius: 12 },
  progressYes: { backgroundColor: '#22c55e' },
  progressNo: { backgroundColor: '#ef4444' },
  progressAbstain: { backgroundColor: '#94a3b8' },
  resultCount: { fontSize: 14, fontWeight: '600', color: '#333', width: 40, textAlign: 'right' },
  votingCard: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, padding: 20, borderRadius: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  privacyNotice: { backgroundColor: '#f0fdf4', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#86efac' },
  privacyText: { fontSize: 13, color: '#166534', textAlign: 'center' },
  voteOptions: { marginBottom: 16 },
  voteButton: { backgroundColor: '#f5f5f5', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 2, borderColor: 'transparent' },
  voteButtonSelected: { backgroundColor: '#f0fdf4', borderColor: '#22c55e' },
  voteButtonText: { fontSize: 16, fontWeight: '600', color: '#666', textAlign: 'center' },
  voteButtonTextSelected: { color: '#22c55e' },
  statusText: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 12 },
  submitButton: { backgroundColor: '#22c55e', padding: 16, borderRadius: 12, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#d1d5db' },
  submitButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  votedCard: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, padding: 24, borderRadius: 12,
    alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  votedTitle: { fontSize: 20, fontWeight: 'bold', color: '#22c55e', marginBottom: 12 },
  votedChoice: { fontSize: 16, color: '#666', marginBottom: 8 },
  votedChoiceValue: { fontWeight: 'bold', color: '#22c55e' },
  votedNote: { fontSize: 13, color: '#999', textAlign: 'center' },
});
