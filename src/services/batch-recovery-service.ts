// src/services/BatchRecoveryService.ts
import { create } from 'ipfs-http-client';
import lodash from 'lodash';

interface BatchMetadata {
  batchId: string;
  proposalId: string;
  voteCount: number;
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  ipfsHash?: string;
  errorDetails?: string;
}

interface RecoveryStats {
  totalRecovered: number;
  failedRecoveries: number;
  pendingRecoveries: number;
}

export class BatchRecoveryService {
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY = 5000; // 5 seconds
  private readonly BATCH_RECOVERY_KEY = 'batch_recovery_';
  private readonly IPFS_BACKUP_NODES = [
    'https://ipfs-backup-1.example.com',
    'https://ipfs-backup-2.example.com'
  ];

  private ipfs;
  private recoveryQueue: Map<string, BatchMetadata>;
  private isProcessing: boolean;

  constructor() {
    this.recoveryQueue = new Map();
    this.isProcessing = false;
    this.initializeIPFS();
  }

  private async initializeIPFS() {
    this.ipfs = create({
      url: process.env.IPFS_GATEWAY_PRIMARY,
      timeout: 10000,
    });
  }

  async registerFailedBatch(batch: BatchMetadata): Promise<void> {
    try {
      // Store batch metadata
      const key = `${this.BATCH_RECOVERY_KEY}${batch.batchId}`;
      await AsyncStorage.setItem(key, JSON.stringify({
        ...batch,
        retryCount: 0,
        status: 'pending'
      }));

      this.recoveryQueue.set(batch.batchId, batch);

      // Start recovery process if not already running
      if (!this.isProcessing) {
        this.processRecoveryQueue();
      }
    } catch (error) {
      console.error('Error registering failed batch:', error);
      throw error;
    }
  }

  private async processRecoveryQueue(): Promise<void> {
    if (this.isProcessing || this.recoveryQueue.size === 0) return;

    try {
      this.isProcessing = true;

      // Process batches in order of timestamp
      const sortedBatches = Array.from(this.recoveryQueue.values())
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const batch of sortedBatches) {
        if (batch.retryCount >= this.MAX_RETRY_ATTEMPTS) {
          await this.handleMaxRetriesExceeded(batch);
          continue;
        }

        try {
          await this.recoverBatch(batch);
          this.recoveryQueue.delete(batch.batchId);
          await this.cleanupBatchMetadata(batch.batchId);
        } catch (error) {
          console.error(`Error recovering batch ${batch.batchId}:`, error);
          batch.retryCount++;
          batch.errorDetails = error.message;
          await this.updateBatchMetadata(batch);

          // Add delay before next retry
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
        }
      }
    } finally {
      this.isProcessing = false;

      // Check if new batches were added during processing
      if (this.recoveryQueue.size > 0) {
        this.processRecoveryQueue();
      }
    }
  }

  private async recoverBatch(batch: BatchMetadata): Promise<void> {
    // Try primary IPFS node first
    try {
      await this.recoverFromIPFS(batch);
      return;
    } catch (error) {
      console.error('Primary IPFS recovery failed:', error);
    }

    // Try backup nodes
    for (const backupNode of this.IPFS_BACKUP_NODES) {
      try {
        const backupIpfs = create({ url: backupNode });
        await this.recoverFromIPFS(batch, backupIpfs);
        return;
      } catch (error) {
        console.error(`Backup node ${backupNode} recovery failed:`, error);
      }
    }

    throw new Error('All recovery attempts failed');
  }

  private async recoverFromIPFS(batch: BatchMetadata, ipfsClient = this.ipfs): Promise<void> {
    if (!batch.ipfsHash) {
      throw new Error('No IPFS hash available for recovery');
    }

    const content = await ipfsClient.cat(batch.ipfsHash);
    const voteData = JSON.parse(await this.streamToString(content));

    // Verify vote data integrity
    if (!this.verifyVoteData(voteData, batch)) {
      throw new Error('Vote data integrity check failed');
    }

    // Resubmit to blockchain
    await this.resubmitBatch(voteData, batch);
  }

  private async streamToString(stream: any): Promise<string> {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private verifyVoteData(voteData: any, batch: BatchMetadata): boolean {
    // Implement vote data verification logic
    return true;
  }

  private async resubmitBatch(voteData: any, batch: BatchMetadata): Promise<void> {
    // Implement batch resubmission logic
  }

  private async handleMaxRetriesExceeded(batch: BatchMetadata): Promise<void> {
    // Implement critical failure handling
    // This might involve manual intervention or emergency procedures
  }

  private async updateBatchMetadata(batch: BatchMetadata): Promise<void> {
    const key = `${this.BATCH_RECOVERY_KEY}${batch.batchId}`;
    await AsyncStorage.setItem(key, JSON.stringify(batch));
  }

  private async cleanupBatchMetadata(batchId: string): Promise<void> {
    const key = `${this.BATCH_RECOVERY_KEY}${batchId}`;
    await AsyncStorage.removeItem(key);
  }

  async getRecoveryStats(): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      totalRecovered: 0,
      failedRecoveries: 0,
      pendingRecoveries: this.recoveryQueue.size
    };

    return stats;
  }
}

export const batchRecoveryService = new BatchRecoveryService();