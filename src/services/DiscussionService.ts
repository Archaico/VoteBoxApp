// src/services/DiscussionService.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { cidRegistryService } from './CIDRegistryService';
import { discordService } from './DiscordService';

export interface Comment {
  id: string;
  proposalId: string;
  author: string;
  content: string;
  timestamp: number;
  replyTo?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const PINATA = {
  UPLOAD_URL: 'https://api.pinata.cloud/pinning/pinJSONToIPFS',
  JWT:        process.env.EXPO_PUBLIC_PINATA_JWT ?? '',
};

// Public fallback gateways (no auth, may have propagation delay)
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs',
  'https://dweb.link/ipfs',
];

// AbortSignal.timeout() is not available in Hermes — use AbortController instead
function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

// ─── DiscussionService ────────────────────────────────────────────────────────

class DiscussionService {

  private readonly pendingUploadKey = '@pending_comment_uploads';

  // Each proposal gets its own scoped key — no cross-proposal bleed possible
  private storageKey(proposalId: string): string {
    return `@comments_${proposalId}`;
  }

  private cidKey(proposalId: string): string {
    return `@comment_cid_${proposalId}`;
  }

  // ── Offline Retry ───────────────────────────────────────────────────────────
  // Call once on app mount. Retries any failed IPFS uploads when connectivity returns.

  initializeOfflineRetry(): void {
    NetInfo.addEventListener(state => {
      if (state.isConnected) {
        this.retryPendingUploads().catch(() => {});
      }
    });
  }

