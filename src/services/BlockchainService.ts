// src/services/BlockchainService.ts
//
// VoteBox BlockchainService — Cardano Integration (Option B: Foundation Wallet Relayer)
// ─────────────────────────────────────────────────────────────────────────────
// All transactions (proposals + votes) are signed by the Foundation wallet.
// Mainnet: replace signing with WalletConnect / deep-link to user's wallet.
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { treasuryService, TREASURY_CONFIG } from './TreasuryService';
import { buildSignedTx } from '../lib/CardanoTxBuilder';

// ─── Config ───────────────────────────────────────────────────────────────────

const FOUNDATION = {
  WALLET_ADDRESS: TREASURY_CONFIG.FOUNDATION_WALLET,
  PRIVATE_KEY_HEX: process.env.EXPO_PUBLIC_FOUNDATION_PRIVATE_KEY ?? '',
};

const BLOCKFROST = {
  API_URL:    TREASURY_CONFIG.BLOCKFROST_API_URL,
  PROJECT_ID: TREASURY_CONFIG.BLOCKFROST_PROJECT_ID,
};

const PINATA = {
  JWT:              process.env.EXPO_PUBLIC_PINATA_JWT ?? '',
  UPLOAD_URL:       'https://api.pinata.cloud/pinning/pinJSONToIPFS',
  FILE_UPLOAD_URL:  'https://api.pinata.cloud/pinning/pinFileToIPFS',
  DEDICATED_GW:     'https://magenta-important-scorpion-739.mypinata.cloud/ipfs',
  PUBLIC_GW:        'https://gateway.pinata.cloud/ipfs',
};

const IPFS_FALLBACKS = [
  'https://ipfs.io/ipfs',
  'https://dweb.link/ipfs',
];

