// src/services/NotificationService.ts
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { cidRegistryService } from './CIDRegistryService';

const SUBS_KEY   = '@subscribed_proposals';
const PREFS_KEY  = '@notification_prefs';
const FIRED_KEY  = '@notif_fired';
// Must match BackgroundSyncService.ts's LAST_CID_KEY — not imported directly
// to avoid a circular dependency (that file imports notificationService).
const LAST_CID_KEY = '@last_comment_cid';

interface SubscribedProposal {
  role: 'creator' | 'voter' | 'commenter';
  title: string;
  deadline: number;
  notifIds: { h24?: string; h1?: string };
}

type SubscriptionMap = Record<string, SubscribedProposal>;

interface NotificationPrefs {
  enabled: boolean;
  deadlineReminders: boolean;
  voteConfirmations: boolean;
  results: boolean;
  comments: boolean;
  filterTags: string[]; // reserved for future hashtag filtering
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  deadlineReminders: true,
  voteConfirmations: true,
  results: true,
  comments: true,
  filterTags: [],
};

// Show notifications when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

class NotificationService {
  private static instance: NotificationService;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // ── Permissions ────────────────────────────────────────────────────────

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'VoteBoxApp',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  }

  // ── Preferences ────────────────────────────────────────────────────────

  async getPrefs(): Promise<NotificationPrefs> {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      if (!raw) return DEFAULT_PREFS;
      return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_PREFS;
    }
  }

  async updatePrefs(partial: Partial<NotificationPrefs>): Promise<void> {
    const current = await this.getPrefs();
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...partial }));
  }

  // ── Subscriptions ──────────────────────────────────────────────────────

  async subscribeToProposal(
    proposalId: string,
    role: 'creator' | 'voter' | 'commenter',
    deadline: number,
    title: string
  ): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs.enabled) return;

    const subs = await this.getSubs();
    const roleRank: Record<string, number> = { creator: 3, voter: 2, commenter: 1 };

    if (subs[proposalId]) {
      // Only upgrade role; cancel old reminders before rescheduling
      if (roleRank[role] <= roleRank[subs[proposalId].role]) return;
      await this.cancelDeadlineNotifs(subs[proposalId]);
    }

    const notifIds = await this.scheduleDeadlineReminders(proposalId, deadline, title, prefs);
    subs[proposalId] = { role, title, deadline, notifIds };
    await this.saveSubs(subs);
    await this.seedCommentBaseline(proposalId);
  }

  // Records whatever comment CID exists right now as the baseline for this
  // proposal, so BackgroundSyncService's next check can tell "existed before
  // I subscribed" apart from "genuinely new" — without this, the very first
  // comment detected after subscribing was silently swallowed.
  private async seedCommentBaseline(proposalId: string): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(LAST_CID_KEY);
      const lastCids: Record<string, string> = raw ? JSON.parse(raw) : {};
      if (proposalId in lastCids) return; // already has a baseline — don't overwrite
      const currentCid = await cidRegistryService.getCID(proposalId);
      lastCids[proposalId] = currentCid ?? '';
      await AsyncStorage.setItem(LAST_CID_KEY, JSON.stringify(lastCids));
    } catch {
      // best-effort — worst case, background sync re-establishes its own baseline
    }
  }

  private async scheduleDeadlineReminders(
    proposalId: string,
    deadline: number,
    title: string,
    prefs: NotificationPrefs
  ): Promise<{ h24?: string; h1?: string }> {
    const ids: { h24?: string; h1?: string } = {};
    if (!prefs.deadlineReminders || deadline <= 0) return ids;

    const now = Date.now();
    const h24 = deadline - 24 * 60 * 60 * 1000;
    const h1  = deadline -      60 * 60 * 1000;
    const body = title.length > 50 ? title.slice(0, 47) + '...' : title;

    try {
      if (h24 > now) {
        ids.h24 = await Notifications.scheduleNotificationAsync({
          content: { title: 'Voting closes in 24 hours', body, data: { proposalId, type: 'deadline_24h' } },
          trigger: { date: new Date(h24) } as any,
        });
      }
      if (h1 > now) {
        ids.h1 = await Notifications.scheduleNotificationAsync({
          content: { title: 'Voting closes in 1 hour', body, data: { proposalId, type: 'deadline_1h' } },
          trigger: { date: new Date(h1) } as any,
        });
      }
    } catch (e) {
      console.warn('[NotificationService] Failed to schedule deadline reminders:', e);
    }

    return ids;
  }

  private async cancelDeadlineNotifs(sub: SubscribedProposal): Promise<void> {
    try {
      if (sub.notifIds.h24) await Notifications.cancelScheduledNotificationAsync(sub.notifIds.h24);
      if (sub.notifIds.h1)  await Notifications.cancelScheduledNotificationAsync(sub.notifIds.h1);
    } catch { /* ignore — notification may have already fired */ }
  }

  // ── Immediate Notifications ────────────────────────────────────────────

  async notifyVoteSubmitted(proposalTitle: string): Promise<void> {
    if (!(await this.isEnabled('voteConfirmations'))) return;
    await this.send('Vote submitted', proposalTitle, { type: 'vote_submitted' });
  }

  async notifyVoteConfirmed(proposalTitle: string, txHash: string): Promise<void> {
    if (!(await this.isEnabled('voteConfirmations'))) return;
    const short = proposalTitle.length > 35 ? proposalTitle.slice(0, 32) + '...' : proposalTitle;
    await this.send('Vote confirmed on-chain', `${short} · TX: ${txHash.slice(0, 12)}...`, { type: 'vote_confirmed' });
  }

  async notifyProposalLive(proposalTitle: string): Promise<void> {
    if (!(await this.isEnabled())) return;
    await this.send('Your proposal is live', proposalTitle, { type: 'proposal_live' });
  }

  async notifyCommentPosted(proposalTitle: string): Promise<void> {
    if (!(await this.isEnabled('comments'))) return;
    await this.send('Comment posted', proposalTitle, { type: 'comment_posted' });
  }

  async notifyNewComment(proposalTitle: string): Promise<void> {
    if (!(await this.isEnabled('comments'))) return;
    await this.send('New comment on proposal', proposalTitle, { type: 'new_comment' });
  }

  async notifyProposalFinalised(
    proposalId: string,
    proposalTitle: string,
    yes: number,
    no: number
  ): Promise<void> {
    if (!(await this.isEnabled('results'))) return;

    // Guard: only fire once per proposal
    const alreadyFired = await AsyncStorage.getItem(`${FIRED_KEY}_${proposalId}`);
    if (alreadyFired) return;
    await AsyncStorage.setItem(`${FIRED_KEY}_${proposalId}`, '1');

    const passed = yes > no;
    const short  = proposalTitle.length > 35 ? proposalTitle.slice(0, 32) + '...' : proposalTitle;
    await this.send(
      passed ? 'Proposal PASSED' : 'Proposal ended',
      `${short} · Yes: ${yes} / No: ${no}`,
      { type: 'proposal_finalised', proposalId, passed }
    );

    // Cancel any pending deadline reminders — no longer relevant
    const subs = await this.getSubs();
    if (subs[proposalId]) await this.cancelDeadlineNotifs(subs[proposalId]);
  }

  async notifyLowBalance(): Promise<void> {
    if (!(await this.isEnabled())) return;
    await this.send('Low ADA balance', 'Balance below 1.5 ADA — top up to create proposals', { type: 'low_balance' });
  }

  async notifyTxFailed(context?: string): Promise<void> {
    if (!(await this.isEnabled())) return;
    await this.send('Transaction failed', context ?? 'Please retry your last action', { type: 'tx_failed' });
  }

  // ── Finalised Proposals Check ──────────────────────────────────────────
  // Call this whenever proposals are loaded. Detects subscribed proposals that
  // have passed their deadline and fires result notifications.

  async checkFinalisedProposals(
    proposals: Array<{
      id: string;
      title: string;
      deadline: number;
      results?: Record<string, number>;
    }>
  ): Promise<void> {
    const subs = await this.getSubs();
    const now  = Date.now();

    for (const p of proposals) {
      if (!subs[p.id] || p.deadline > now) continue;
      const r  = p.results ?? {};
      const yes = (r['yes'] ?? r['Yes'] ?? 0);
      const no  = (r['no']  ?? r['No']  ?? 0);
      await this.notifyProposalFinalised(p.id, p.title, yes, no);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async isEnabled(pref?: keyof Omit<NotificationPrefs, 'filterTags'>): Promise<boolean> {
    const prefs = await this.getPrefs();
    if (!prefs.enabled) return false;
    if (pref && !(prefs[pref] as boolean)) return false;
    return true;
  }

  private async send(title: string, body: string, data: Record<string, unknown>): Promise<void> {
    try {
      const truncated = body.length > 60 ? body.slice(0, 57) + '...' : body;
      await Notifications.scheduleNotificationAsync({
        content: { title, body: truncated, data },
        trigger: null,
      });
    } catch (e) {
      console.warn('[NotificationService] send failed:', e);
    }
  }

  private async getSubs(): Promise<SubscriptionMap> {
    try {
      const raw = await AsyncStorage.getItem(SUBS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private async saveSubs(subs: SubscriptionMap): Promise<void> {
    await AsyncStorage.setItem(SUBS_KEY, JSON.stringify(subs));
  }
}

export const notificationService = NotificationService.getInstance();
