// src/services/BackgroundSyncService.ts
//
// Phase 2 background polling — runs every ~15 min even when app is closed.
// Lightweight: reads only new Foundation wallet transactions (ChainIndex).
// No IPFS calls — keeps well within the 30-second background task budget.
//
// Android: reliable ~15 min interval via WorkManager.
// iOS:     OS-controlled (may vary, not guaranteed). Requires UIBackgroundModes
//          fetch in app.json (already added).
// Expo Go: does NOT run background tasks — requires a dev/preview build.

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncChainIndex, getChainIndex } from './ChainIndex';
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

  // 2–4. Bring the shared chain index up to date (only new transactions are
  //    read) and take the full vote tallies from it. Comment detection
  //    (step 5) uses Firestore, not this, so a Blockfrost hiccup here
  //    shouldn't also block comment notifications.
  const { index } = await syncChainIndex().catch(async () => ({ index: await getChainIndex() }));
  const voteCounts = index.votes;

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
        // New-comment alerts now come from the notifyNewComment Cloud Function
        // (server push, which skips the author). Only track the CID here.
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
