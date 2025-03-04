// src/services/VoteTallyService.ts
import { create } from 'ipfs-http-client';
import { blockchainService } from './BlockchainService';
import lodash from 'lodash';

interface VoteBatch {
  cid: string;
  votes: Vote[];
  merkleRoot: string;
  timestamp: number;
}

interface Vote {
  proposalId: string;
  choice: string;
  voterPubKey: string;
  timestamp: number;
  signature: string;
}

interface TallyResult {
  proposalId: string;
  results: Record<string, number>;
  totalVotes: number;
  ipfsRefs: string[];
  merkleRoot: string;
}

export class VoteTallyService {
  private ipfs;
  private readonly BATCH_REFS_KEY = 'proposal_batch_refs_';

  constructor() {
    this.initializeIPFS();
  }

  private async initializeIPFS() {
    this.ipfs = create({
      url: process.env.IPFS_GATEWAY_PRIMARY,
      headers: {
        authorization: `Basic ${Buffer.from(
          process.env.IPFS_PROJECT_ID + ':' + process.env.IPFS_PROJECT_SECRET
        ).toString('base64')}`,
      },
    });
  }

  async tallyVotes(proposalId: string): Promise<TallyResult> {
    try {
      // Get all batch references for this proposal
      const batchRefs = await this.getBatchRefs(proposalId);
      if (!batchRefs.length) {
        throw new Error('No vote batches found for proposal');
      }

      // Collect and verify all vote batches
      const voteBatches = await this.collectVoteBatches(batchRefs);
      const verifiedBatches = await this.verifyBatches(voteBatches);

      // Count votes and generate final results
      const results = this.countVotes(verifiedBatches);
      
      // Generate merkle root for final results
      const merkleRoot = this.generateMerkleRoot(results);

      // Create final result object
      const finalResult: TallyResult = {
        proposalId,
        results: results.counts,
        totalVotes: results.total,
        ipfsRefs: batchRefs,
        merkleRoot
      };

      // Submit final results to blockchain
      await this.submitFinalResults(finalResult);

      // Clean up IPFS data
      await this.cleanupIPFSData(batchRefs);

      return finalResult;
    } catch (error) {
      console.error('Error tallying votes:', error);
      throw error;
    }
  }

  private async getBatchRefs(proposalId: string): Promise<string[]> {
    try {
      const key = `${this.BATCH_REFS_KEY}${proposalId}`;
      const refs = await AsyncStorage.getItem(key);
      return refs ? JSON.parse(refs) : [];
    } catch (error) {
      console.error('Error getting batch refs:', error);
      return [];
    }
  }

  private async collectVoteBatches(batchRefs: string[]): Promise<VoteBatch[]> {
    try {
      const batches = await Promise.all(
        batchRefs.map(async (ref) => {
          const response = await this.ipfs.cat(ref);
          const content = await this.streamToString(response);
          return JSON.parse(content);
        })
      );
      return batches;
    } catch (error) {
      console.error('Error collecting vote batches:', error);
      throw error;
    }
  }

  private async verifyBatches(batches: VoteBatch[]): Promise<VoteBatch[]> {
    return batches.filter(batch => {
      try {
        // Verify merkle root matches votes
        const calculatedRoot = this.generateMerkleRoot(batch.votes);
        return calculatedRoot === batch.merkleRoot;
      } catch (error) {
        console.error('Error verifying batch:', error);
        return false;
      }
    });
  }

  private countVotes(batches: VoteBatch[]): { counts: Record<string, number>, total: number } {
    // Flatten all votes from all batches
    const allVotes = lodash.flatMap(batches, 'votes');

    // Group votes by choice and count
    const counts = lodash.countBy(allVotes, 'choice');
    const total = allVotes.length;

    return { counts, total };
  }

  private async submitFinalResults(results: TallyResult): Promise<void> {
    try {
      // Store final results in IPFS
      const resultsCid = await this.storeResultsInIPFS(results);

      // Submit to blockchain with minimal data
      await blockchainService.submitProposalResults({
        proposalId: results.proposalId,
        merkleRoot: results.merkleRoot,
        resultsCid,
        totalVotes: results.totalVotes
      });
    } catch (error) {
      console.error('Error submitting final results:', error);
      throw error;
    }
  }

  private async storeResultsInIPFS(results: TallyResult): Promise<string> {
    const resultFile = await this.ipfs.add(JSON.stringify(results));
    return resultFile.path;
  }

  private async cleanupIPFSData(ipfsRefs: string[]): Promise<void> {
    try {
      // Note: IPFS garbage collection will handle unused data
      // We just need to remove our references
      const key = `${this.BATCH_REFS_KEY}${ipfsRefs[0].split('_')[0]}`; // Extract proposalId
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Error cleaning up IPFS data:', error);
    }
  }

  private generateMerkleRoot(data: any): string {
    // Simplified merkle root generation for demonstration
    // In production, use a proper merkle tree library
    const str = JSON.stringify(data);
    return btoa(str); // Base64 encoding as placeholder
  }

  private async streamToString(stream: any): Promise<string> {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

export const voteTallyService = new VoteTallyService();