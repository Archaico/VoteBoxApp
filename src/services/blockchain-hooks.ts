// src/hooks/useBlockchain.ts
import { useState, useCallback, useEffect } from 'react';
import { walletService } from '../services/WalletService';
import { feeEstimationService } from '../services/FeeEstimationService';
import { analyticsService } from '../services/AnalyticsService';
import { filterService } from '../services/FilterService';
import { blockchainService } from '../services/DandelionBlockchainService';
import { useNetInfo } from '@react-native-community/netinfo';

export const useBlockchain = () => {
  const netInfo = useNetInfo();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    initializeWallet();
  }, []);

  const initializeWallet = async () => {
    try {
      const address = await walletService.getConnectedWalletAddress();
      setWalletAddress(address);
    } catch (error) {
      console.error('Wallet initialization error:', error);
    }
  };

  const connectWallet = async (walletName: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const connected = await walletService.connectWallet(walletName);
      if (connected) {
        const address = await walletService.getConnectedWalletAddress();
        setWalletAddress(address);
        await analyticsService.trackWalletInteraction('connect', walletName, { success: true });
      } else {
        throw new Error('Failed to connect wallet');
      }
    } catch (error) {
      setError('Failed to connect wallet');
      await analyticsService.trackWalletInteraction('connect', walletName, { error: true });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const createProposal = async (proposalData: NewProposalData) => {
    try {
      setLoading(true);
      setError(null);

      if (!netInfo.isConnected) {
        throw new Error('No internet connection');
      }

      if (!walletAddress) {
        throw new Error('No wallet connected');
      }

      // Estimate fees first
      const feeEstimate = await feeEstimationService.estimateProposalFee(
        await walletService.getUtxos(),
        proposalData
      );

      // Track analytics
      await analyticsService.trackEvent('proposal_creation_started', {
        estimatedFee: feeEstimate.total,
      });

      // Create and submit proposal
      const txHash = await blockchainService.createProposal(proposalData);

      await analyticsService.trackTransaction({
        transactionId: txHash,
        type: 'proposal',
        status: 'submitted',
        timestamp: Date.now(),
        feeAmount: feeEstimate.total,
        walletType: walletAddress ? 'connected' : 'none',
      });

      return txHash;
    } catch (error) {
      setError('Failed to create proposal');
      await analyticsService.trackEvent('proposal_creation_failed', {
        error: error.message,
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const submitVote = async (voteData: VoteData) => {
    try {
      setLoading(true);
      setError(null);

      if (!netInfo.isConnected) {
        throw new Error('No internet connection');
      }

      if (!walletAddress) {
        throw new Error('No wallet connected');
      }

      // Estimate fees
      const feeEstimate = await feeEstimationService.estimateVoteFee(
        await walletService.getUtxos(),
        voteData
      );

      // Track analytics
      await analyticsService.trackEvent('vote_submission_started', {
        estimatedFee: feeEstimate.total,
      });

      // Submit vote
      const txHash = await blockchainService.submitVote(voteData);

      await analyticsService.trackTransaction({
        transactionId: txHash,
        type: 'vote',
        status: 'submitted',
        timestamp: Date.now(),
        feeAmount: feeEstimate.total,
        walletType: walletAddress ? 'connected' : 'none',
      });

      return txHash;
    } catch (error) {
      setError('Failed to submit vote');
      await analyticsService.trackEvent('vote_submission_failed', {
        error: error.message,
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    walletAddress,
    connectWallet,
    createProposal,
    submitVote,
  };
};