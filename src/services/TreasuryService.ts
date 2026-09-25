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
//        │                          Gas Pool         FounderFee (13%)
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
  FOUNDATION_FEE_PERCENTAGE: 0.30,    // 30% of gas costs → Foundation wallet
  FOUNDER_FEE_PERCENTAGE: 0.13,       // 13% of Foundation Fee → Founder (perpetual, immutable)

  // Cardano's ~1 ADA minimum-UTxO rule means a proposal fee below this floor
  // could produce an output the network would reject. Also matches VoteBoxApp's
  // stated design principle ("proposal creation costs 1.2+ ADA").
  MIN_PROPOSAL_FEE_LOVELACE: 1_200_000,

  // A single proposal's founder share is far too small to pay out on its own
  // (below min-UTxO) — earnings accumulate until this threshold, then batch-pay.
  FOUNDER_PAYOUT_THRESHOLD_LOVELACE: 2_000_000,

  // Wallet addresses — replace with real addresses before mainnet
  // Foundation wallet will become a multi-sig address (3-of-5 initially)
  FOUNDATION_WALLET: 'addr_test1vqfrwehprdjvxrv3kmnz7axek2jkg4sjcl5fxtwecevh74ge4rmhd',
  FOUNDER_WALLET:    'addr_test1qz8zqndgltd6v6ke2yyx4m2slfv6y8uzla5n2vszgl2n3xflp87cuc8wy3r59x3zdgw76japc2fuz7ulhmag4cs57tds8lzen3',

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
    PAYOUT_LOCK:       '@treasury_payout_lock',
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeeCalculation {
  gasCost: number;           // Raw Cardano transaction cost (lovelace)
  foundationFee: number;     // Foundation's cut (lovelace) — absorbs the floor top-up, if any
  founderShare: number;      // 13% of foundation fee — routes to founder wallet (immutable, FOUNDER_FEE_PERCENTAGE constant)
  operationsShare: number;   // 87% of foundation fee — routes to foundation wallet
  grandTotal: number;        // Total charged to proposal creator (lovelace)
  isMinimumApplied: boolean; // true if MIN_PROPOSAL_FEE_LOVELACE floor was needed

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
  /** @deprecated pre-verified-payment field; kept only so previously-stored records still parse */
  blockfrostTxHash?: string;
  paymentTxHash?: string;      // the creator's own verified payment tx (proposal_fee entries)
  metadataTxHash?: string;     // the Foundation's proposal/vote/payout-anchoring tx
  paidLovelace?: number;       // actual verified amount paid (may exceed `amount` on overpayment)
  payoutBatchTxHash?: string;  // set once this entry's founderAmount has settled in a batch payout
  notes?: string;
}

export interface TreasurySummary {
  totalCollected: number;      // lovelace — all time
  founderEarned: number;       // lovelace — founder's cumulative share
  foundationHeld: number;      // lovelace — foundation wallet balance
  transactionCount: number;
  lastUpdated: number;
}

export interface PaymentVerificationResult {
  ok: boolean;
  paidLovelace?: number;
  reason?:
    | 'malformed_hash'
    | 'not_found_or_pending'
    | 'wrong_recipient'
    | 'insufficient_amount'
    | 'already_used'
    | 'network_error';
  detail?: string;
}

export interface PendingFounderPayout {
  lovelace: number;
  transactionIds: string[];
  proposalAmounts: Array<{ proposalId: string; founderAmountLovelace: number }>;
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
  // Pure calculation — no side effects. Call this to show users costs upfront,
  // AND to determine the exact amount payment verification checks against.
  // Never duplicate this math elsewhere (see CreateProposalScreen.tsx history).

