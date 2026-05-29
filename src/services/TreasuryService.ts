// src/services/TreasuryService.ts
//
// VoteBox Treasury Service
// ─────────────────────────────────────────────────────────────────────────────
// Manages all financial flows through the VoteBox platform:
//
//   Proposal Creator (ADA)
//        │
//        ▼
//   [TreasuryService] ── routes fees ──▶ Foundation Wallet (multi-sig)
//        │                                      │
//        │                              ┌───────┴────────┐
//        │                          Gas Pool         FounderFee (7%)
//        │                        (operations)     (perpetual, immutable)
//        ▼
//   Blockchain Transaction
//
// Architecture principles:
//   • Founder fee is encoded HERE, not in governance — cannot be voted away
//   • Multi-sig ready: foundation wallet requires N-of-M signers (future)
//   • All flows recorded to AsyncStorage for auditability
//   • Blockfrost API used for real Cardano testnet/mainnet transactions
//   • Designed to hand off to DAO treasury governance in 1–3 years
//
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Treasury Configuration ───────────────────────────────────────────────────
// These are the permanent protocol-level fee parameters.
// FOUNDER_FEE_PERCENTAGE is immutable by design — it is a founding condition
// of the protocol, not a governance parameter.

export const TREASURY_CONFIG = {
  // Fee split percentages (must sum to 100)
  FOUNDATION_FEE_PERCENTAGE: 0.25,    // 25% of gas costs → Foundation wallet
  FOUNDER_FEE_PERCENTAGE: 0.07,       // 7% of Foundation Fee → Founder (perpetual, immutable)
  
  // Wallet addresses — replace with real addresses before mainnet
  // Foundation wallet will become a multi-sig address (3-of-5 initially)
  FOUNDATION_WALLET: 'addr_test1vrdzjlmvrckuxln6ux8spst2e4qmlckrzncvqtnmvy3t54ganc74z',
  FOUNDER_WALLET:    'addr1qyl3j2sk6swz9t9922cl5tugckp6wfk952smz8zx5gy2quqcdkvqlrxkg9fjlp0qavtjchhmy7p4k0xhxhhrmd6afl7q03d0qv',
  
  // Cardano protocol parameters (testnet)
  MIN_FEE_A: 44,         // lovelace per byte
  MIN_FEE_B: 155381,     // base fee in lovelace
  ADA_TO_USD_RATE: 0.35, // updated manually until live price feed integrated
  
  // Blockfrost API — use environment variable in production
  // Replace with your real Blockfrost project ID
  BLOCKFROST_API_URL: 'https://cardano-preprod.blockfrost.io/api/v0',
  BLOCKFROST_PROJECT_ID: process.env.EXPO_PUBLIC_BLOCKFROST_PROJECT_ID ?? '',
  
  // Treasury storage keys
  STORAGE_KEYS: {
    TRANSACTION_LOG:   '@treasury_transaction_log',
    PENDING_FEES:      '@treasury_pending_fees',
    TOTAL_COLLECTED:   '@treasury_total_collected',
    FOUNDER_EARNED:    '@treasury_founder_earned',
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeeCalculation {
  gasCost: number;           // Raw Cardano transaction cost (lovelace)
  foundationFee: number;     // 25% of gas cost (lovelace)
  founderShare: number;      // 7% of foundation fee — routes to founder wallet (immutable, FOUNDER_FEE_PERCENTAGE constant)
  operationsShare: number;   // 93% of foundation fee — routes to foundation wallet
  grandTotal: number;        // Total charged to proposal creator (lovelace)
  
  // Human-readable
  gasCostADA: string;
  foundationFeeADA: string;
  founderShareADA: string;
  grandTotalADA: string;
  grandTotalUSD: string;
}

export interface TreasuryTransaction {
  id: string;
  type: 'proposal_fee' | 'founder_distribution' | 'operations' | 'gas_refund';
  proposalId?: string;
  creatorAddress: string;
  amount: number;          // lovelace
  founderAmount: number;   // lovelace
  foundationAmount: number; // lovelace
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  blockfrostTxHash?: string;
  notes?: string;
}

export interface TreasurySummary {
  totalCollected: number;      // lovelace — all time
  founderEarned: number;       // lovelace — founder's cumulative share
  foundationHeld: number;      // lovelace — foundation wallet balance
  transactionCount: number;
  lastUpdated: number;
}

// ─── Treasury Service ─────────────────────────────────────────────────────────

class TreasuryService {
  private static instance: TreasuryService;
  
  private constructor() {}

  static getInstance(): TreasuryService {
    if (!TreasuryService.instance) {
      TreasuryService.instance = new TreasuryService();
    }
    return TreasuryService.instance;
  }

  // ── Fee Calculation ─────────────────────────────────────────────────────────
  // Pure calculation — no side effects. Call this to show users costs upfront.

  calculateProposalFees(expectedVoters: number): FeeCalculation {
    const { MIN_FEE_A, MIN_FEE_B, FOUNDATION_FEE_PERCENTAGE, FOUNDER_FEE_PERCENTAGE, ADA_TO_USD_RATE } = TREASURY_CONFIG;

    // Cardano transaction costs
    const proposalMetadataSize = 500; // bytes
    const creationFee = MIN_FEE_B + (proposalMetadataSize * MIN_FEE_A);

    const batchCount = Math.ceil(expectedVoters / 100);
    const batchMetadataSize = 300;
    const totalVotingCost = batchCount * (MIN_FEE_B + (batchMetadataSize * MIN_FEE_A));

    const gasCost = creationFee + totalVotingCost;

    // Foundation fee (25% of gas — sustains the platform)
    const foundationFee = Math.floor(gasCost * FOUNDATION_FEE_PERCENTAGE);

    // Founder share (5% of foundation fee — perpetual, protocol-encoded)
    const founderShare = Math.floor(foundationFee * FOUNDER_FEE_PERCENTAGE);
    const operationsShare = foundationFee - founderShare;

    const grandTotal = gasCost + foundationFee;

    const toADA = (lovelace: number) => (lovelace / 1_000_000).toFixed(4);

    return {
      gasCost,
      foundationFee,
      founderShare,
      operationsShare,
      grandTotal,
      gasCostADA:        toADA(gasCost),
      foundationFeeADA:  toADA(foundationFee),
      founderShareADA:   toADA(founderShare),
      grandTotalADA:     toADA(grandTotal),
      grandTotalUSD:     (parseFloat(toADA(grandTotal)) * ADA_TO_USD_RATE).toFixed(2),
    };
  }

  // ── Fee Collection ──────────────────────────────────────────────────────────
  // Called when a proposal is successfully created.
  // Records the transaction and triggers fee distribution.

  async recordProposalFeeCollection(
    proposalId: string,
    creatorAddress: string,
    expectedVoters: number,
    blockfrostTxHash?: string
  ): Promise<TreasuryTransaction> {
    const fees = this.calculateProposalFees(expectedVoters);

    const transaction: TreasuryTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'proposal_fee',
      proposalId,
      creatorAddress,
      amount: fees.grandTotal,
      founderAmount: fees.founderShare,
      foundationAmount: fees.operationsShare,
      timestamp: Date.now(),
      status: blockfrostTxHash ? 'confirmed' : 'pending',
      blockfrostTxHash,
      notes: `Proposal: ${proposalId} | Voters: ${expectedVoters}`,
    };

    await this.logTransaction(transaction);
    await this.updateTotals(fees.grandTotal, fees.founderShare);

    console.log('[Treasury] Fee collected:', {
      proposalId,
      totalADA: fees.grandTotalADA,
      founderShareADA: fees.founderShareADA,
      foundationADA: (fees.operationsShare / 1_000_000).toFixed(4),
    });

    return transaction;
  }

  // ── Blockfrost Integration ──────────────────────────────────────────────────
  // Verify a transaction exists on-chain via Blockfrost.
  // Used to confirm a creator's payment before publishing their proposal.

  async verifyTransactionOnChain(txHash: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${TREASURY_CONFIG.BLOCKFROST_API_URL}/txs/${txHash}`,
        {
          headers: {
            'project_id': TREASURY_CONFIG.BLOCKFROST_PROJECT_ID,
          },
        }
      );

      if (!response.ok) return false;

      const tx = await response.json();
      return tx.block != null; // confirmed if it has a block

    } catch (error) {
      console.error('[Treasury] Blockfrost verification failed:', error);
      return false;
    }
  }

  // Check foundation wallet balance via Blockfrost
  async getFoundationBalance(): Promise<{ lovelace: number; ada: string }> {
    try {
      const response = await fetch(
        `${TREASURY_CONFIG.BLOCKFROST_API_URL}/addresses/${TREASURY_CONFIG.FOUNDATION_WALLET}`,
        {
          headers: {
            'project_id': TREASURY_CONFIG.BLOCKFROST_PROJECT_ID,
          },
        }
      );

      if (!response.ok) throw new Error('Blockfrost address lookup failed');

      const data = await response.json();
      const lovelace = parseInt(data.amount?.find((a: any) => a.unit === 'lovelace')?.quantity || '0');
      
      return {
        lovelace,
        ada: (lovelace / 1_000_000).toFixed(4),
      };
    } catch (error) {
      console.error('[Treasury] Balance check failed:', error);
      return { lovelace: 0, ada: '0.0000' };
    }
  }

  // ── Audit & Reporting ───────────────────────────────────────────────────────

  async getTreasurySummary(): Promise<TreasurySummary> {
    try {
      const [totalStr, founderStr, logStr] = await Promise.all([
        AsyncStorage.getItem(TREASURY_CONFIG.STORAGE_KEYS.TOTAL_COLLECTED),
        AsyncStorage.getItem(TREASURY_CONFIG.STORAGE_KEYS.FOUNDER_EARNED),
        AsyncStorage.getItem(TREASURY_CONFIG.STORAGE_KEYS.TRANSACTION_LOG),
      ]);

      const totalCollected = parseInt(totalStr || '0');
      const founderEarned  = parseInt(founderStr || '0');
      const log: TreasuryTransaction[] = logStr ? JSON.parse(logStr) : [];

      return {
        totalCollected,
        founderEarned,
        foundationHeld: totalCollected - founderEarned,
        transactionCount: log.length,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.error('[Treasury] Summary fetch failed:', error);
      return {
        totalCollected: 0,
        founderEarned: 0,
        foundationHeld: 0,
        transactionCount: 0,
        lastUpdated: Date.now(),
      };
    }
  }

  async getTransactionLog(): Promise<TreasuryTransaction[]> {
    try {
      const logStr = await AsyncStorage.getItem(TREASURY_CONFIG.STORAGE_KEYS.TRANSACTION_LOG);
      return logStr ? JSON.parse(logStr) : [];
    } catch {
      return [];
    }
  }

  // ── Multi-Sig Readiness ─────────────────────────────────────────────────────
  // Placeholder for when the foundation wallet becomes a multi-sig.
  // This will expand to require N-of-M signatures for any outbound transaction.
  // At DAO transition: replace with on-chain governance voting.

  async checkMultiSigReadiness(): Promise<{
    isMultiSig: boolean;
    requiredSigners: number;
    totalSigners: number;
    note: string;
  }> {
    // Phase 1 (now): single founder key
    // Phase 2 (6–12 months): 2-of-3 multisig (founder + 2 trusted advisors)
    // Phase 3 (DAO transition): 5-of-9 multisig via DAO governance
    return {
      isMultiSig: false,
      requiredSigners: 1,
      totalSigners: 1,
      note: 'Phase 1: Founder-controlled. Multi-sig upgrade planned at €10k MRR milestone.',
    };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  private async logTransaction(tx: TreasuryTransaction): Promise<void> {
    try {
      const existing = await this.getTransactionLog();
      existing.push(tx);
      // Keep last 1000 transactions on device; full history lives on IPFS
      const trimmed = existing.slice(-1000);
      await AsyncStorage.setItem(
        TREASURY_CONFIG.STORAGE_KEYS.TRANSACTION_LOG,
        JSON.stringify(trimmed)
      );
    } catch (error) {
      console.error('[Treasury] Failed to log transaction:', error);
    }
  }

  private async updateTotals(totalAmount: number, founderAmount: number): Promise<void> {
    try {
      const [totalStr, founderStr] = await Promise.all([
        AsyncStorage.getItem(TREASURY_CONFIG.STORAGE_KEYS.TOTAL_COLLECTED),
        AsyncStorage.getItem(TREASURY_CONFIG.STORAGE_KEYS.FOUNDER_EARNED),
      ]);

      const newTotal   = (parseInt(totalStr   || '0')) + totalAmount;
      const newFounder = (parseInt(founderStr  || '0')) + founderAmount;

      await Promise.all([
        AsyncStorage.setItem(TREASURY_CONFIG.STORAGE_KEYS.TOTAL_COLLECTED, String(newTotal)),
        AsyncStorage.setItem(TREASURY_CONFIG.STORAGE_KEYS.FOUNDER_EARNED,  String(newFounder)),
      ]);
    } catch (error) {
      console.error('[Treasury] Failed to update totals:', error);
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
export const treasuryService = TreasuryService.getInstance();
