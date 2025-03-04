// src/services/VoteAggregatorService.ts
import { create } from 'ipfs-http-client';
import { ethers } from 'ethers';
import { blockchainService } from './BlockchainService';

interface VoteData {
  proposalId: string;
  choice: string;
  voterPubKey: string;
  signature: string;
  timestamp: number;
}

interface BatchedVotes {
  proposalId: string;
  votes: VoteData[];
  merkleRoot: string;
}

export class VoteAggregatorService {
  private ipfs;
  private voteCache: Map<string, VoteData[]>;
  private readonly BATCH_SIZE = 100; // Adjust based on network conditions

  constructor() {
    this.voteCache = new Map();
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

  async addVote(vote: VoteData): Promise<string> {
    // Verify vote signature
    if (!this.verifyVoteSignature(vote)) {
      throw new Error('Invalid vote signature');
    }

    // Store vote in IPFS
    const cid = await this.storeVoteInIPFS(vote);
    
    // Cache vote for batching
    this.cacheVote(vote);

    // Check if we should submit a batch
    await this.checkAndSubmitBatch(vote.proposalId);

    return cid;
  }

  private async storeVoteInIPFS(vote: VoteData): Promise<string> {
    const encryptedVote = await this.encryptVote(vote);
    const result = await this.ipfs.add(JSON.stringify(encryptedVote));
    return result.path;
  }

  private async encryptVote(vote: VoteData): Promise<string> {
    // Implement encryption logic here
    // This is a placeholder - actual implementation would use proper encryption
    return JSON.stringify(vote);
  }

  private cacheVote(vote: VoteData) {
    const votes = this.voteCache.get(vote.proposalId) || [];
    votes.push(vote);
    this.voteCache.set(vote.proposalId, votes);
  }

  private async checkAndSubmitBatch(proposalId: string) {
    const votes = this.voteCache.get(proposalId) || [];
    if (votes.length >= this.BATCH_SIZE) {
      await this.submitBatch(proposalId);
    }
  }

  private async submitBatch(proposalId: string) {
    const votes = this.voteCache.get(proposalId) || [];
    if (votes.length === 0) return;

    // Create merkle tree from votes
    const merkleRoot = this.createMerkleRoot(votes);

    // Prepare batched votes
    const batchedVotes: BatchedVotes = {
      proposalId,
      votes,
      merkleRoot,
    };

    // Store batch in IPFS
    const batchCid = await this.ipfs.add(JSON.stringify(batchedVotes));

    // Submit merkle root to blockchain
    await blockchainService.submitVoteBatch({
      proposalId,
      merkleRoot,
      batchCid: batchCid.path,
      voteCount: votes.length,
    });

    // Clear processed votes from cache
    this.voteCache.set(proposalId, []);
  }

  private createMerkleRoot(votes: VoteData[]): string {
    // Create merkle tree from votes and return root
    // This is a placeholder - implement actual merkle tree logic
    const leaves = votes.map(vote => ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'string', 'string', 'uint256'],
        [vote.proposalId, vote.choice, vote.voterPubKey, vote.timestamp]
      )
    ));
    
    // Simple merkle root calculation for demonstration
    // In production, use a proper merkle tree library
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [leaves])
    );
  }

  private verifyVoteSignature(vote: VoteData): boolean {
    return verifyVoteSignature(vote, vote.signature);
  }

  async finalizeProposal(proposalId: string): Promise<void> {
    // Submit any remaining votes
    await this.submitBatch(proposalId);

    // Fetch all batches from IPFS and compute final results
    const finalResults = await this.computeFinalResults(proposalId);

    // Submit final results to blockchain
    await blockchainService.submitProposalResults(proposalId, finalResults);
  }

  private async computeFinalResults(proposalId: string): Promise<Record<string, number>> {
    // Implement results computation from all IPFS batches
    // This is a placeholder - implement actual results computation
    return {};
  }
}

export const voteAggregatorService = new VoteAggregatorService();