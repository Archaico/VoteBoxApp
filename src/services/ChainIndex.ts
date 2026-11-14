// src/services/ChainIndex.ts
//
// Incremental, resumable index of the Foundation wallet's transactions:
// proposal anchors (label 674) and vote tallies (label 1337).
//
// Cardano transactions never change once confirmed, so each one only needs
// to be read once. The index remembers the newest transaction it has
// processed (the cursor); a sync lists the wallet's transactions newest-first
// only until it reaches that cursor, then reads metadata for just the new
// ones, oldest first. A normal refresh therefore costs 1 listing request plus
// one metadata request per new transaction, instead of re-reading the whole
// history — and there is no 100-transaction ceiling.
//
// Progress is saved after every batch, so an interrupted first sync resumes
// where it stopped. Every saved state is a full, consistent snapshot, so the
// foreground app and the background task can both sync without
// double-counting votes.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TREASURY_CONFIG } from './TreasuryService';

const INDEX_KEY = 'voteboxapp.chainIndex.v1';
const PAGE_SIZE = 100;
const BATCH     = 10;

const LABEL_PROPOSAL = '674';
const LABEL_VOTE     = '1337';

export interface ProposalAnchor {
  cid:    string;
  txHash: string;
}

export interface VoteTally {
  yes:     number;
  no:      number;
  abstain: number;
  total:   number;
}

export interface ChainIndexState {
  v:       1;
  wallet:  string;
  cursor:  string | null;                      // newest tx hash fully processed
  anchors: Record<string, ProposalAnchor>;     // by proposalId
  votes:   Record<string, VoteTally>;          // by proposalId
}

export interface ChainSyncResult {
  index: ChainIndexState;
  error: string | null;   // set when the sync stopped early; index is still consistent
  newTxs: number;
}

const emptyIndex = (wallet: string): ChainIndexState =>
  ({ v: 1, wallet, cursor: null, anchors: {}, votes: {} });

// AbortSignal.timeout() is not available in Hermes — use AbortController instead
async function bfGet<T>(path: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${TREASURY_CONFIG.BLOCKFROST_API_URL}${path}`, {
      headers: { project_id: TREASURY_CONFIG.BLOCKFROST_PROJECT_ID },
      signal:  controller.signal,
    });
    if (!res.ok) throw new Error(`Blockfrost ${path} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadIndex(wallet: string): Promise<ChainIndexState> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.v === 1 && parsed.wallet === wallet) return parsed;
  } catch {}
  return emptyIndex(wallet);
}

export async function getChainIndex(): Promise<ChainIndexState> {
  return loadIndex(TREASURY_CONFIG.FOUNDATION_WALLET);
}

function applyMetadata(index: ChainIndexState, txHash: string, entries: any[]): void {
  for (const { label, json_metadata: m } of entries ?? []) {
    if (label === LABEL_PROPOSAL) {
      // Accept both — proposals published before the VoteBoxApp rename are
      // permanently on-chain with the old value and must stay visible.
      if (m?.cid && m?.proposalId && (m.platform === 'VoteBoxApp' || m.platform === 'VoteBox')) {
        index.anchors[m.proposalId] = { cid: m.cid, txHash };
      }
    } else if (label === LABEL_VOTE) {
      if (!m?.proposalId || !m?.choice || m?.type !== 'vote') continue;
      const choice = String(m.choice).toLowerCase();
      if (choice !== 'yes' && choice !== 'no' && choice !== 'abstain') continue;
      const t = index.votes[m.proposalId] ?? (index.votes[m.proposalId] = { yes: 0, no: 0, abstain: 0, total: 0 });
      t[choice]++;
      t.total++;
    }
  }
}

// One sync at a time per JS context; concurrent callers share the result.
let inFlight: Promise<ChainSyncResult> | null = null;

export function syncChainIndex(): Promise<ChainSyncResult> {
  if (!inFlight) inFlight = runSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync(): Promise<ChainSyncResult> {
  const wallet = TREASURY_CONFIG.FOUNDATION_WALLET;
  let index = await loadIndex(wallet);
  const save = () => AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => {});

  // 1. List transactions newest-first until we reach the cursor.
  const fresh: string[] = [];
  let foundCursor = index.cursor === null;
  try {
    for (let page = 1; ; page++) {
      const txs = await bfGet<Array<{ tx_hash: string }>>(
        `/addresses/${wallet}/transactions?order=desc&count=${PAGE_SIZE}&page=${page}`
      );
      for (const { tx_hash } of txs ?? []) {
        if (tx_hash === index.cursor) { foundCursor = true; break; }
        fresh.push(tx_hash);
      }
      if (foundCursor && index.cursor !== null) break;
      if (!txs || txs.length < PAGE_SIZE) break;
    }
  } catch (e) {
    return { index, error: `Wallet fetch: ${(e as Error).message}`, newTxs: 0 };
  }

  // The cursor tx vanished (chain rollback) — the full list was collected
  // while looking for it, so rebuild from scratch.
  if (!foundCursor) {
    console.warn('[ChainIndex] Cursor not found on chain — rebuilding index');
    index = emptyIndex(wallet);
  }

  // 2. Read metadata for new txs, oldest first, saving after each batch.
  fresh.reverse();
  let processed = 0;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(h => bfGet<any[]>(`/txs/${h}/metadata`)));
    // Apply in order and stop at the first failure, so the cursor never
    // skips past a transaction we haven't read.
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === 'rejected') {
        await save();
        return { index, error: `Metadata fetch: ${(r.reason as Error)?.message ?? r.reason}`, newTxs: processed };
      }
      applyMetadata(index, batch[j], r.value);
      index.cursor = batch[j];
      processed++;
    }
    await save();
  }

  if (processed > 0) console.log(`[ChainIndex] Indexed ${processed} new transaction(s)`);
  else if (!foundCursor) await save();
  return { index, error: null, newTxs: processed };
}
