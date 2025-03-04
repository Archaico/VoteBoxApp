// src/services/VoteVerificationService.ts
import { analyticsService } from './AnalyticsService';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface VoteVerification {
  proposalId: string;
  voterPubKey: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'rejected';
  reason?: string;
}

export class VoteVerificationService {
  private static readonly VOTE_HISTORY_KEY = '@vote_history';
  
  static async verifyVote(
    proposalId: string,
    voterPubKey: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      // Check local vote history
      const hasVoted = await this.hasVotedLocally(proposalId, voterPubKey);
      if (hasVoted) {
        return { valid: false, reason: 'Already voted on this proposal' };
      }

      // Check on-chain vote status
      const onChainStatus = await this.checkOnChainVoteStatus(proposalId, voterPubKey);
      if (!onChainStatus.valid) {
        return onChainStatus;
      }

      await analyticsService.trackEvent('vote_verified', {
        proposalId,
        voterPubKey,
      });

      return { valid: true };
    } catch (error) {
      console.error('Vote verification failed:', error);
      await analyticsService.trackEvent('vote_verification_failed', {
        proposalId,
        voterPubKey,
        error: error.message,
      });
      throw error;
    }
  }

  static async recordVote(
    proposalId: string,
    voterPubKey: string,
    status: 'pending' | 'confirmed' | 'rejected',
    reason?: string,
  ): Promise<void> {
    try {
      const voteHistory = await this.getVoteHistory();
      
      voteHistory.push({
        proposalId,
        voterPubKey,
        timestamp: Date.now(),
        status,
        reason,
      });

      await AsyncStorage.setItem(
        this.VOTE_HISTORY_KEY,
        JSON.stringify(voteHistory)
      );

      await analyticsService.trackEvent('vote_recorded', {
        proposalId,
        status,
        reason,
      });
    } catch (error) {
      console.error('Error recording vote:', error);
      throw error;
    }
  }

  private static async hasVotedLocally(
    proposalId: string,
    voterPubKey: string,
  ): Promise<boolean> {
    const voteHistory = await this.getVoteHistory();
    return voteHistory.some(
      vote => 
        vote.proposalId === proposalId &&
        vote.voterPubKey === voterPubKey &&
        vote.status !== 'rejected'
    );
  }

  private static async checkOnChainVoteStatus(
    proposalId: string,
    voterPubKey: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      // Implement blockchain verification logic here
      // This would interact with your Cardano node or service
      return { valid: true };
    } catch (error) {
      console.error('On-chain vote status check failed:', error);
      throw error;
    }
  }

  private static async getVoteHistory(): Promise<VoteVerification[]> {
    try {
      const history = await AsyncStorage.getItem(this.VOTE_HISTORY_KEY);
      return history ? JSON.parse(history) : [];
    } catch (error) {
      console.error('Error getting vote history:', error);
      return [];
    }
  }
}

// Usage in VotingScreen:
/*
const handleVoteSubmission = async () => {
  try {
    // Verify vote first
    const verification = await VoteVerificationService.verifyVote(
      proposal.id,
      walletAddress
    );

    if (!verification.valid) {
      Alert.alert('Vote Failed', verification.reason);
      return;
    }

    // Record pending vote
    await VoteVerificationService.recordVote(
      proposal.id,
      walletAddress,
      'pending'
    );

    // Submit vote
    const txHash = await submitVote({
      proposalId: proposal.id,
      choice: selectedOption,
      voterPubKey: walletAddress,
      timestamp: Date.now(),
    });

    // Record confirmed vote
    await VoteVerificationService.recordVote(
      proposal.id,
      walletAddress,
      'confirmed'
    );

    Alert.alert('Success', 'Your vote has been recorded');
  } catch (error) {
    // Record failed vote
    await VoteVerificationService.recordVote(
      proposal.id,
      walletAddress,
      'rejected',
      error.message
    );

    Alert.alert('Error', 'Failed to submit vote');
  }
};
*/