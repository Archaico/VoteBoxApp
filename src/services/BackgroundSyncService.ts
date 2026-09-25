// src/services/BackgroundSyncService.ts
//
// Phase 2 background polling — runs every ~15 min even when app is closed.
// Lightweight: one Blockfrost wallet-address lookup + batched metadata fetch.
// No IPFS calls — keeps well within the 30-second background task budget.
//
// Android: reliable ~15 min interval via WorkManager.
// iOS:     OS-controlled (may vary, not guaranteed). Requires UIBackgroundModes
//          fetch in app.json (already added).
// Expo Go: does NOT run background tasks — requires a dev/preview build.

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TREASURY_CONFIG } from './TreasuryService';
import { notificationService } from './NotificationService';
import { cidRegistryService } from './CIDRegistryService';

const TASK_NAME    = 'VOTEBOX_BACKGROUND_SYNC';
const SUBS_KEY     = '@subscribed_proposals';
const LAST_CID_KEY = '@last_comment_cid';

// Diagnostic keys — surfaced in the UI (SyncDiagnosticBadge) so "is the OS
// actually running my background task at all" is answerable from evidence
// instead of guesswork. Added 2026-08-23 after ruling out Samsung battery
// saver as the cause of missing cross-user notifications.
const REGISTRATION_KEY = '@background_sync_registration';
const LAST_RUN_KEY     = '@background_sync_last_run';

export interface SyncDiagnostics {
  registeredAt:       number | null;
  registrationStatus: string | null; // BackgroundFetch.BackgroundFetchStatus name at registration time
  lastRunAt:          number | null;
  lastRunResult:      'success' | 'failed' | null;
  lastRunError:       string | null;
  lastRunSubCount:    number | null;
}

export async function getSyncDiagnostics(): Promise<SyncDiagnostics> {
  const [regRaw, runRaw] = await Promise.all([
    AsyncStorage.getItem(REGISTRATION_KEY),
    AsyncStorage.getItem(LAST_RUN_KEY),
  ]);
  const reg = regRaw ? JSON.parse(regRaw) : {};
  const run = runRaw ? JSON.parse(runRaw) : {};
  return {
    registeredAt:       reg.timestamp ?? null,
    registrationStatus: reg.status ?? null,
    lastRunAt:          run.timestamp ?? null,
    lastRunResult:      run.result ?? null,
    lastRunError:       run.error ?? null,
    lastRunSubCount:    run.subCount ?? null,
  };
}

const BLOCKFROST_URL = TREASURY_CONFIG.BLOCKFROST_API_URL;
const BLOCKFROST_ID  = TREASURY_CONFIG.BLOCKFROST_PROJECT_ID;
const FOUNDATION_WALLET = TREASURY_CONFIG.FOUNDATION_WALLET;

const LABEL_VOTE = 1337;

// ── Task Definition (must live at module top level) ──────────────────────────
// This runs in a headless JS context — no UI, minimal APIs available.

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const subCount = await runSync();
    await recordLastRun({ result: 'success', subCount });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.warn('[BackgroundSync] Task failed:', e);
    await recordLastRun({ result: 'failed', error: e instanceof Error ? e.message : String(e) });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function recordLastRun(data: { result: 'success' | 'failed'; subCount?: number; error?: string }): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify({ timestamp: Date.now(), ...data }));
  } catch {
    // Diagnostic write failure shouldn't crash the background task
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    const statusName = statusToName(status);
    await AsyncStorage.setItem(REGISTRATION_KEY, JSON.stringify({ timestamp: Date.now(), status: statusName }));

    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      console.log('[BackgroundSync] Not available on this device:', statusName);
      return;
    }

    const already = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!already) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: 15 * 60, // 15 minutes
        stopOnTerminate: false,   // Android: keep running after app is killed
        startOnBoot: true,        // Android: restart after device reboot
      });
      console.log('[BackgroundSync] Task registered');
    }
  } catch (e) {
    console.warn('[BackgroundSync] Registration failed:', e);
    await AsyncStorage.setItem(REGISTRATION_KEY, JSON.stringify({
      timestamp: Date.now(),
      status: `error: ${e instanceof Error ? e.message : String(e)}`,
    })).catch(() => {});
  }
}

function statusToName(status: BackgroundFetch.BackgroundFetchStatus | null): string {
  switch (status) {
    case BackgroundFetch.BackgroundFetchStatus.Available:  return 'Available';
    case BackgroundFetch.BackgroundFetchStatus.Restricted: return 'Restricted';
    case BackgroundFetch.BackgroundFetchStatus.Denied:     return 'Denied';
    default: return `Unknown (${status})`;
  }
}

// ── Core Sync Logic ───────────────────────────────────────────────────────────

