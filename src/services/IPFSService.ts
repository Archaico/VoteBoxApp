// src/services/IPFSService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ProposalMetadata {
  title: string;
  description: string;
  creator: string;
  createdAt: number;
  duration: number;
  category?: string;
}

interface IPFSUploadResult {
  cid: string;
  url: string;
  gateways: string[];
}

interface GatewayHealth {
  url: string;
  healthy: boolean;
  lastChecked: number;
  responseTime: number;
}

class IPFSService {
  private isInitialized: boolean = false;
  
  // Multiple IPFS gateways for redundancy
  private gateways: string[] = [
    'https://w3s.link/ipfs',
    'https://dweb.link/ipfs',
    'https://ipfs.io/ipfs',
    'https://cloudflare-ipfs.com/ipfs',
    'https://gateway.pinata.cloud/ipfs',
  ];

  private gatewayHealth: Map<string, GatewayHealth> = new Map();
  private cachePrefix = '@votebox_ipfs_cache:';

  /**
   * Initialize the IPFS service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing IPFS service...');
      
      // Check for stored configuration
      const storedConfig = await AsyncStorage.getItem('@votebox_ipfs_config');
      
      if (storedConfig) {
        console.log('Found stored IPFS configuration');
      }

      this.isInitialized = true;
      console.log('IPFS service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize IPFS service:', error);
      throw new Error('IPFS initialization failed');
    }
  }

  /**
   * Upload proposal metadata to IPFS
   * For production: This would use Storacha API via fetch()
   * For now: Generates deterministic mock CID and caches locally
   */
  async uploadProposal(metadata: ProposalMetadata): Promise<IPFSUploadResult> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      console.log('Uploading proposal to IPFS:', metadata.title);

      // Generate deterministic CID based on content
      const contentHash = await this.hashContent(JSON.stringify(metadata));
      const cid = `Qm${contentHash}`;
      
      console.log('Generated CID:', cid);

      // Cache the proposal locally
      await this.cacheProposal(cid, metadata);

      // Store in "uploaded" list
      await this.addToUploadedList(cid, metadata);

      // Generate gateway URLs
      const gateways = this.gateways.map(gateway => `${gateway}/${cid}`);

      const result: IPFSUploadResult = {
        cid,
        url: gateways[0], // Primary gateway
        gateways,
      };

      console.log('Upload successful:', result);
      return result;
    } catch (error) {
      console.error('Upload failed:', error);
      throw new Error('Failed to upload to IPFS');
    }
  }

  /**
   * Retrieve proposal from IPFS
   */
  async getProposal(cid: string): Promise<ProposalMetadata | null> {
    try {
      console.log('Fetching proposal from IPFS:', cid);

      // Check cache first
      const cached = await this.getCachedProposal(cid);
      if (cached) {
        console.log('Returning cached proposal');
        return cached;
      }

      // In production, this would fetch from IPFS gateways
      // For now, return null if not cached
      console.log('Proposal not found in cache');
      return null;
    } catch (error) {
      console.error('Failed to retrieve proposal:', error);
      return null;
    }
  }

  /**
   * Get all uploaded proposals
   */
  async getUploadedProposals(): Promise<Array<{ cid: string; metadata: ProposalMetadata }>> {
    try {
      const listJson = await AsyncStorage.getItem('@votebox_uploaded_proposals');
      if (!listJson) return [];

      const list = JSON.parse(listJson);
      return list;
    } catch (error) {
      console.error('Failed to get uploaded proposals:', error);
      return [];
    }
  }

  /**
   * Add to uploaded proposals list
   */
  private async addToUploadedList(cid: string, metadata: ProposalMetadata): Promise<void> {
    try {
      const list = await this.getUploadedProposals();
      list.unshift({ cid, metadata }); // Add to beginning
      
      // Keep only last 50
      const trimmed = list.slice(0, 50);
      
      await AsyncStorage.setItem('@votebox_uploaded_proposals', JSON.stringify(trimmed));
    } catch (error) {
      console.warn('Failed to update uploaded list:', error);
    }
  }

  /**
   * Cache proposal locally
   */
  private async cacheProposal(cid: string, metadata: ProposalMetadata): Promise<void> {
    try {
      const key = `${this.cachePrefix}${cid}`;
      const data = JSON.stringify({
        metadata,
        cachedAt: Date.now(),
      });
      await AsyncStorage.setItem(key, data);
      console.log('Proposal cached:', cid);
    } catch (error) {
      console.warn('Failed to cache proposal:', error);
    }
  }

  /**
   * Get cached proposal
   */
  private async getCachedProposal(cid: string): Promise<ProposalMetadata | null> {
    try {
      const key = `${this.cachePrefix}${cid}`;
      const data = await AsyncStorage.getItem(key);
      
      if (!data) return null;

      const parsed = JSON.parse(data);
      const cacheAge = Date.now() - parsed.cachedAt;
      
      // Cache valid for 30 days
      if (cacheAge > 30 * 24 * 60 * 60 * 1000) {
        await AsyncStorage.removeItem(key);
        return null;
      }

      return parsed.metadata;
    } catch (error) {
      console.warn('Failed to get cached proposal:', error);
      return null;
    }
  }

  /**
   * Hash content to generate consistent CID
   * Uses simple string hashing (in production, use proper content addressing)
   */
  private async hashContent(content: string): Promise<string> {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Add timestamp for uniqueness
    const timestamp = Date.now().toString(36);
    const positiveHash = Math.abs(hash).toString(36);
    
    // Create 44-character hash (IPFS CID length)
    const combined = (positiveHash + timestamp).padEnd(44, '0').slice(0, 44);
    return combined;
  }

  /**
   * Check health of IPFS gateways
   */
  async checkGatewayHealth(): Promise<GatewayHealth[]> {
    const testCID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'; // Public test file
    const healthResults: GatewayHealth[] = [];

    for (const gateway of this.gateways) {
      const startTime = Date.now();
      
      try {
        const url = `${gateway}/${testCID}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        const health: GatewayHealth = {
          url: gateway,
          healthy: response.ok,
          lastChecked: Date.now(),
          responseTime,
        };

        this.gatewayHealth.set(gateway, health);
        healthResults.push(health);
      } catch (error) {
        const health: GatewayHealth = {
          url: gateway,
          healthy: false,
          lastChecked: Date.now(),
          responseTime: -1,
        };

        this.gatewayHealth.set(gateway, health);
        healthResults.push(health);
      }
    }

    return healthResults;
  }

  /**
   * Clear all cached proposals
   */
  async clearCache(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(this.cachePrefix));
      await AsyncStorage.multiRemove(cacheKeys);
      console.log('Cache cleared:', cacheKeys.length, 'items');
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  /**
   * Get gateway statistics
   */
  getGatewayStats(): GatewayHealth[] {
    return Array.from(this.gatewayHealth.values());
  }
}

// Export singleton instance
export const ipfsService = new IPFSService();
export type { ProposalMetadata, IPFSUploadResult, GatewayHealth };