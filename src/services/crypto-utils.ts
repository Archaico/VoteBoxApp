// src/utils/cryptography.ts
import { ethers } from 'ethers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Random from 'expo-random';
import * as SecureStore from 'expo-secure-store';

interface KeyPair {
  publicKey: string;
  privateKey: string;
}

interface VoteData {
  proposalId: string;
  choice: string;
  voterPubKey: string;
  timestamp: number;
}

export class CryptographyService {
  private static instance: CryptographyService;
  private readonly PRIVATE_KEY_STORAGE_KEY = 'user_voting_private_key';
  private readonly PUBLIC_KEY_STORAGE_KEY = 'user_voting_public_key';

  private constructor() {}

  static getInstance(): CryptographyService {
    if (!this.instance) {
      this.instance = new CryptographyService();
    }
    return this.instance;
  }

  async generateKeyPair(): Promise<KeyPair> {
    try {
      // Generate random bytes for entropy
      const randomBytes = await Random.getRandomBytesAsync(32);
      
      // Create wallet from random bytes
      const wallet = ethers.Wallet.createRandom({
        extraEntropy: randomBytes
      });

      const keyPair: KeyPair = {
        publicKey: wallet.address,
        privateKey: wallet.privateKey
      };

      // Store keys securely
      await this.storeKeyPair(keyPair);

      return keyPair;
    } catch (error) {
      console.error('Error generating key pair:', error);
      throw new Error('Failed to generate key pair');
    }
  }

  private async storeKeyPair(keyPair: KeyPair): Promise<void> {
    try {
      // Store private key in secure storage
      await SecureStore.setItemAsync(
        this.PRIVATE_KEY_STORAGE_KEY,
        keyPair.privateKey
      );

      // Store public key in regular storage
      await AsyncStorage.setItem(
        this.PUBLIC_KEY_STORAGE_KEY,
        keyPair.publicKey
      );
    } catch (error) {
      console.error('Error storing key pair:', error);
      throw new Error('Failed to store key pair');
    }
  }

  async getOrCreateKeyPair(): Promise<KeyPair> {
    try {
      // Try to get existing keys
      const privateKey = await SecureStore.getItemAsync(this.PRIVATE_KEY_STORAGE_KEY);
      const publicKey = await AsyncStorage.getItem(this.PUBLIC_KEY_STORAGE_KEY);

      if (privateKey && publicKey) {
        return { privateKey, publicKey };
      }

      // If keys don't exist, generate new ones
      return await this.generateKeyPair();
    } catch (error) {
      console.error('Error getting/creating key pair:', error);
      throw new Error('Failed to get/create key pair');
    }
  }

  async signVote(voteData: VoteData): Promise<string> {
    try {
      const { privateKey } = await this.getOrCreateKeyPair();
      
      // Create wallet from private key
      const wallet = new ethers.Wallet(privateKey);

      // Create message hash
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['string', 'string', 'string', 'uint256'],
          [
            voteData.proposalId,
            voteData.choice,
            voteData.voterPubKey,
            voteData.timestamp
          ]
        )
      );

      // Sign the hash
      const signature = await wallet.signMessage(ethers.utils.arrayify(messageHash));

      return signature;
    } catch (error) {
      console.error('Error signing vote:', error);
      throw new Error('Failed to sign vote');
    }
  }

  verifyVoteSignature(
    voteData: VoteData,
    signature: string
  ): boolean {
    try {
      // Recreate message hash
      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['string', 'string', 'string', 'uint256'],
          [
            voteData.proposalId,
            voteData.choice,
            voteData.voterPubKey,
            voteData.timestamp
          ]
        )
      );

      // Recover signer address
      const signerAddress = ethers.utils.verifyMessage(
        ethers.utils.arrayify(messageHash),
        signature
      );

      // Verify signer matches voter's public key
      return signerAddress.toLowerCase() === voteData.voterPubKey.toLowerCase();
    } catch (error) {
      console.error('Error verifying signature:', error);
      return false;
    }
  }

  // Utility function to export public key for vote submission
  async getPublicKey(): Promise<string> {
    const publicKey = await AsyncStorage.getItem(this.PUBLIC_KEY_STORAGE_KEY);
    if (!publicKey) {
      throw new Error('No public key found');
    }
    return publicKey;
  }
}

// Export singleton instance
export const cryptographyService = CryptographyService.getInstance();

// Convenience functions for common operations
export const signVote = (voteData: VoteData) => 
  cryptographyService.signVote(voteData);

export const verifyVoteSignature = (voteData: VoteData, signature: string) =>
  cryptographyService.verifyVoteSignature(voteData, signature);

export const getUserPublicKey = () => 
  cryptographyService.getPublicKey();