async function runSync(): Promise<number> {
  // 1. Load subscribed proposals — bail early if none
  const rawSubs = await AsyncStorage.getItem(SUBS_KEY);
  if (!rawSubs) return 0;

  const subs: Record<string, { role: string; title: string; deadline: number }> =
    JSON.parse(rawSubs);
  const subIds = Object.keys(subs);
  if (subIds.length === 0) return 0;

  // 2. Fetch recent foundation wallet transactions (for vote counts).
  //    Comment detection (step 5) uses Firestore, not this, so a Blockfrost
  //    hiccup here shouldn't also block comment notifications.
  const txs = await bfGet<any[]>(
    `/addresses/${FOUNDATION_WALLET}/transactions?order=desc&count=100`
  ).catch(() => null);

  // 3. Batch-fetch metadata (max 50 txs, batches of 10)
  const metaResults: Array<{ txHash: string; meta: Record<number, any> }> = [];
  const BATCH = 10;
  for (let i = 0; i < Math.min(txs?.length ?? 0, 50); i += BATCH) {
    const settled = await Promise.allSettled(
      txs!.slice(i, i + BATCH).map(async tx => ({
        txHash: tx.tx_hash,
        meta:   await fetchTxMeta(tx.tx_hash),
      }))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') metaResults.push(r.value);
    }
  }

  // 4. Aggregate vote counts (label 1337) for subscribed proposals
  const voteCounts: Record<string, { yes: number; no: number; abstain: number }> = {};
  for (const { meta } of metaResults) {
    const m = meta[LABEL_VOTE];
    if (!m?.proposalId || !m?.choice || m?.type !== 'vote') continue;
    if (!subIds.includes(m.proposalId)) continue;
    const pid: string = m.proposalId;
    if (!voteCounts[pid]) voteCounts[pid] = { yes: 0, no: 0, abstain: 0 };
    const c = (m.choice as string).toLowerCase();
    if (c === 'yes' || c === 'no' || c === 'abstain') voteCounts[pid][c as 'yes' | 'no' | 'abstain']++;
  }

  // 5. Get latest comment CIDs from the Firestore registry — this is the
  //    live, per-comment signal (updated on every post via cidRegistryService
  //    .setCID). The on-chain label-1338 CID only gets written once, when a
  //    proposal closes, so it can't detect new comments while voting is open.
  const cidEntries = await Promise.allSettled(
    subIds.map(async id => ({ id, cid: await cidRegistryService.getCID(id) }))
  );
  const latestCids: Record<string, string> = {};
  for (const r of cidEntries) {
    if (r.status === 'fulfilled' && r.value.cid) latestCids[r.value.id] = r.value.cid;
  }

  // 6. Load previously stored comment CIDs
  const rawCids = await AsyncStorage.getItem(LAST_CID_KEY);
  const lastCids: Record<string, string> = rawCids ? JSON.parse(rawCids) : {};
  let cidsChanged = false;

  const now = Date.now();

  // 7. Process each subscribed proposal
  for (const proposalId of subIds) {
    const sub = subs[proposalId];

    if (sub.deadline <= now) {
      // Proposal past deadline → fire result notification (guarded internally against double-fire)
      const vc = voteCounts[proposalId] ?? { yes: 0, no: 0, abstain: 0 };
      await notificationService.notifyProposalFinalised(proposalId, sub.title, vc.yes, vc.no);
    } else {
      // Still active → check for new comments via CID change
      const newCid  = latestCids[proposalId];
      const prevCid = lastCids[proposalId];

      if (newCid && newCid !== prevCid) {
        // subscribeToProposal() seeds a baseline CID at subscribe time, so by
        // the time this runs, prevCid reflects "what existed when I joined" —
        // any difference from that is a genuinely new comment, first check or not.
        await notificationService.notifyNewComment(proposalId, sub.title);
        lastCids[proposalId] = newCid;
        cidsChanged = true;
      }
    }
  }

  if (cidsChanged) {
    await AsyncStorage.setItem(LAST_CID_KEY, JSON.stringify(lastCids));
  }

  return subIds.length;
}

// ── Blockfrost Helpers ────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function bfGet<T>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await fetchWithTimeout(
    `${BLOCKFROST_URL}${path}`,
    { headers: { project_id: BLOCKFROST_ID } },
    timeoutMs
  );
  if (!res.ok) throw new Error(`Blockfrost ${path} → ${res.status}`);
  return res.json();
}

async function fetchTxMeta(txHash: string): Promise<Record<number, any>> {
  try {
    const entries = await bfGet<any[]>(`/txs/${txHash}/metadata`, 5000);
    return Object.fromEntries((entries ?? []).map((e: any) => [e.label, e.json_metadata]));
  } catch {
    return {};
  }
}