// MVP cap — keeps per-proposal attachment cost predictable (Pinata free tier: 1GB
// storage / 10GB bandwidth / 500 files per month). Images are compressed client-side
// before upload; see CreateProposalScreen.
const MAX_ATTACHMENTS = 2;

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
  status?: 'active' | 'closed';
  attachments?: string[];
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
  proposalId: string;
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
  private _lastFetchError: string | null = null;

  private constructor() {}

  getLastFetchError(): string | null { return this._lastFetchError; }

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
      const response = await this.fetchWithTimeout(`${BLOCKFROST.API_URL}/health`, {
        headers: { 'project_id': BLOCKFROST.PROJECT_ID },
      }, 8000);
      if (response.ok) {
        console.log('[BlockchainService] Cardano preprod network ready');
      } else {
        console.warn('[BlockchainService] Blockfrost health check failed — offline mode');
      }
    } catch {
      console.warn('[BlockchainService] Network unavailable — offline mode');
    }

    if (!FOUNDATION.PRIVATE_KEY_HEX) {
      console.warn('[BlockchainService] No foundation private key — txs will be simulated');
    }

    this.initialized = true;
  }

  // ── Proposal Fetching ───────────────────────────────────────────────────────
  // Cache-first: returns cached proposals immediately, refreshes from chain in background.

  async getProposals(): Promise<Proposal[]> {
    const cached = await this.getCachedProposals();
    if (cached && cached.length > 0) {
      this.fetchAndMergeChainProposals().catch(e =>
        console.warn('[BlockchainService] Background chain refresh failed:', e)
      );
      return cached;
    }
    return this.fetchAndMergeChainProposals();
  }

  // Always fetches from chain — call after getProposals() to update UI with fresh data
  async refreshFromChain(): Promise<Proposal[]> {
    return this.fetchAndMergeChainProposals();
  }

  private async fetchAndMergeChainProposals(): Promise<Proposal[]> {
    try {
      const { chainProposals, voteCounts } = await this.fetchWalletData();

      if (chainProposals.length === 0) return await this.getCachedProposals() ?? [];

      const existing = await this.getCachedProposals() ?? [];
      const chainIds = new Set(chainProposals.map(p => p.id));
      const localOnly = existing.filter(p => !chainIds.has(p.id));
      const now = Date.now();

      const mergedChain = chainProposals.map(cp => {
        const status: 'active' | 'closed' = cp.deadline > now ? 'active' : 'closed';
        const vc = voteCounts[cp.id];
        if (vc && vc.total > 0) {
          return { ...cp, status, totalVotes: vc.total, results: { yes: vc.yes, no: vc.no, abstain: vc.abstain } };
        }
        const cachedP = existing.find(e => e.id === cp.id);
        if (cachedP && cachedP.totalVotes > 0) {
          return { ...cp, status, results: cachedP.results, totalVotes: cachedP.totalVotes };
        }
        return { ...cp, status };
      });

      const localOnlyWithStatus = localOnly.map(p => ({
        ...p,
        status: (p.deadline > now ? 'active' : 'closed') as 'active' | 'closed',
      }));

      const merged = [...mergedChain, ...localOnlyWithStatus]
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        });

      await this.writeCache(merged);
      console.log(`[BlockchainService] Loaded ${chainProposals.length} chain proposals, ${localOnly.length} local-only`);
      return merged;
    } catch (error) {
      console.warn('[BlockchainService] Chain fetch failed:', error);
      return await this.getCachedProposals() ?? [];
    }
  }

  // ── Wallet Data Fetch ─────────────────────────────────────────────────────
  // Queries the foundation wallet's transactions and extracts both proposals
  // (label 674) and votes (label 1337) in a single address lookup + batched
  // metadata fetches. Uses address-based lookup so we only see VoteBox txs,
  // not other projects that happen to share the same metadata label numbers.

  private async fetchWalletData(): Promise<{
    chainProposals: Proposal[];
    voteCounts: Record<string, { yes: number; no: number; abstain: number; total: number }>;
  }> {
    const empty = { chainProposals: [], voteCounts: {} };

    const txs = await this.blockfrostGet<any[]>(
      `/addresses/${FOUNDATION.WALLET_ADDRESS}/transactions?order=desc&count=100`
    ).catch((e: Error) => {
      this._lastFetchError = `Wallet fetch: ${e.message}`;
      console.warn('[BlockchainService] Wallet tx fetch failed:', e.message);
      return null;
    });

    if (!txs?.length) {
      if (!this._lastFetchError) this._lastFetchError = 'No transactions found for foundation wallet';
      return empty;
    }
    this._lastFetchError = null;

    // Fetch metadata for all wallet txs in parallel batches of 10
    const BATCH = 10;
    const metadataResults: Array<{ txHash: string; metadata: Record<number, any> }> = [];

    for (let i = 0; i < txs.length; i += BATCH) {
      const batch = txs.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(async tx => ({
          txHash: tx.tx_hash,
          metadata: await this.fetchTxMetadata(tx.tx_hash),
        }))
      );
      for (const r of settled) {
        if (r.status === 'fulfilled') metadataResults.push(r.value);
      }
    }

    // Aggregate vote counts from label 1337 txs
    const voteCounts: Record<string, { yes: number; no: number; abstain: number; total: number }> = {};
    for (const { metadata } of metadataResults) {
      const m = metadata[METADATA_LABELS.VOTE];
      if (!m?.proposalId || !m?.choice || m?.type !== 'vote') continue;
      const pid = m.proposalId as string;
      if (!voteCounts[pid]) voteCounts[pid] = { yes: 0, no: 0, abstain: 0, total: 0 };
      const choice = (m.choice as string).toLowerCase() as 'yes' | 'no' | 'abstain';
      if (choice === 'yes' || choice === 'no' || choice === 'abstain') {
        voteCounts[pid][choice]++;
        voteCounts[pid].total++;
      }
    }

    // Extract proposal entries from label 674 txs
    const proposalEntries = metadataResults.filter(({ metadata }) => {
      const m = metadata[METADATA_LABELS.PROPOSAL];
      // Accept both — proposals published before the VoteBoxApp rename are
      // permanently on-chain with the old value and must stay visible.
      return m?.cid && (m?.platform === 'VoteBoxApp' || m?.platform === 'VoteBox');
    });

    // Fetch proposal JSON from IPFS for each entry
    const chainProposals: Proposal[] = [];
    for (const { txHash, metadata } of proposalEntries) {
      try {
        const proposal = await this.fetchProposalFromIPFS(metadata[METADATA_LABELS.PROPOSAL].cid);
        if (proposal) chainProposals.push({ ...proposal, txHash });
      } catch { continue; }
    }

    return { chainProposals, voteCounts };
  }

  // ── Proposal Creation ─────────────────────────────────────────────────────

  async createProposal(proposalData: {
    title: string;
    description: string;
    creator: string;
    duration: number;
    expectedVoters?: number;
    attachmentUris?: string[];
  }): Promise<ProposalCreationResult> {
    const expectedVoters = proposalData.expectedVoters ?? 10;

    const attachments: string[] = [];
    for (const uri of (proposalData.attachmentUris ?? []).slice(0, MAX_ATTACHMENTS)) {
      const cid = await this.uploadFileToIPFS(uri);
      if (cid) attachments.push(cid);
    }

    const proposal: Partial<Proposal> = {
      id:             `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title:          proposalData.title,
      description:    proposalData.description,
      creator:        proposalData.creator,
      deadline:       Date.now() + (proposalData.duration * 24 * 60 * 60 * 1000),
      options:        ['Yes', 'No', 'Abstain'],
      totalVotes:     0,
      results:        { yes: 0, no: 0, abstain: 0 },
      createdAt:      Date.now(),
      expectedVoters,
      status:         'active',
      ...(attachments.length > 0 && { attachments }),
    };

    const cid = await this.uploadToIPFS(proposal);
    console.log('[BlockchainService] Uploaded to IPFS:', cid);

    const txHash = await this.buildAndSubmitMetadataTx(
      {
        [METADATA_LABELS.PROPOSAL]: {
          type:       'proposal',
          cid,
          proposalId: proposal.id!,
          version:    '1.0',
          platform:   'VoteBoxApp',
        },
      },
      `VoteBoxApp proposal: ${proposal.id}`
    );
    console.log('[BlockchainService] Cardano tx:', txHash);

    const treasuryTx = await treasuryService.recordProposalFeeCollection(
      proposal.id!,
      proposalData.creator,
      expectedVoters,
      txHash
    );
    const fees = treasuryService.calculateProposalFees(expectedVoters);

    const fullProposal = { ...proposal, cid, txHash } as Proposal;
    await this.cacheNewProposal(fullProposal);

    return {
      proposalId: proposal.id!,
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
          timestamp:  String(voteData.timestamp),
        },
      },
      `VoteBoxApp vote: ${voteData.proposalId}`
    );

    await this.incrementLocalVoteCount(voteData.proposalId, voteData.choice);
    console.log('[BlockchainService] Vote submitted:', txHash);
    return txHash;
  }

  // ── Cardano Transaction Builder ───────────────────────────────────────────
  // Pure-JS tx builder via CardanoTxBuilder.ts — no native dependencies.

  private async buildAndSubmitMetadataTx(
    metadataObj: Record<number, Record<string, string>>,
    memo: string
  ): Promise<string> {
    if (!FOUNDATION.PRIVATE_KEY_HEX) {
      console.warn('[BlockchainService] No private key — simulating tx for:', memo);
      return this.simulateTxHash(memo + Date.now());
    }

    try {
      const [utxos, protocolParams, latestBlock] = await Promise.all([
        this.blockfrostGet<any[]>(`/addresses/${FOUNDATION.WALLET_ADDRESS}/utxos`),
        this.blockfrostGet<any>('/epochs/latest/parameters'),
        this.blockfrostGet<any>('/blocks/latest'),
      ]);

      if (!utxos || utxos.length === 0) {
        throw new Error('Foundation wallet has no UTxOs — fund it from the preprod faucet');
      }

      const utxo = utxos.reduce((best: any, u: any) => {
        const bestAmt = parseInt(best.amount.find((a: any) => a.unit === 'lovelace')?.quantity ?? '0');
        const uAmt    = parseInt(u.amount.find((a: any) => a.unit === 'lovelace')?.quantity ?? '0');
        return uAmt > bestAmt ? u : best;
      });

      const { txBytes, txHash } = buildSignedTx({
        utxoTxHash:    utxo.tx_hash,
        utxoIndex:     utxo.output_index,
        utxoLovelace:  utxo.amount.find((a: any) => a.unit === 'lovelace')?.quantity ?? '0',
        changeAddress: FOUNDATION.WALLET_ADDRESS,
        privateKeyHex: FOUNDATION.PRIVATE_KEY_HEX,
        metadata:      metadataObj,
        minFeeA:       protocolParams.min_fee_a,
        minFeeB:       protocolParams.min_fee_b,
        currentSlot:   latestBlock.slot,
      });

      const submitResponse = await this.fetchWithTimeout(
        `${BLOCKFROST.API_URL}/tx/submit`,
        {
          method:  'POST',
          headers: {
            'project_id':   BLOCKFROST.PROJECT_ID,
            'Content-Type': 'application/cbor',
          },
          body: txBytes as unknown as BodyInit,
        },
        15000
      );

      if (!submitResponse.ok) {
        const errText = await submitResponse.text();
        throw new Error(`Blockfrost submit failed: ${submitResponse.status} ${errText}`);
      }

      console.log('[BlockchainService] Real tx submitted:', txHash);
      return txHash;
    } catch (error) {
      console.error('[BlockchainService] Tx build/submit failed:', error);
      return `sim_${this.simulateTxHash(memo + Date.now())}`;
    }
  }

  // ── IPFS ──────────────────────────────────────────────────────────────────

  private async uploadToIPFS(data: any): Promise<string> {
    if (!PINATA.JWT) {
      console.warn('[BlockchainService] No Pinata JWT — using fallback CID');
      return `bafyrei${this.simpleHash(JSON.stringify(data)).slice(0, 32)}`;
    }

    try {
      const response = await this.fetchWithTimeout(
        PINATA.UPLOAD_URL,
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${PINATA.JWT}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            pinataContent:  data,
            pinataMetadata: { name: 'votebox-data' },
          }),
        },
        15000
      );

      if (!response.ok) throw new Error(`Pinata upload failed: ${response.status}`);
      const result = await response.json();
      return result.IpfsHash;
    } catch (error) {
      console.warn('[BlockchainService] Pinata upload failed:', error);
      return `bafyrei${this.simpleHash(JSON.stringify(data)).slice(0, 32)}`;
    }
  }

  // Uploads a local image file (already compressed by the caller) to Pinata.
  // Returns null on failure rather than throwing — a failed attachment
  // shouldn't block the proposal itself from publishing.
  private async uploadFileToIPFS(uri: string): Promise<string | null> {
    if (!PINATA.JWT) {
      console.warn('[BlockchainService] No Pinata JWT — skipping attachment upload');
      return null;
    }

    try {
      const formData = new FormData();
      formData.append('file', {
        uri,
        name: `attachment_${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as any);
      formData.append('pinataMetadata', JSON.stringify({ name: 'votebox-attachment' }));

      const response = await this.fetchWithTimeout(
        PINATA.FILE_UPLOAD_URL,
        {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${PINATA.JWT}` },
          body:    formData,
        },
        20000
      );

      if (!response.ok) throw new Error(`Pinata file upload failed: ${response.status}`);
      const result = await response.json();
      return result.IpfsHash;
    } catch (error) {
      console.warn('[BlockchainService] Attachment upload failed:', error);
      return null;
    }
  }

  // Attachments are read-heavy (viral shares → many viewers), so always route
  // through free gateways rather than the metered dedicated one. Ordered
  // fallback chain — same pattern as fetchProposalFromIPFS — since a single
  // gateway can be briefly slow/unpropagated with no retry otherwise.
  getAttachmentUrls(cid: string): string[] {
    return [PINATA.PUBLIC_GW, ...IPFS_FALLBACKS].map(g => `${g}/${cid}`);
  }

  private async fetchProposalFromIPFS(cid: string): Promise<Proposal | null> {
    const authHeader = PINATA.JWT ? { 'Authorization': `Bearer ${PINATA.JWT}` } : undefined;

    const gateways: Array<{ url: string; headers?: Record<string, string> }> = [
      // Dedicated gateway — restricted, JWT required, highest reliability
      ...(authHeader ? [{ url: `${PINATA.DEDICATED_GW}/${cid}`, headers: authHeader }] : []),
      // Public Pinata gateway — no auth needed, works for all our pinned content
      { url: `${PINATA.PUBLIC_GW}/${cid}` },
      // Public IPFS gateways — only work if content has propagated beyond Pinata
      ...IPFS_FALLBACKS.map(g => ({ url: `${g}/${cid}` })),
    ];

    for (const { url, headers } of gateways) {
      try {
        const response = await this.fetchWithTimeout(url, headers ? { headers } : {}, 8000);
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

  private fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  private async blockfrostGet<T>(path: string, timeoutMs = 10000): Promise<T> {
    const response = await this.fetchWithTimeout(
      `${BLOCKFROST.API_URL}${path}`,
      { headers: { 'project_id': BLOCKFROST.PROJECT_ID } },
      timeoutMs
    );
    if (!response.ok) throw new Error(`Blockfrost ${path} → ${response.status}`);
    return response.json();
  }

  // Fetch tx metadata by hash — kept for label 1338 (comment CID) lookups
  private async fetchTxMetadata(txHash: string): Promise<Record<number, any>> {
    try {
      const metadata = await this.blockfrostGet<any[]>(`/txs/${txHash}/metadata`, 5000);
      return Object.fromEntries((metadata ?? []).map((m: any) => [m.label, m.json_metadata]));
    } catch {
      return {};
    }
  }

  // Register the final comment-thread CID on-chain when a proposal closes (label 1338)
  async registerCommentCID(proposalId: string, cid: string): Promise<string> {
    return this.buildAndSubmitMetadataTx(
      {
        [METADATA_LABELS.COMMENT_CID]: {
          type:       'comment_cid',
          proposalId,
          cid,
          timestamp:  String(Date.now()),
        },
      },
      `VoteBoxApp comment CID: ${proposalId}`
    );
  }

  // Retrieve the on-chain comment CID for a closed proposal
  async getFinalCommentCID(proposalId: string): Promise<string | null> {
    try {
      const txs = await this.blockfrostGet<any[]>(
        `/metadata/txs/labels/${METADATA_LABELS.COMMENT_CID}?order=desc&count=100`
      );
      for (const tx of txs ?? []) {
        const meta = tx.json_metadata;
        if (meta?.proposalId === proposalId && meta?.cid) return meta.cid as string;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Cache Management ──────────────────────────────────────────────────────

  private async getCachedProposals(): Promise<Proposal[] | null> {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (!cached) return null;
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp > CACHE_TTL) return null;
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
