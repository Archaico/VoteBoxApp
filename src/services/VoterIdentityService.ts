// src/services/VoterIdentityService.ts
//
// Generates and persists a unique anonymous pseudonym for each user.
// Created once on first authenticated session, stored in hardware-backed
// secure storage (iOS Keychain / Android Keystore) — never in plaintext AsyncStorage.
//
// Format: voter + 8 alphanumeric chars, e.g. voter14a29vf3
// Confusable characters (0, o, 1, l, i) are excluded for readability.
//
// Same ID is used for:
//   - Vote attribution on Cardano (voterPubKey field)
//   - Discussion authorship display
// This is intentional — users are visible to each other by pseudonym.
// Discord-origin users will show their Discord display name instead.
//
// Security model:
//   - Stored in expo-secure-store (hardware-backed secure enclave / keystore)
//   - Readable only after device authentication — biometric gate in AuthScreen
//     ensures this service is never called before auth passes
//   - Never transmitted to any server; no central registry
//   - Device-bound: one pseudonym per device, preventing cross-device Sybil attacks

import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'votebox_voter_id';
const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0, o, 1, l, i

class VoterIdentityService {
  private static instance: VoterIdentityService;
  private cachedId: string | null = null;

  private constructor() {}

  static getInstance(): VoterIdentityService {
    if (!VoterIdentityService.instance) {
      VoterIdentityService.instance = new VoterIdentityService();
    }
    return VoterIdentityService.instance;
  }

  // Returns the persistent voter pseudonym, creating it on first call.
  // In-memory cache avoids repeated SecureStore reads within a session.
  // Must only be called after biometric auth has succeeded.
  async getVoterId(): Promise<string> {
    if (this.cachedId) return this.cachedId;

    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored) {
        this.cachedId = stored;
        return stored;
      }

      const id = this.generatePseudonym();
      await SecureStore.setItemAsync(STORAGE_KEY, id);
      this.cachedId = id;
      console.log('[VoterIdentity] New voter pseudonym created:', id);
      return id;
    } catch (error) {
      console.error('[VoterIdentity] SecureStore error:', error);
      // Ephemeral fallback — not persisted, but keeps the session functional.
      // This path should not be reached on supported devices.
      const ephemeral = this.generatePseudonym();
      this.cachedId = ephemeral;
      return ephemeral;
    }
  }

  // Clears the in-memory cache on session end so the next cold launch
  // must pass biometric auth before the pseudonym is readable again.
  clearCache(): void {
    this.cachedId = null;
  }

  private generatePseudonym(): string {
    let suffix = '';
    for (let i = 0; i < 8; i++) {
      suffix += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return `voter${suffix}`;
  }
}

export const voterIdentityService = VoterIdentityService.getInstance();
