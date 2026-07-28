// src/services/DiscordService.ts
//
// Sends VoteBox governance events to a Discord Forum channel via webhook.
// One Forum thread per proposal — comments and the close notification post
// into that thread using the thread ID returned at creation.
//
// All methods are fire-and-forget — failures are logged but never thrown.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DISCORD_CONFIG } from '../config/discord';

// Use import type to avoid circular runtime dependencies
import type { Proposal } from './BlockchainService';
import type { Comment } from './DiscussionService';

// ─── Embed colours ────────────────────────────────────────────────────────────

const COLOR = {
  PROPOSAL: 0x5865f2, // Discord blurple — new proposal
  COMMENT:  0x57f287, // Discord green   — new comment
  CLOSED:   0xfee75c, // Discord yellow  — voting closed
};

// ─── DiscordService ───────────────────────────────────────────────────────────

class DiscordService {

  private threadKey(proposalId: string): string {
    return `@discord_thread_${proposalId}`;
  }

  private async getThreadId(proposalId: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(this.threadKey(proposalId));
    } catch {
      return null;
    }
  }

  private async saveThreadId(proposalId: string, threadId: string): Promise<void> {
    try {
      await AsyncStorage.setItem(this.threadKey(proposalId), threadId);
    } catch {}
  }

  private async post(url: string, payload: object): Promise<any> {
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord ${response.status}: ${text}`);
    }
    const ct = response.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? response.json() : null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  // Creates a Forum thread for a new proposal. Call after createProposal().
  async postNewProposal(proposal: Proposal, cid: string, txHash: string): Promise<void> {
    if (!DISCORD_CONFIG.ENABLED || !DISCORD_CONFIG.FORUM_WEBHOOK_URL) return;
    try {
      const deadline    = new Date(proposal.deadline).toDateString();
      const threadName  = `📋 ${proposal.title}`.slice(0, 100);
      const description = (proposal.description ?? '').slice(0, 500);

      const data = await this.post(`${DISCORD_CONFIG.FORUM_WEBHOOK_URL}?wait=true`, {
        thread_name: threadName,
        embeds: [{
          title:       '🗳️ New Proposal Open for Voting',
          description,
          color:       COLOR.PROPOSAL,
          fields: [
            { name: '⏰ Voting closes',   value: deadline,                              inline: true  },
            { name: '👥 Expected voters', value: String(proposal.expectedVoters ?? '—'), inline: true  },
            { name: '🔗 IPFS CID',        value: `\`${cid}\``,                          inline: false },
            { name: '⛓️ Cardano Tx',      value: `\`${txHash}\``,                       inline: false },
          ],
          footer:    { text: 'VoteBoxApp · Direct Democracy on Cardano' },
          timestamp: new Date(proposal.createdAt ?? Date.now()).toISOString(),
        }],
      });

      // channel_id on a Forum webhook response is the newly created thread's ID
      const threadId = data?.channel_id ?? data?.id;
      if (threadId) {
        await this.saveThreadId(proposal.id, String(threadId));
        console.log(`[DiscordService] Proposal thread created: ${threadId}`);
      }
    } catch (e) {
      console.warn('[DiscordService] postNewProposal failed:', e);
    }
  }

  // Posts a comment into the proposal's Forum thread. Call after addComment().
  async postComment(proposalId: string, comment: Comment): Promise<void> {
    if (!DISCORD_CONFIG.ENABLED || !DISCORD_CONFIG.FORUM_WEBHOOK_URL) return;
    try {
      const threadId = await this.getThreadId(proposalId);
      if (!threadId) {
        console.warn('[DiscordService] No thread for proposal — skipping comment post');
        return;
      }

      await this.post(`${DISCORD_CONFIG.FORUM_WEBHOOK_URL}?thread_id=${threadId}`, {
        embeds: [{
          description: comment.content.slice(0, 2000),
          color:       COLOR.COMMENT,
          author:      { name: `💬 ${comment.author.slice(0, 20)}` },
          footer:      { text: 'VoteBoxApp' },
          timestamp:   new Date(comment.timestamp).toISOString(),
        }],
      });
      console.log(`[DiscordService] Comment posted to thread ${threadId}`);
    } catch (e) {
      console.warn('[DiscordService] postComment failed:', e);
    }
  }

  // Posts final results into the proposal's Forum thread. Call at flush-on-close.
  async postProposalClosed(proposal: Proposal): Promise<void> {
    if (!DISCORD_CONFIG.ENABLED || !DISCORD_CONFIG.FORUM_WEBHOOK_URL) return;
    try {
      const threadId = await this.getThreadId(proposal.id);
      if (!threadId) {
        console.warn('[DiscordService] No thread for proposal — skipping close post');
        return;
      }

      const r       = proposal.results ?? {};
      const yes     = r['yes']     ?? r['Yes']     ?? 0;
      const no      = r['no']      ?? r['No']      ?? 0;
      const abstain = r['abstain'] ?? r['Abstain'] ?? 0;

      await this.post(`${DISCORD_CONFIG.FORUM_WEBHOOK_URL}?thread_id=${threadId}`, {
        embeds: [{
          title:  '📊 Voting Period Closed',
          color:  COLOR.CLOSED,
          fields: [
            { name: '✅ Yes',         value: String(yes),                inline: true  },
            { name: '❌ No',          value: String(no),                 inline: true  },
            { name: '🤷 Abstain',     value: String(abstain),            inline: true  },
            { name: '🗳️ Total votes', value: String(proposal.totalVotes), inline: false },
          ],
          footer:    { text: 'VoteBoxApp · Results recorded on Cardano' },
          timestamp: new Date().toISOString(),
        }],
      });
      console.log(`[DiscordService] Close notification posted to thread ${threadId}`);
    } catch (e) {
      console.warn('[DiscordService] postProposalClosed failed:', e);
    }
  }
}

export const discordService = new DiscordService();
