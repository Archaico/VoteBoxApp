// src/services/BlockchainService.ts
//
// VoteBox BlockchainService — Cardano Integration (Option B: Foundation Wallet Relayer)
// ─────────────────────────────────────────────────────────────────────────────
// All transactions (proposals + votes) are signed by the Foundation wallet.
// This is intentional for the testnet MVP. At mainnet, replace signing with
// WalletConnect / deep-link to user's wallet.
//
// BEFORE TESTING — you must:
//   1. Generate a testnet ed25519 keypair (see instructions below)
//   2. Fund the foundation wallet from the preprod faucet
//   3. Set EXPO_PUBLIC_FOUNDATION_PRIVATE_KEY in your .env file
//
// Generating a testnet keypair (cardano-cli):
//   cardano-cli key gen-payment-key-pair \
//     --normal-key \
//     --signing-key-file payment.skey \
//     --verification-key-file payment.vkey
//   # Extract hex: cat payment.skey | jq -r '.cborHex' | cut -c 5-
//
// Preprod faucet: https://docs.cardano.org/cardano-testnet/tools/faucet
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { treasuryService, TREASURY_CONFIG } from './TreasuryService';

// CSL loaded via require — import would fail in some Metro configs
let _csl: any = null;
const csl = () => {
  if (!_csl) {
    try {
      _csl = require('@emurgo/cardano-serialization-lib-asmjs');
    } catch (e) {
      console.error('[BlockchainService] Failed to load cardano-serialization-lib:', e);
      throw e;
    }
  }
  return _csl;
};

// blake2b-256 — used to compute tx body hash (CSL v15 removed hash_transaction)
// blakejs is pure JS with no Node.js deps — safe for Metro/React Native
const blake2b256 = (data: Uint8Array): Uint8Array => {
  const blakejs = require('blakejs');
  return blakejs.blake2b(data, null, 32);
};

// ─── Config ───────────────────────────────────────────────────────────────────

const FOUNDATION = {
  // Testnet foundation wallet — funded from preprod faucet
  WALLET_ADDRESS: TREASURY_CONFIG.FOUNDATION_WALLET,
  // 32-byte ed25519 signing key as hex — set in .env before testing
  // NEVER put a mainnet key here — use server-side signing at mainnet
  PRIVATE_KEY_HEX: process.env.EXPO_PUBLIC_FOUNDATION_PRIVATE_KEY ?? '',
};

const BLOCKFROST = {
  API_URL:    TREASURY_CONFIG.BLOCKFROST_API_URL,
  PROJECT_ID: TREASURY_CONFIG.BLOCKFROST_PROJECT_ID,
};

const IPFS_GATEWAYS = [
  'https://w3s.link/ipfs',
  'https://ipfs.io/ipfs',
  'https://dweb.link/ipfs',
  'https://cloudflare-ipfs.com/ipfs',
];

const STORACHA = {
  UPLOAD_URL: 'https://up.storacha.network/upload',
  TOKEN:      'did:key:z6Mkjsscuat5eHppaWQtTWojgZm4gny2JpV7qbp1V5t4GgKU',
};

const METADATA_LABELS = {
  PROPOSAL:    674,
  VOTE:        1337,
  COMMENT_CID: 1338,
};

const CACHE_KEY = '@cached_proposals';
const CACHE_TTL = 24 * 60 * 60 * 1000;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Proposal {
  id: string;
  title: string;
  description: string;
  options: string[];
  deadline: number;
  totalVotes: number;
  results: Record<string, number>;
  creator?: string;
  createdAt?: number;
  expectedVoters?: number;
  cid?: string;
  txHash?: string;
}

export interface VoteData {
  proposalId: string;
  choice: string;
  voterPubKey: string;
  timestamp: number;
}

export interface FeeEstimate {
  fee: string;
  total: string;
  breakdown: { basicFee: string; metadataFee: string };
}

export interface ProposalCreationResult {
  cid: string;
  txHash: string;
  treasuryTxId: string;
  feesCollected: {
    totalADA: string;
    foundationADA: string;
    founderShareADA: string;
  };
}

// ─── BlockchainService ────────────────────────────────────────────────────────