  calculateProposalFees(expectedVoters: number): FeeCalculation {
    const { MIN_FEE_A, MIN_FEE_B, FOUNDATION_FEE_PERCENTAGE, FOUNDER_FEE_PERCENTAGE, MIN_PROPOSAL_FEE_LOVELACE, ADA_TO_USD_RATE } = TREASURY_CONFIG;

    // Cardano transaction costs
    const proposalMetadataSize = 500; // bytes
    const creationFee = MIN_FEE_B + (proposalMetadataSize * MIN_FEE_A);

    const batchCount = Math.ceil(expectedVoters / 100);
    const batchMetadataSize = 300;
    const totalVotingCost = batchCount * (MIN_FEE_B + (batchMetadataSize * MIN_FEE_A));

    const gasCost = creationFee + totalVotingCost;

    // Foundation fee (30% of gas — sustains the platform)
    let foundationFee = Math.floor(gasCost * FOUNDATION_FEE_PERCENTAGE);
    let grandTotal = gasCost + foundationFee;
    let isMinimumApplied = false;

    // Enforce the platform minimum by topping up the foundation fee — gasCost
    // stays an honest network-cost estimate, and grandTotal = gasCost +
    // foundationFee remains true. gasCost alone is always well under the
    // floor at realistic voter counts, so this top-up is always non-negative.
    if (grandTotal < MIN_PROPOSAL_FEE_LOVELACE) {
      foundationFee = MIN_PROPOSAL_FEE_LOVELACE - gasCost;
      grandTotal = MIN_PROPOSAL_FEE_LOVELACE;
      isMinimumApplied = true;
    }

    // Founder share (13% of foundation fee — perpetual, protocol-encoded)
    const founderShare = Math.floor(foundationFee * FOUNDER_FEE_PERCENTAGE);
    const operationsShare = foundationFee - founderShare;

    const toADA = (lovelace: number) => (lovelace / 1_000_000).toFixed(4);

    return {
      gasCost,
      foundationFee,
      founderShare,
      operationsShare,
      grandTotal,
      isMinimumApplied,
      gasCostADA:        toADA(gasCost),
      foundationFeeADA:  toADA(foundationFee),
      founderShareADA:   toADA(founderShare),
      grandTotalADA:     toADA(grandTotal),
      grandTotalUSD:     (parseFloat(toADA(grandTotal)) * ADA_TO_USD_RATE).toFixed(2),
    };
  }

  // ── Fee Collection ──────────────────────────────────────────────────────────
  // Called after a creator's payment has been verified on-chain (see
  // verifyPaymentTransaction) and the proposal's own metadata tx has submitted.

