// src/services/IPFSService.ts
import { create as createW3Client } from '@web3-storage/w3up-client';
import { create as createIPFSClient } from 'ipfs-http-client';
import axios from 'axios';

export class IPFSService {
  private w3Client: any; // Type will be properly initialized in constructor
  private readonly FILEBASE_ENDPOINT = 'https://api.filebase.io/v1/ipfs';
  
  private fallbackGateways = [
    'https://ipfs.io',
    'https://dweb.link',
    'https://cloudflare-ipfs.com',
    'https://gateway.pinata.cloud'
  ];

  constructor() {
    this.initializeW3Client();
  }

  private async initializeW3Client() {
    try {
      this.w3Client = await createW3Client();
      await this.w3Client.authenticate(process.env.W3_ACCOUNT_KEY as string);
      await this.w3Client.setCurrentSpace(process.env.W3_SPACE_KEY as string);
    } catch (error) {
      console.error('Error initializing w3up client:', error);
    }
  }

  async uploadContent(data: any): Promise<string> {
    try {
      // Ensure client is initialized
      if (!this.w3Client) {
        await this.initializeW3Client();
      }

      // Primary upload to Web3.Storage
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const file = new File([blob], 'data.json', { type: 'application/json' });
      const dirCid = await this.w3Client.uploadFile(file);
      const cid = dirCid.toString();

      // Secondary pin to Filebase
      await this.pinToFilebase(cid, data);

      // Additional backup to IPFS nodes
      await this.pinToFallbackNodes(cid, data);

      return cid;
    } catch (error) {
      console.error('Error in primary upload:', error);
      return this.uploadToFallbackGateways(data);
    }
  }

  async retrieveContent(cid: string): Promise<any> {
    const errors: Error[] = [];

    // Try Web3.Storage first
    try {
      const response = await fetch(`https://${cid}.ipfs.w3s.link`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      errors.push(error as Error);
    }

    // Try Filebase
    try {
      const response = await axios.get(`${this.FILEBASE_ENDPOINT}/${cid}`, {
        headers: {
          'Authorization': `Bearer ${process.env.FILEBASE_KEY}`,
        }
      });
      if (response.data) return response.data;
    } catch (error) {
      errors.push(error as Error);
    }

    // Try fallback gateways
    for (const gateway of this.fallbackGateways) {
      try {
        const response = await fetch(`${gateway}/ipfs/${cid}`);
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        errors.push(error as Error);
      }
    }

    console.error('All retrieval attempts failed:', errors);
    throw new Error('Content retrieval failed on all services');
  }

  private async pinToFilebase(cid: string, data: any): Promise<void> {
    try {
      const formData = new FormData();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      formData.append('file', blob);

      await axios.post(this.FILEBASE_ENDPOINT, formData, {
        headers: {
          'Authorization': `Bearer ${process.env.FILEBASE_KEY}`,
          'Content-Type': 'multipart/form-data'
        }
      });
    } catch (error) {
      console.warn('Filebase pinning failed:', error);
      // Continue execution - we still have primary storage
    }
  }

  private async pinToFallbackNodes(cid: string, data: any) {
    const pinningPromises = this.fallbackGateways.map(async (gateway) => {
      try {
        const ipfs = createIPFSClient({ url: gateway });
        await ipfs.pin.add(cid);
      } catch (error) {
        console.warn(`Pinning to ${gateway} failed:`, error);
      }
    });

    await Promise.allSettled(pinningPromises);
  }

  private async uploadToFallbackGateways(data: any): Promise<string> {
    for (const gateway of this.fallbackGateways) {
      try {
        const ipfs = createIPFSClient({ url: gateway });
        const result = await ipfs.add(JSON.stringify(data));
        return result.path;
      } catch (error) {
        continue; // Try next gateway
      }
    }
    throw new Error('Upload failed on all gateways');
  }
}

export const ipfsService = new IPFSService();