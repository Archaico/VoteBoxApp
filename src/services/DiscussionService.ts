// src/services/DiscussionService.ts

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Comment {
  id: string;
  proposalId: string;
  author: string;
  content: string;
  timestamp: number;
  replyTo?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
// Metadata label 1338 = VoteBox comment thread CIDs on Cardano
// (1337 = votes, 674 = proposals)

const BLOCKFROST = {
  API_URL:    'https://cardano-preprod.blockfrost.io/api/v0',
  PROJECT_ID: 'preprodBY4zNPRdvkSFJOxYMjG7TGPyePT0kVxn',
  LABEL:      1338,
};

const STORACHA = {
  UPLOAD_URL: 'https://up.storacha.network/upload',
  TOKEN:      'did:key:z6Mkjsscuat5eHppaWQtTWojgZm4gny2JpV7qbp1V5t4GgKU',
};

const IPFS_GATEWAYS = [
  'https://w3s.link/ipfs',
  'https://ipfs.io/ipfs',
  'https://dweb.link/ipfs',
  'https://cloudflare-ipfs.com/ipfs',
];

// ─── DiscussionService ────────────────────────────────────────────────────────

class DiscussionService {

  // Each proposal gets its own scoped key — no cross-proposal bleed possible
  private storageKey(proposalId: string): string {
    return `@comments_${proposalId}`;
  }

  private cidKey(proposalId: string): string {
    return `@comment_cid_${proposalId}`;
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
  // Stores the resulting CID locally so syncFromIPFS can use it as a fallback.
  // In production, the CID should also be registered in a Cardano metadata tx
  // (label 1338) — that registration will happen once real tx building lands.

  async uploadCommentsToIPFS(proposalId: string, comments: Comment[]): Promise<string | null> {
    try {
      const payload = JSON.stringify({ proposalId, comments, uploadedAt: Date.now() });
      const blob = new Blob([payload], { type: 'application/json' });
      const formData = new FormData();
      formData.append('file', blob, `comments_${proposalId}.json`);

      const response = await fetch(STORACHA.UPLOAD_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STORACHA.TOKEN}`,
          'X-NAME': `votebox-comments-${proposalId}`,
        },
        body: formData,
      });

      if (!response.ok) throw new Error(`Storacha upload failed: ${response.status}`);

      const result = await response.json();
      const cid: string = result.cid || result['/'];
      if (!cid) throw new Error('No CID in Storacha response');

      await AsyncStorage.setItem(this.cidKey(proposalId), cid);
      console.log(`[DiscussionService] Comments uploaded to IPFS: ${cid}`);
      return cid;
    } catch (error) {
      console.warn('[DiscussionService] IPFS upload failed:', error);
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

      // Step 1: Try Blockfrost for on-chain CID
      const onChainCid = await this.fetchCidFromChain(proposalId);

      // Step 2: Fall back to locally cached CID
      const cid = onChainCid || await AsyncStorage.getItem(this.cidKey(proposalId));

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

  private async fetchCidFromChain(proposalId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${BLOCKFROST.API_URL}/metadata/txs/labels/${BLOCKFROST.LABEL}?order=desc`,
        { headers: { 'project_id': BLOCKFROST.PROJECT_ID } }
      );

      if (!response.ok) return null;

      const txs: Array<{ tx_hash: string; json_metadata: any }> = await response.json();

      for (const tx of txs) {
        const meta = tx.json_metadata;
        if (meta?.proposalId === proposalId && meta?.commentCid) {
          console.log(`[DiscussionService] Found on-chain CID: ${meta.commentCid}`);
          return meta.commentCid;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async fetchCommentsFromIPFS(cid: string): Promise<Comment[] | null> {
    for (const gateway of IPFS_GATEWAYS) {
      try {
        const response = await fetch(`${gateway}/${cid}`, {
          signal: AbortSignal.timeout(8000),
        });

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
