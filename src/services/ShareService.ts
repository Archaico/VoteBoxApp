// src/services/ShareService.ts
//
// VoteBox ShareService — Democratic Amplification Engine
// ─────────────────────────────────────────────────────────────────────────────
// Handles all sharing touchpoints in the VoteBox user journey:
//
//   1. POST-CREATION    → Invite specific people to vote on your proposal
//   2. POST-VOTE        → "I voted" social proof — recruits new voters
//   3. RESULTS          → Share final outcome to all participants
//   4. URGENCY          → "Vote closes soon" — deadline recruitment share
//   5. DISCOVERY        → Share any proposal from the list to someone new
//
// Uses React Native's native Share API — opens the system share sheet
// which handles WhatsApp, Telegram, Signal, Twitter, Email, SMS, etc.
// No platform-specific SDK integrations required.
//
// Deep link format (future): votebox://proposal/{id}
// Web fallback (future):     https://votebox.app/proposal/{id}
// ─────────────────────────────────────────────────────────────────────────────

import { Share, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareableProposal {
  id: string;
  title: string;
  description: string;
  deadline: number;
  totalVotes: number;
  results?: Record<string, number>;
  creator?: string;
}

export interface ShareResult {
  success: boolean;
  action?: string;  // 'sharedAction' | 'dismissedAction'
  error?: string;
}

// ─── Share Service ────────────────────────────────────────────────────────────

class ShareService {
  private static instance: ShareService;
  private readonly SHARE_LOG_KEY = '@share_log';

  static getInstance(): ShareService {
    if (!ShareService.instance) {
      ShareService.instance = new ShareService();
    }
    return ShareService.instance;
  }

  // ── 1. POST-CREATION: Invite Voters ────────────────────────────────────────
  // Called immediately after a proposal is successfully published.
  // Primary viral loop — creator invites their community to vote.

  async shareProposalInvite(proposal: ShareableProposal): Promise<ShareResult> {
    const deadline = new Date(proposal.deadline);
    const daysLeft = Math.ceil((proposal.deadline - Date.now()) / (1000 * 60 * 60 * 24));
    const deadlineStr = deadline.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const message = [
      `🗳️ YOUR VOTE IS NEEDED`,
      ``,
      `"${proposal.title}"`,
      ``,
      `${proposal.description.slice(0, 150)}${proposal.description.length > 150 ? '...' : ''}`,
      ``,
      `⏰ Voting closes: ${deadlineStr} (${daysLeft} day${daysLeft !== 1 ? 's' : ''} left)`,
      `🔒 Secured on Cardano blockchain`,
      `✅ Completely free to vote — no wallet needed`,
      ``,
      `Vote now on VoteBox:`,
      `votebox://proposal/${proposal.id}`,
      ``,
      `— Shared via VoteBox · Free democratic voting for everyone`,
    ].join('\n');

    return this.executeShare({
      message,
      title: `Vote on: ${proposal.title}`,
      type: 'proposal_invite',
      proposalId: proposal.id,
    });
  }

  // ── 2. POST-VOTE: Social Proof Share ───────────────────────────────────────
  // Called after a successful vote submission.
  // Optional — shown as a gentle prompt, never forced.
  // Recruits new voters and raises awareness of VoteBox.

  async shareVoteConfirmation(
    proposal: ShareableProposal,
    choiceVoted: string
  ): Promise<ShareResult> {
    const daysLeft = Math.ceil((proposal.deadline - Date.now()) / (1000 * 60 * 60 * 24));
    const timeStr = daysLeft > 0
      ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left to vote`
      : 'Voting has closed';

    const message = [
      `✊ I just voted on VoteBox`,
      ``,
      `"${proposal.title}"`,
      ``,
      `${timeStr} — add your voice:`,
      `votebox://proposal/${proposal.id}`,
      ``,
      `🔒 Blockchain-secured · 100% free · No wallet needed`,
      `— VoteBox: Democratic voting for everyone`,
    ].join('\n');

    return this.executeShare({
      message,
      title: `I voted: ${proposal.title}`,
      type: 'vote_confirmation',
      proposalId: proposal.id,
    });
  }

  // ── 3. RESULTS: Share Final Outcome ────────────────────────────────────────
  // Called when viewing final results, or triggered by push notification.
  // Shows the complete vote breakdown in a readable format.

  async shareResults(proposal: ShareableProposal): Promise<ShareResult> {
    if (!proposal.results || Object.keys(proposal.results).length === 0) {
      return { success: false, error: 'No results available yet' };
    }

    const totalVotes = Object.values(proposal.results).reduce(
      (sum, v) => sum + (v as number), 0
    );

    if (totalVotes === 0) {
      return { success: false, error: 'No votes recorded yet' };
    }

    // Find winner
    const winner = Object.entries(proposal.results).reduce(
      (a, b) => (b[1] as number) > (a[1] as number) ? b : a
    );
    const winnerPct = ((winner[1] as number) / totalVotes * 100).toFixed(1);

    // Build results breakdown
    const breakdown = Object.entries(proposal.results)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([option, votes]) => {
        const pct = ((votes as number) / totalVotes * 100).toFixed(1);
        const bar = this.buildTextBar(parseFloat(pct));
        return `${bar} ${option}: ${votes} votes (${pct}%)`;
      })
      .join('\n');

    const message = [
      `📊 VOTING RESULTS`,
      ``,
      `"${proposal.title}"`,
      ``,
      `🏆 Leading: "${winner[0]}" with ${winnerPct}%`,
      ``,
      breakdown,
      ``,
      `Total votes cast: ${totalVotes}`,
      `🔒 Verified on Cardano blockchain`,
      ``,
      `See full results on VoteBox:`,
      `votebox://proposal/${proposal.id}`,
      ``,
      `— VoteBox: Transparent, free democratic voting`,
    ].join('\n');

    return this.executeShare({
      message,
      title: `Results: ${proposal.title}`,
      type: 'results',
      proposalId: proposal.id,
    });
  }

  // ── 4. URGENCY: Deadline Recruitment Share ─────────────────────────────────
  // Shown when a proposal is within 48 hours of closing.
  // "This vote closes soon — share to get more voices in."

  async shareUrgentVote(proposal: ShareableProposal): Promise<ShareResult> {
    const hoursLeft = Math.ceil((proposal.deadline - Date.now()) / (1000 * 60 * 60));
    const urgencyStr = hoursLeft <= 1
      ? '⚡ LESS THAN 1 HOUR LEFT'
      : hoursLeft <= 24
      ? `⚡ ${hoursLeft} HOURS LEFT`
      : `⏰ ${Math.ceil(hoursLeft / 24)} DAYS LEFT`;

    const message = [
      `${urgencyStr} TO VOTE`,
      ``,
      `"${proposal.title}"`,
      ``,
      `${proposal.totalVotes} ${proposal.totalVotes === 1 ? 'person has' : 'people have'} voted so far.`,
      `Your voice still counts — vote now:`,
      ``,
      `votebox://proposal/${proposal.id}`,
      ``,
      `✅ Free · No wallet needed · Takes 10 seconds`,
      `— VoteBox: Democratic voting on the blockchain`,
    ].join('\n');

    return this.executeShare({
      message,
      title: `Urgent: Vote on "${proposal.title}"`,
      type: 'urgency',
      proposalId: proposal.id,
    });
  }

  // ── 5. DISCOVERY: Share from Proposal List ─────────────────────────────────
  // General-purpose share for any proposal from anywhere in the app.
  // Used for long-press on proposal cards, or a share icon.

  async shareProposalDiscovery(proposal: ShareableProposal): Promise<ShareResult> {
    const isActive = proposal.deadline > Date.now();
    const statusStr = isActive
      ? `🟢 Voting is OPEN`
      : `🔴 Voting has closed`;

    const message = [
      `🗳️ Check out this proposal on VoteBox`,
      ``,
      `"${proposal.title}"`,
      ``,
      `${proposal.description.slice(0, 200)}${proposal.description.length > 200 ? '...' : ''}`,
      ``,
      statusStr,
      isActive ? `✅ Free to vote — no wallet or account needed` : `📊 See the final results`,
      ``,
      `votebox://proposal/${proposal.id}`,
      ``,
      `— VoteBox: Free, open, blockchain-secured voting`,
    ].join('\n');

    return this.executeShare({
      message,
      title: proposal.title,
      type: 'discovery',
      proposalId: proposal.id,
    });
  }

  // ── Core Share Executor ─────────────────────────────────────────────────────

  private async executeShare(options: {
    message: string;
    title: string;
    type: string;
    proposalId: string;
  }): Promise<ShareResult> {
    try {
      const result = await Share.share(
        {
          message: options.message,
          title: options.title,
          // url — iOS only, shows a preview card
          ...(Platform.OS === 'ios' && {
            url: `https://votebox.app/proposal/${options.proposalId}`,
          }),
        },
        {
          dialogTitle: options.title, // Android share sheet title
          subject: options.title,     // Email subject line
        }
      );

      await this.logShare(options.type, options.proposalId, result.action);

      return {
        success: result.action === Share.sharedAction,
        action: result.action,
      };
    } catch (error) {
      console.error('[ShareService] Share failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Share failed',
      };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Simple ASCII progress bar for text-based results sharing
  private buildTextBar(percentage: number): string {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
  }

  // Log shares for analytics — which touchpoints drive most engagement
  private async logShare(type: string, proposalId: string, action?: string): Promise<void> {
    try {
      const logStr = await AsyncStorage.getItem(this.SHARE_LOG_KEY);
      const log = logStr ? JSON.parse(logStr) : [];
      log.push({
        type,
        proposalId,
        action,
        timestamp: Date.now(),
      });
      // Keep last 200 share events
      await AsyncStorage.setItem(
        this.SHARE_LOG_KEY,
        JSON.stringify(log.slice(-200))
      );
    } catch (error) {
      console.error('[ShareService] Log failed:', error);
    }
  }

  // Get share stats — useful for analytics dashboard later
  async getShareStats(): Promise<{
    totalShares: number;
    byType: Record<string, number>;
    mostSharedProposalId: string | null;
  }> {
    try {
      const logStr = await AsyncStorage.getItem(this.SHARE_LOG_KEY);
      const log: any[] = logStr ? JSON.parse(logStr) : [];

      const completed = log.filter(e => e.action === Share.sharedAction);
      const byType: Record<string, number> = {};
      const byProposal: Record<string, number> = {};

      completed.forEach(e => {
        byType[e.type] = (byType[e.type] || 0) + 1;
        byProposal[e.proposalId] = (byProposal[e.proposalId] || 0) + 1;
      });

      const mostShared = Object.entries(byProposal).sort(
        (a, b) => b[1] - a[1]
      )[0];

      return {
        totalShares: completed.length,
        byType,
        mostSharedProposalId: mostShared ? mostShared[0] : null,
      };
    } catch {
      return { totalShares: 0, byType: {}, mostSharedProposalId: null };
    }
  }
}

export const shareService = ShareService.getInstance();
