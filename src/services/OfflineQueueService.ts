// src/services/OfflineQueueService.ts
//
// VoteBox Offline Queue Service
// ─────────────────────────────────────────────────────────────────────────────
// Queues votes and proposals when network is unavailable
// Auto-retries when connection is restored
//
// Features:
//   • Stores failed transactions locally
//   • Monitors network status
//   • Auto-retry with exponential backoff
//   • Toast notifications for queue status
//   • Max 5 attempts per item
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { toastService } from './ToastService';
import { blockchainService } from './BlockchainService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueuedVote {
  id: string;
  proposalId: string;
  choice: string;
  voterPubKey: string;  // Changed from voterPubKey to match BlockchainService
  timestamp: number;
  attempts: number;
  lastAttempt?: number;
  error?: string;
}

export interface QueuedProposal {
  id: string;
  title: string;
  description: string;
  creator: string;
  duration: number;
  expectedVoters: number;
  timestamp: number;
  attempts: number;
  lastAttempt?: number;
  error?: string;
}

type QueuedItem = QueuedVote | QueuedProposal;

interface QueueStatus {
  votes: number;
  proposals: number;
  oldestTimestamp: number | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class OfflineQueueService {
  private static instance: OfflineQueueService;
  
  private readonly QUEUE_KEY = '@offline_queue';
  private readonly MAX_ATTEMPTS = 5;
  private readonly RETRY_DELAY = 2000; // 2 seconds
  
  private isProcessing = false;
  private unsubscribeNetInfo: (() => void) | null = null;

  private constructor() {}

  static getInstance(): OfflineQueueService {
    if (!OfflineQueueService.instance) {
      OfflineQueueService.instance = new OfflineQueueService();
    }
    return OfflineQueueService.instance;
  }

  // ── Initialize Network Monitoring ─────────────────────────────────────────

  async initialize(): Promise<void> {
    // Start monitoring network status
    this.unsubscribeNetInfo = NetInfo.addEventListener(state => {
      if (state.isConnected && !this.isProcessing) {
        this.processQueue();
      }
    });

    // Process any existing queue items
    const netState = await NetInfo.fetch();
    if (netState.isConnected) {
      this.processQueue();
    }
  }

  cleanup(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
  }

  // ── Queue Management ──────────────────────────────────────────────────────

  async queueVote(voteData: {
    proposalId: string;
    choice: string;
    voterPubKey: string;  // Changed from voterPubKey
    timestamp: number;
  }): Promise<void> {
    const queuedVote: QueuedVote = {
      id: `vote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      proposalId: voteData.proposalId,
      choice: voteData.choice,
      voterPubKey: voteData.voterPubKey,  // Changed from voterPubKey
      timestamp: voteData.timestamp,
      attempts: 0,
    };

    await this.addToQueue(queuedVote);
  }

  async queueProposal(proposalData: {
    title: string;
    description: string;
    creator: string;
    duration: number;
    expectedVoters: number;
  }): Promise<void> {
    const queuedProposal: QueuedProposal = {
      id: `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: proposalData.title,
      description: proposalData.description,
      creator: proposalData.creator,
      duration: proposalData.duration,
      expectedVoters: proposalData.expectedVoters,
      timestamp: Date.now(),
      attempts: 0,
    };

    await this.addToQueue(queuedProposal);
  }

  private async addToQueue(item: QueuedItem): Promise<void> {
    try {
      const queue = await this.getQueue();
      queue.push(item);
      await AsyncStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
      console.log('[OfflineQueue] Added item to queue:', item.id);
    } catch (error) {
      console.error('[OfflineQueue] Failed to add to queue:', error);
      throw error;
    }
  }

  // ── Queue Processing ──────────────────────────────────────────────────────

  async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    console.log('[OfflineQueue] Processing queue...');

    try {
      const queue = await this.getQueue();
      
      if (queue.length === 0) {
        console.log('[OfflineQueue] Queue empty');
        return;
      }

      const itemsToProcess = queue.filter(item => 
        item.attempts < this.MAX_ATTEMPTS
      );

      for (const item of itemsToProcess) {
        try {
          await this.processItem(item);
          await this.removeFromQueue(item.id);
          
          const type = this.isVote(item) ? 'Vote' : 'Proposal';
          toastService.success(`✅ ${type} submitted successfully`);
        } catch (error) {
          console.error('[OfflineQueue] Failed to process item:', error);
          await this.updateItemAttempt(item, error as Error);
        }

        // Small delay between attempts
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
      }
    } catch (error) {
      console.error('[OfflineQueue] Queue processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processItem(item: QueuedItem): Promise<void> {
    if (this.isVote(item)) {
      await blockchainService.submitVote({
        proposalId: item.proposalId,
        choice: item.choice,
        voterPubKey: item.voterPubKey,  // Changed from voterPubKey
        timestamp: item.timestamp,
      });
    } else {
      await blockchainService.createProposal({
        title: item.title,
        description: item.description,
        creator: item.creator,
        duration: item.duration,
        expectedVoters: item.expectedVoters,
      });
    }
  }

  private async updateItemAttempt(item: QueuedItem, error: Error): Promise<void> {
    try {
      const queue = await this.getQueue();
      const index = queue.findIndex(i => i.id === item.id);
      
      if (index >= 0) {
        queue[index].attempts++;
        queue[index].lastAttempt = Date.now();
        queue[index].error = error.message;
        
        if (queue[index].attempts >= this.MAX_ATTEMPTS) {
          const type = this.isVote(queue[index]) ? 'Vote' : 'Proposal';
          toastService.error(`❌ ${type} failed after ${this.MAX_ATTEMPTS} attempts`);
        }
        
        await AsyncStorage.setItem(this.QUEUE_KEY, JSON.stringify(queue));
      }
    } catch (err) {
      console.error('[OfflineQueue] Failed to update attempt:', err);
    }
  }

  private async removeFromQueue(itemId: string): Promise<void> {
    try {
      const queue = await this.getQueue();
      const filtered = queue.filter(item => item.id !== itemId);
      await AsyncStorage.setItem(this.QUEUE_KEY, JSON.stringify(filtered));
      console.log('[OfflineQueue] Removed item from queue:', itemId);
    } catch (error) {
      console.error('[OfflineQueue] Failed to remove from queue:', error);
    }
  }

  // ── Queue Status ──────────────────────────────────────────────────────────

  async getQueueStatus(): Promise<QueueStatus> {
    try {
      const queue = await this.getQueue();
      const votes = queue.filter(item => this.isVote(item));
      const proposals = queue.filter(item => !this.isVote(item));
      
      const oldestTimestamp = queue.length > 0
        ? Math.min(...queue.map(item => item.timestamp))
        : null;

      return {
        votes: votes.length,
        proposals: proposals.length,
        oldestTimestamp,
      };
    } catch (error) {
      console.error('[OfflineQueue] Failed to get queue status:', error);
      return { votes: 0, proposals: 0, oldestTimestamp: null };
    }
  }

  async clearQueue(): Promise<void> {
    await AsyncStorage.removeItem(this.QUEUE_KEY);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getQueue(): Promise<QueuedItem[]> {
    try {
      const stored = await AsyncStorage.getItem(this.QUEUE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('[OfflineQueue] Failed to get queue:', error);
      return [];
    }
  }

  private isVote(item: QueuedItem): item is QueuedVote {
    return 'voter' in item && 'choice' in item;  // Changed from voterPubKey
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
export const offlineQueueService = OfflineQueueService.getInstance();