  async recordProposalFeeCollection(
    proposalId: string,
    creatorAddress: string,
    expectedVoters: number,
    paymentTxHash: string,
    paidLovelace: number,
    metadataTxHash: string,
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
      status: 'confirmed', // verification already gates this call — always confirmed by construction
      paymentTxHash,
      metadataTxHash,
      paidLovelace,
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

  // ── Payment Verification ────────────────────────────────────────────────────
  // Verifies a creator's pasted transaction hash actually pays the Foundation
  // wallet at least the required amount, and hasn't been used before. This is
  // the gate proposal publishing sits behind — see CreateProposalScreen.tsx.

  async verifyPaymentTransaction(rawTxHash: string, requiredLovelace: number): Promise<PaymentVerificationResult> {
    // 1. Normalize + format-validate (no network call). Tolerate a pasted
    //    cardanoscan URL rather than requiring the bare hash.
    let txHash = rawTxHash.trim().toLowerCase();
    const urlMatch = txHash.match(/\/transaction\/([0-9a-f]{64})/i);
    if (urlMatch) txHash = urlMatch[1];
    txHash = txHash.split('?')[0];

    if (!/^[0-9a-f]{64}$/.test(txHash)) {
      return { ok: false, reason: 'malformed_hash', detail: 'Expected a 64-character transaction hash' };
    }

    // 2. Local replay check — fast, catches same-device reuse before any network call.
    const log = await this.getTransactionLog();
    if (log.some(t => t.type === 'proposal_fee' && t.paymentTxHash === txHash)) {
      return { ok: false, reason: 'already_used' };
    }

    try {
      // 3. Existence/confirmation. Blockfrost only indexes confirmed txs, so a
      //    404 covers both "invalid hash" and "not yet confirmed" — can't
      //    reliably distinguish via this endpoint alone.
      const txResponse = await fetch(
        `${TREASURY_CONFIG.BLOCKFROST_API_URL}/txs/${txHash}`,
        { headers: { 'project_id': TREASURY_CONFIG.BLOCKFROST_PROJECT_ID } }
      );
      if (txResponse.status === 404) {
        return { ok: false, reason: 'not_found_or_pending' };
      }
      if (!txResponse.ok) {
        return { ok: false, reason: 'network_error', detail: `Blockfrost /txs → ${txResponse.status}` };
      }

      // 4. Recipient + amount — sum lovelace across ALL outputs paying the
      //    Foundation wallet (a tx could legitimately have multiple such outputs).
      const utxosResponse = await fetch(
        `${TREASURY_CONFIG.BLOCKFROST_API_URL}/txs/${txHash}/utxos`,
        { headers: { 'project_id': TREASURY_CONFIG.BLOCKFROST_PROJECT_ID } }
      );
      if (!utxosResponse.ok) {
        return { ok: false, reason: 'network_error', detail: `Blockfrost /utxos → ${utxosResponse.status}` };
      }
      const utxos = await utxosResponse.json();
      const paidLovelace: number = (utxos.outputs ?? [])
        .filter((o: any) => o.address === TREASURY_CONFIG.FOUNDATION_WALLET)
        .reduce((sum: number, o: any) =>
          sum + parseInt(o.amount.find((a: any) => a.unit === 'lovelace')?.quantity ?? '0'), 0);

      if (paidLovelace === 0) {
        return { ok: false, reason: 'wrong_recipient' };
      }
      if (paidLovelace < requiredLovelace) {
        return { ok: false, reason: 'insufficient_amount', paidLovelace };
      }

      // 5. Global (cross-device) replay check — best-effort scan of the most
      //    recent 100 published proposals' own metadata (label 674, which now
      //    carries the creator's paymentTxHash — see BlockchainService.ts).
      //    Not a full history scan; no backend exists to do better.
      try {
        const labelResponse = await fetch(
          `${TREASURY_CONFIG.BLOCKFROST_API_URL}/metadata/txs/labels/674?order=desc&count=100`,
          { headers: { 'project_id': TREASURY_CONFIG.BLOCKFROST_PROJECT_ID } }
        );
        if (labelResponse.ok) {
          const entries = await labelResponse.json();
          const reused = (entries as any[]).some(e => {
            const val = e.json_metadata?.paymentTxHash;
            return typeof val === 'string' && val.toLowerCase() === txHash;
          });
          if (reused) {
            return { ok: false, reason: 'already_used' };
          }
        }
        // A failure here is not fatal — the local check in step 2 still applies,
        // and this is a best-effort supplementary check, not the only guard.
      } catch {
        // ignore — best-effort
      }

      return { ok: true, paidLovelace };
    } catch (error) {
      console.error('[Treasury] Payment verification failed:', error);
      return { ok: false, reason: 'network_error', detail: error instanceof Error ? error.message : String(error) };
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

  // ── Founder Payout ──────────────────────────────────────────────────────────
  // Pure ledger math — no tx building here (that's BlockchainService's job, to
  // avoid a circular import: BlockchainService already imports this file).

  // Derives the unpaid founder balance FROM THE LEDGER ITSELF (not a separately
  // incremented counter) so there's a single source of truth that can't drift.
  async getPendingFounderPayout(): Promise<PendingFounderPayout> {
    const log = await this.getTransactionLog();
    const pending = log.filter(t => t.type === 'proposal_fee' && t.status === 'confirmed' && !t.payoutBatchTxHash);
    return {
      lovelace: pending.reduce((sum, t) => sum + t.founderAmount, 0),
      transactionIds: pending.map(t => t.id),
      proposalAmounts: pending.map(t => ({ proposalId: t.proposalId!, founderAmountLovelace: t.founderAmount })),
    };
  }

  // Marks the given local ledger entries as settled by a batch payout tx.
  async markPayoutSettled(transactionIds: string[], payoutTxHash: string): Promise<void> {
    try {
      const log = await this.getTransactionLog();
      const updated = log.map(t => transactionIds.includes(t.id) ? { ...t, payoutBatchTxHash: payoutTxHash } : t);
      await AsyncStorage.setItem(TREASURY_CONFIG.STORAGE_KEYS.TRANSACTION_LOG, JSON.stringify(updated));
    } catch (error) {
      console.error('[Treasury] Failed to mark payout settled:', error);
    }
  }

  async logFounderPayout(totalLovelace: number, payoutTxHash: string, proposalCount: number): Promise<void> {
    await this.logTransaction({
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'founder_distribution',
      creatorAddress: TREASURY_CONFIG.FOUNDER_WALLET,
      amount: totalLovelace,
      founderAmount: totalLovelace,
      foundationAmount: 0,
      timestamp: Date.now(),
      status: 'confirmed',
      metadataTxHash: payoutTxHash,
      notes: `Batch payout — ${proposalCount} proposal${proposalCount === 1 ? '' : 's'}`,
    });
  }

  // Short-lived AsyncStorage mutex so two near-simultaneous payout checks
  // (e.g. two proposals created back-to-back) don't both try to pay out.
  async acquirePayoutLock(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(TREASURY_CONFIG.STORAGE_KEYS.PAYOUT_LOCK);
    if (raw) {
      const lock = JSON.parse(raw);
      if (Date.now() - lock.acquiredAt < 2 * 60 * 1000) return false;
      // stale lock (>2min, likely a crashed prior attempt) — fall through and reacquire
    }
    await AsyncStorage.setItem(TREASURY_CONFIG.STORAGE_KEYS.PAYOUT_LOCK, JSON.stringify({ acquiredAt: Date.now() }));
    return true;
  }

  async releasePayoutLock(): Promise<void> {
    await AsyncStorage.removeItem(TREASURY_CONFIG.STORAGE_KEYS.PAYOUT_LOCK);
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