class BlockchainService {
  private static instance: BlockchainService;
  private initialized = false;

  private constructor() {}

  static getInstance(): BlockchainService {
    if (!BlockchainService.instance) {
      BlockchainService.instance = new BlockchainService();
    }
    return BlockchainService.instance;
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const response = await fetch(`${BLOCKFROST.API_URL}/health`, {
        headers: { 'project_id': BLOCKFROST.PROJECT_ID },
      });
      if (response.ok) {
        console.log('[BlockchainService] Cardano preprod network ready');
      } else {
        console.warn('[BlockchainService] Blockfrost health check failed — offline mode');
      }
    } catch {
      console.warn('[BlockchainService] Network unavailable — offline mode');
    }

    if (!FOUNDATION.PRIVATE_KEY_HEX) {
      console.warn(
        '[BlockchainService] EXPO_PUBLIC_FOUNDATION_PRIVATE_KEY not set.\n' +
        'Transactions will be simulated. Set the key in .env to submit real txs.'
      );
    }

    this.initialized = true;
  }

  // ── Proposal Fetching ───────────────────────────────────────────────────────
  // Cache-first: return cached proposals immediately, then refresh from chain.

  async getProposals(): Promise<Proposal[]> {
    const cached = await this.getCachedProposals();
    if (cached && cached.length > 0) {
      // Fresh cache — refresh from chain in background, return immediately
      this.fetchAndMergeChainProposals().catch(e =>
        console.warn('[BlockchainService] Background chain refresh failed:', e)
      );
      return cached;
    }

    // Cache expired or empty — check for stale data before hitting the network
    const stale = await this.getCachedProposals(true);
    if (stale && stale.length > 0) {
      // Return stale data immediately so the list isn't blank, refresh in background
      this.fetchAndMergeChainProposals().catch(e =>
        console.warn('[BlockchainService] Background chain refresh failed:', e)
      );
      return stale;
    }

    // Nothing cached at all — fetch from chain synchronously on first load
    return this.fetchAndMergeChainProposals();
  }

  // Fetches proposals from Cardano via Blockfrost, merges with cache.
  private async fetchAndMergeChainProposals(): Promise<Proposal[]> {
    try {
      const txHashes = await this.fetchTxHashesWithLabel(METADATA_LABELS.PROPOSAL);
      if (txHashes.length === 0) return await this.getCachedProposals(true) ?? [];

      const chainProposals: Proposal[] = [];

      for (const txHash of txHashes.slice(0, 25)) {
        try {
          const metadata = await this.fetchTxMetadata(txHash);
          const proposalMeta = metadata[METADATA_LABELS.PROPOSAL];
          if (!proposalMeta?.cid) continue;

          const proposal = await this.fetchProposalFromIPFS(proposalMeta.cid);
          if (proposal) chainProposals.push(proposal);
        } catch {
          continue;
        }
      }

      if (chainProposals.length === 0) return await this.getCachedProposals(true) ?? [];

      // Merge chain proposals with locally-created proposals (not yet on chain)
      const existing = await this.getCachedProposals(true) ?? [];
      const chainIds = new Set(chainProposals.map(p => p.id));
      const localOnly = existing.filter(p => !chainIds.has(p.id));
      const merged = [...chainProposals, ...localOnly]
        .filter(p => p.deadline > Date.now())
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

      await this.writeCache(merged);
      console.log(`[BlockchainService] Loaded ${chainProposals.length} proposals from chain`);
      return merged;
    } catch (error) {
      console.warn('[BlockchainService] Chain fetch failed:', error);
      return await this.getCachedProposals(true) ?? [];
    }
  }

  // ── Proposal Creation ─────────────────────────────────────────────────────

  async createProposal(proposalData: {
    title: string;
    description: string;
    creator: string;
    duration: number;
    expectedVoters?: number;
  }): Promise<ProposalCreationResult> {
    const expectedVoters = proposalData.expectedVoters ?? 10;

    const proposal: Partial<Proposal> = {
      id:             `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title:          proposalData.title,
      description:    proposalData.description,
      creator:        proposalData.creator,
      deadline:       Date.now() + (proposalData.duration * 24 * 60 * 60 * 1000),
      options:        ['Yes', 'No', 'Abstain'],
      totalVotes:     0,
      results:        { Yes: 0, No: 0, Abstain: 0 },
      createdAt:      Date.now(),
      expectedVoters,
    };

    // Step 1 — Upload proposal JSON to IPFS
    const cid = await this.uploadToIPFS(proposal);
    console.log('[BlockchainService] Uploaded to IPFS:', cid);

    // Step 2 — Submit Cardano metadata transaction
    const txHash = await this.buildAndSubmitMetadataTx(
      {
        [METADATA_LABELS.PROPOSAL]: {
          type:       'proposal',
          cid,
          proposalId: proposal.id!,
          version:    '1.0',
          platform:   'VoteBox',
        },
      },
      `VoteBox proposal: ${proposal.id}`
    );
    console.log('[BlockchainService] Cardano tx:', txHash);

    // Step 3 — Record fees through TreasuryService
    const treasuryTx = await treasuryService.recordProposalFeeCollection(
      proposal.id!,
      proposalData.creator,
      expectedVoters,
      txHash
    );
    const fees = treasuryService.calculateProposalFees(expectedVoters);

    // Step 4 — Cache proposal immediately so it appears in list
    const fullProposal = { ...proposal, cid, txHash } as Proposal;
    await this.cacheNewProposal(fullProposal);

    return {
      cid,
      txHash,
      treasuryTxId: treasuryTx.id,
      feesCollected: {
        totalADA:        fees.grandTotalADA,
        foundationADA:   fees.foundationFeeADA,
        founderShareADA: fees.founderShareADA,
      },
    };
  }

  // ── Vote Submission ──────────────────────────────────────────────────────────
  // Votes cost nothing — Foundation wallet covers the minimal Cardano tx fee.

  async submitVote(voteData: VoteData): Promise<string> {
    const cid = await this.uploadToIPFS(voteData);

    const txHash = await this.buildAndSubmitMetadataTx(
      {
        [METADATA_LABELS.VOTE]: {
          type:       'vote',
          cid,
          proposalId: voteData.proposalId,
          choice:     voteData.choice,
          timestamp:  voteData.timestamp,
        },
      },
      `VoteBox vote: ${voteData.proposalId}`
    );

    await this.incrementLocalVoteCount(voteData.proposalId, voteData.choice);
    console.log('[BlockchainService] Vote submitted:', txHash);
    return txHash;
  }

  // ── Cardano Transaction Builder ───────────────────────────────────────────
  // Builds a minimal Cardano transaction carrying arbitrary metadata,
  // signed by the Foundation wallet. Falls back to a simulated hash when
  // the private key is not configured (testnet development mode).

  private async buildAndSubmitMetadataTx(
    metadataObj: Record<number, Record<string, string>>,
    memo: string
  ): Promise<string> {
    if (!FOUNDATION.PRIVATE_KEY_HEX) {
      console.warn('[BlockchainService] No private key — simulating tx for:', memo);
      return this.simulateTxHash(memo + Date.now());
    }

    try {
      const C = csl();

      // Fetch what we need from Blockfrost in parallel
      const [utxos, protocolParams, latestBlock] = await Promise.all([
        this.blockfrostGet<any[]>(`/addresses/${FOUNDATION.WALLET_ADDRESS}/utxos`),
        this.blockfrostGet<any>('/epochs/latest/parameters'),
        this.blockfrostGet<any>('/blocks/latest'),
      ]);

      if (!utxos || utxos.length === 0) throw new Error('Foundation wallet has no UTxOs — fund it from the faucet');

      // Pick the UTxO with the most lovelace
      const utxo = utxos.reduce((best: any, u: any) => {
        const bestAmt = parseInt(best.amount.find((a: any) => a.unit === 'lovelace')?.quantity ?? '0');
        const uAmt    = parseInt(u.amount.find((a: any) => a.unit === 'lovelace')?.quantity ?? '0');
        return uAmt > bestAmt ? u : best;
      });

      const inputAmount = utxo.amount.find((a: any) => a.unit === 'lovelace')?.quantity ?? '0';
      const currentSlot = latestBlock.slot;

      // Build transaction config from live protocol params
      const txBuilderConfig = C.TransactionBuilderConfigBuilder.new()
        .fee_algo(C.LinearFee.new(
          C.BigNum.from_str(String(protocolParams.min_fee_a)),
          C.BigNum.from_str(String(protocolParams.min_fee_b))
        ))
        .pool_deposit(C.BigNum.from_str(String(protocolParams.pool_deposit)))
        .key_deposit(C.BigNum.from_str(String(protocolParams.key_deposit)))
        .max_value_size(5000)
        .max_tx_size(16384)
        .coins_per_utxo_byte(C.BigNum.from_str(String(protocolParams.coins_per_utxo_size ?? '4310')))
        .build();

      const txBuilder = C.TransactionBuilder.new(txBuilderConfig);

      // Resolve foundation address and payment key
      const foundationAddress = C.Address.from_bech32(FOUNDATION.WALLET_ADDRESS);
      const foundationKey     = C.PrivateKey.from_normal_bytes(Buffer.from(FOUNDATION.PRIVATE_KEY_HEX, 'hex'));
      const paymentKeyHash    = foundationKey.to_public().hash();

      // Add input UTxO
      txBuilder.add_key_input(
        paymentKeyHash,
        C.TransactionInput.new(
          C.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
          utxo.output_index
        ),
        C.Value.new(C.BigNum.from_str(inputAmount))
      );

      // TTL: current slot + 2 hours
      txBuilder.set_ttl_bignum(C.BigNum.from_str(String(currentSlot + 7200)));

      // Build metadata
      const generalMetadata = C.GeneralTransactionMetadata.new();
      for (const [labelStr, fields] of Object.entries(metadataObj)) {
        const map = C.MetadataMap.new();
        for (const [key, value] of Object.entries(fields)) {
          map.insert(
            C.TransactionMetadatum.new_text(key),
            C.TransactionMetadatum.new_text(String(value))
          );
        }
        generalMetadata.insert(
          C.BigNum.from_str(String(labelStr)),
          C.TransactionMetadatum.new_map(map)
        );
      }

      const auxData = C.AuxiliaryData.new();
      auxData.set_metadata(generalMetadata);
      txBuilder.set_auxiliary_data(auxData);

      // Add change output back to foundation wallet
      txBuilder.add_change_if_needed(foundationAddress);

      // Build, sign, serialize
      // hash_transaction removed in CSL v15 — compute blake2b-256 of body bytes manually
      const txBody     = txBuilder.build();
      const txHash     = C.TransactionHash.from_bytes(blake2b256(txBody.to_bytes()));
      const witness    = C.make_vkey_witness(txHash, foundationKey);
      const witnesses  = C.TransactionWitnessSet.new();
      const vkeys      = C.Vkeywitnesses.new();
      vkeys.add(witness);
      witnesses.set_vkeys(vkeys);

      const tx      = C.Transaction.new(txBody, witnesses, auxData);
      const txBytes = tx.to_bytes();

      // Submit via Blockfrost
      const submitResponse = await fetch(`${BLOCKFROST.API_URL}/tx/submit`, {
        method:  'POST',
        headers: {
          'project_id':   BLOCKFROST.PROJECT_ID,
          'Content-Type': 'application/cbor',
        },
        body: txBytes,
      });

      if (!submitResponse.ok) {
        const errText = await submitResponse.text();
        throw new Error(`Blockfrost submit failed: ${submitResponse.status} ${errText}`);
      }

      const submittedHash = txHash.to_hex();
      console.log('[BlockchainService] Real tx submitted:', submittedHash);
      return submittedHash;
    } catch (error) {
      console.error('[BlockchainService] Tx build/submit failed:', error);
      // Fall back to simulated hash so the app doesn't crash during development
      return `sim_${this.simulateTxHash(memo + Date.now())}`;
    }
  }

  // ── IPFS ──────────────────────────────────────────────────────────────────

  private async uploadToIPFS(data: any): Promise<string> {
    const json = JSON.stringify(data);
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const form = new FormData();
      form.append('file', blob, 'data.json');

      const response = await fetch(STORACHA.UPLOAD_URL, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${STORACHA.TOKEN}`,
          'X-NAME':        'votebox-data',
        },
        body: form,
      });

      if (response.ok) {
        const result = await response.json();
        return result.cid ?? result['/'];
      }
    } catch {
      console.warn('[BlockchainService] Storacha upload failed — using fallback CID');
    }

    // Deterministic fallback CID for development
    return `bafyrei${this.simpleHash(json).slice(0, 32)}`;
  }

  private async fetchProposalFromIPFS(cid: string): Promise<Proposal | null> {
    for (const gateway of IPFS_GATEWAYS) {
      try {
        const response = await fetch(`${gateway}/${cid}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data?.id && data?.title) return data as Proposal;
      } catch {
        continue;
      }
    }
    return null;
  }

  // ── Blockfrost Helpers ────────────────────────────────────────────────────

  private async blockfrostGet<T>(path: string): Promise<T> {
    const response = await fetch(`${BLOCKFROST.API_URL}${path}`, {
      headers: { 'project_id': BLOCKFROST.PROJECT_ID },
    });
    if (!response.ok) throw new Error(`Blockfrost ${path} → ${response.status}`);
    return response.json();
  }

  private async fetchTxHashesWithLabel(label: number): Promise<string[]> {
    try {
      const txs = await this.blockfrostGet<any[]>(
        `/addresses/${FOUNDATION.WALLET_ADDRESS}/transactions?order=desc&count=25`
      );
      return (txs ?? []).map((tx: any) => tx.tx_hash);
    } catch {
      return [];
    }
  }

  private async fetchTxMetadata(txHash: string): Promise<Record<number, any>> {
    try {
      const metadata = await this.blockfrostGet<any[]>(`/txs/${txHash}/metadata`);
      return Object.fromEntries((metadata ?? []).map((m: any) => [m.label, m.json_metadata]));
    } catch {
      return {};
    }
  }

  // ── Cache Management ──────────────────────────────────────────────────────

  private async getCachedProposals(ignoreExpiry = false): Promise<Proposal[] | null> {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (!cached) return null;
      const { data, timestamp } = JSON.parse(cached);
      if (!ignoreExpiry && Date.now() - timestamp > CACHE_TTL) return null;
      return data;
    } catch {
      return null;
    }
  }

  private async writeCache(proposals: Proposal[]): Promise<void> {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
      data:      proposals,
      timestamp: Date.now(),
    }));
    console.log(`[BlockchainService] Cache written — ${proposals.length} proposals`);
  }

  private async cacheNewProposal(proposal: Proposal): Promise<void> {
    try {
      const existing = await AsyncStorage.getItem(CACHE_KEY);
      const cache = existing ? JSON.parse(existing) : { data: [], timestamp: 0 };
      if (!Array.isArray(cache.data)) cache.data = [];
      cache.data.unshift(proposal);
      cache.timestamp = Date.now();
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      console.log(`[BlockchainService] Cache updated — ${cache.data.length} proposals`);
    } catch (error) {
      console.error('[BlockchainService] Cache update failed:', error);
    }
  }

  private async incrementLocalVoteCount(proposalId: string, choice: string): Promise<void> {
    try {
      const existing = await AsyncStorage.getItem(CACHE_KEY);
      if (!existing) return;
      const cache = JSON.parse(existing);
      cache.data = cache.data.map((p: Proposal) => {
        if (p.id !== proposalId) return p;
        return {
          ...p,
          totalVotes: p.totalVotes + 1,
          results:    { ...p.results, [choice]: (p.results[choice] ?? 0) + 1 },
        };
      });
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.error('[BlockchainService] Vote count update failed:', error);
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private simpleHash(input: string): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let val = 0;
    for (let i = 0; i < input.length; i++) {
      val = ((val << 5) - val + input.charCodeAt(i)) & 0xffffffff;
    }
    let hash = '';
    for (let i = 0; i < 32; i++) {
      hash += chars[Math.abs(val * (i + 1)) % chars.length];
    }
    return hash;
  }

  private simulateTxHash(seed: string): string {
    return this.simpleHash(seed + Date.now().toString());
  }
}

export const blockchainService = BlockchainService.getInstance();