  private async addToPendingUploads(proposalId: string): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(this.pendingUploadKey);
      const pending: string[] = raw ? JSON.parse(raw) : [];
      if (!pending.includes(proposalId)) {
        pending.push(proposalId);
        await AsyncStorage.setItem(this.pendingUploadKey, JSON.stringify(pending));
      }
    } catch {}
  }

  private async retryPendingUploads(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(this.pendingUploadKey);
      if (!raw) return;
      const pending: string[] = JSON.parse(raw);
      if (pending.length === 0) return;
      console.log(`[DiscussionService] Retrying ${pending.length} pending IPFS uploads`);
      const succeeded: string[] = [];
      for (const proposalId of pending) {
        const comments = await this.getComments(proposalId);
        const cid = await this.uploadCommentsToIPFS(proposalId, comments);
        if (cid) succeeded.push(proposalId);
      }
      const remaining = pending.filter(id => !succeeded.includes(id));
      await AsyncStorage.setItem(this.pendingUploadKey, JSON.stringify(remaining));
    } catch {}
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async getComments(proposalId: string): Promise<Comment[]> {
    try {
      const stored = await AsyncStorage.getItem(this.storageKey(proposalId));
      if (!stored) return [];
      const comments: Comment[] = JSON.parse(stored);
      return comments.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.error('[DiscussionService] getComments error:', error);
      return [];
    }
  }

  async getCommentCount(proposalId: string): Promise<number> {
    try {
      const comments = await this.getComments(proposalId);
      return comments.length;
    } catch {
      return 0;
    }
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  async addComment(comment: Omit<Comment, 'id'>): Promise<string> {
    const id = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newComment: Comment = { ...comment, id };

    // Save locally first — never block the UI on network
    const existing = await this.getComments(comment.proposalId);
    existing.push(newComment);
    await AsyncStorage.setItem(
      this.storageKey(comment.proposalId),
      JSON.stringify(existing)
    );
    console.log(`[DiscussionService] Comment saved locally: ${id}`);

    // Upload to IPFS in background — fire and forget
    this.uploadCommentsToIPFS(comment.proposalId, existing).catch(err =>
      console.warn('[DiscussionService] Background IPFS upload failed:', err)
    );

    // Post to Discord in background — fire and forget
    discordService.postComment(comment.proposalId, newComment).catch(() => {});

    return id;
  }

  async deleteComment(proposalId: string, commentId: string): Promise<void> {
    const comments = await this.getComments(proposalId);
    const filtered = comments.filter(c => c.id !== commentId);
    await AsyncStorage.setItem(this.storageKey(proposalId), JSON.stringify(filtered));

    // Upload updated thread to IPFS in background
    this.uploadCommentsToIPFS(proposalId, filtered).catch(err =>
      console.warn('[DiscussionService] Background IPFS upload failed:', err)
    );
  }

  async clearProposalComments(proposalId: string): Promise<void> {
    await AsyncStorage.removeItem(this.storageKey(proposalId));
    await AsyncStorage.removeItem(this.cidKey(proposalId));
  }

  // ── IPFS Upload ─────────────────────────────────────────────────────────────
  // Uploads the full comment thread for a proposal to IPFS via Storacha.
  // Stores the resulting CID locally and in the Firestore registry for live
  // cross-device sync. When a proposal closes, BlockchainService calls
  // getFinalCommentCID() and registers the CID on Cardano (label 1338) as the
  // permanent archival record.

  // Returns the final comment CID for a closed proposal. Called by
  // BlockchainService.flushClosedProposalComments() at flush-on-close time.
  async getFinalCommentCID(proposalId: string): Promise<string | null> {
    const comments = await this.getComments(proposalId);
    return this.uploadCommentsToIPFS(proposalId, comments);
  }

  async uploadCommentsToIPFS(proposalId: string, comments: Comment[]): Promise<string | null> {
    try {
      const response = await fetch(PINATA.UPLOAD_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${PINATA.JWT}`,
        },
        body: JSON.stringify({
          pinataContent:  { proposalId, comments, uploadedAt: Date.now() },
          pinataMetadata: { name: `votebox-comments-${proposalId}` },
        }),
      });

      if (!response.ok) {
        console.warn(`[DiscussionService] Pinata upload failed: ${response.status}`);
        return null;
      }

      const result = await response.json();
      const cid: string = result.IpfsHash;
      if (!cid) {
        console.warn('[DiscussionService] No IpfsHash in Pinata response');
        await this.addToPendingUploads(proposalId);
        return null;
      }

      await AsyncStorage.setItem(this.cidKey(proposalId), cid);
      cidRegistryService.setCID(proposalId, cid).catch(() => {});
      console.log(`[DiscussionService] Comments uploaded to IPFS: ${cid}`);
      return cid;
    } catch (error) {
      console.warn('[DiscussionService] IPFS upload failed:', error);
      await this.addToPendingUploads(proposalId);
      return null;
    }
  }

  // ── Cross-Device Sync ───────────────────────────────────────────────────────
  // Call this at the top of DiscussionsScreen useEffect, before getComments().
  //
  // Flow:
  //  1. Look up the latest comment thread CID for this proposal on Cardano
  //     via Blockfrost metadata label 1338 (the authoritative source).
  //  2. Fall back to the locally cached CID if Blockfrost has nothing yet
  //     (covers testnet where real txs aren't submitted yet).
  //  3. Fetch the comment thread JSON from IPFS via gateway fallback chain.
  //  4. Merge remote comments with local — deduplicate by comment.id.
  //  5. Write merged result back to AsyncStorage.

  async syncFromIPFS(proposalId: string): Promise<void> {
    try {
      console.log(`[DiscussionService] Starting sync for proposal ${proposalId}`);

      // Step 1: Try Firestore registry — primary cross-device discovery
      const registryCid = await cidRegistryService.getCID(proposalId);

      // Step 2: Fall back to locally cached CID
      const cid = registryCid || await AsyncStorage.getItem(this.cidKey(proposalId));

      if (!cid) {
        console.log('[DiscussionService] No CID found — nothing to sync yet');
        return;
      }

      // Step 3: Fetch from IPFS via gateway chain
      const remoteComments = await this.fetchCommentsFromIPFS(cid);
      if (!remoteComments || remoteComments.length === 0) {
        console.log('[DiscussionService] IPFS fetch returned no comments');
        return;
      }

      // Step 4: Merge with local — deduplicate by id
      const local = await this.getComments(proposalId);
      const localIds = new Set(local.map(c => c.id));
      const newComments = remoteComments.filter(c => !localIds.has(c.id));

      if (newComments.length === 0) {
        console.log('[DiscussionService] Already up to date');
        return;
      }

      // Step 5: Write merged result back
      const merged = [...local, ...newComments].sort((a, b) => a.timestamp - b.timestamp);
      await AsyncStorage.setItem(this.storageKey(proposalId), JSON.stringify(merged));
      console.log(`[DiscussionService] Sync complete — added ${newComments.length} new comments`);
    } catch (error) {
      // Sync is best-effort — never block the UI
      console.warn('[DiscussionService] Sync failed (non-fatal):', error);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async fetchCommentsFromIPFS(cid: string): Promise<Comment[] | null> {
    // Authenticated Pinata fetch — immediate, no propagation delay
    if (PINATA.JWT) {
      try {
        const response = await fetchWithTimeout(
          `https://gateway.pinata.cloud/ipfs/${cid}`,
          { headers: { 'Authorization': `Bearer ${PINATA.JWT}` } }
        );
        if (response.ok) {
          const data = await response.json();
          const comments: Comment[] = Array.isArray(data) ? data : (data.comments || []);
          if (Array.isArray(comments) && comments.length > 0) {
            console.log(`[DiscussionService] Fetched ${comments.length} comments from Pinata`);
            return comments;
          }
        }
      } catch {}
    }

    // Public gateway fallbacks
    for (const gateway of IPFS_GATEWAYS) {
      try {
        const response = await fetchWithTimeout(`${gateway}/${cid}`);
        if (!response.ok) continue;
        const data = await response.json();
        const comments: Comment[] = Array.isArray(data) ? data : (data.comments || []);
        if (Array.isArray(comments) && comments.length > 0) {
          console.log(`[DiscussionService] Fetched ${comments.length} comments from ${gateway}`);
          return comments;
        }
      } catch {
        console.warn(`[DiscussionService] Gateway failed: ${gateway}`);
        continue;
      }
    }

    console.warn('[DiscussionService] All IPFS gateways failed');
    return null;
  }
}

export const discussionService = new DiscussionService();
