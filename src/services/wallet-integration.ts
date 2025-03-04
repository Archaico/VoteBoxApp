// src/services/wallet-integration.ts
import { TransactionHash, Address } from '@emurgo/cardano-serialization-lib-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyticsService } from './AnalyticsService';
export interface WalletProvider {
  name: string;
  icon: string;
  enabled: boolean;
}

export interface WalletAPI {
  enable(): Promise<boolean>;
  getAddress(): Promise<string>;
  signTransaction(txHash: TransactionHash): Promise<any>;
  getBalance(): Promise<string>;
  getUtxos(): Promise<any[]>;
  getNetworkId?(): Promise<number>;
}

export interface WalletInfo {
  address: string;
  network: 'testnet' | 'mainnet';
  balance: bigint;
  isConnected: boolean;
  provider: string;
}

class WalletService {
  private static instance: WalletService;
  private readonly WALLET_STORAGE_KEY = '@wallet_info';
  private readonly PREFERRED_WALLET_KEY = '@preferred_wallet';
  
  private availableWallets: Map<string, WalletAPI> = new Map();
  private activeWallet: WalletAPI | null = null;
  private walletInfo: WalletInfo | null = null;

  private constructor() {
    this.initializeWallets();
  }

  static getInstance(): WalletService {
    if (!this.instance) {
      this.instance = new WalletService();
    }
    return this.instance;
  }

  private async initializeWallets() {
    // Check for available wallet providers
    const walletProviders = this.detectWalletProviders();
    
    for (const provider of walletProviders) {
      if (provider.enabled) {
        this.registerWallet(provider.name, this.createWalletAPI(provider.name));
      }
    }

    // Try to connect to preferred wallet
    await this.connectToPreferredWallet();
  }

  private async registerWallet(walletName: string, api: WalletAPI): Promise<void> {
    this.availableWallets.set(walletName, api);
    await analyticsService.trackWalletInteraction('register', walletName);
  }

  private detectWalletProviders(): WalletProvider[] {
    const providers: WalletProvider[] = [
      {
        name: 'nami',
        icon: 'nami-icon',
        enabled: typeof window !== 'undefined' && !!(window as any)?.cardano?.nami
      },
      {
        name: 'yoroi',
        icon: 'yoroi-icon',
        enabled: typeof window !== 'undefined' && !!(window as any)?.cardano?.yoroi
      },
      {
        name: 'ccvault',
        icon: 'ccvault-icon',
        enabled: typeof window !== 'undefined' && !!(window as any)?.cardano?.ccvault
      }
    ];

    return providers;
  }

  private createWalletAPI(walletName: string): WalletAPI {
    switch (walletName) {
      case 'nami':
        return this.createNamiAPI();
      case 'yoroi':
        return this.createYoroiAPI();
      case 'ccvault':
        return this.createCCVaultAPI();
      default:
        throw new Error(`Unsupported wallet: ${walletName}`);
    }
  }

  private createNamiAPI(): WalletAPI {
    return {
      enable: async () => {
        try {
          const api = await (window as any).cardano.nami.enable();
          await analyticsService.trackWalletInteraction('connect', 'nami');
          return true;
        } catch (error) {
          console.error('Failed to enable Nami wallet:', error);
          await analyticsService.trackWalletInteraction('connect', 'nami', { error: true });
          return false;
        }
      },
      getAddress: async () => {
        const api = await (window as any).cardano.nami.enable();
        return await api.getAddress();
      },
      signTransaction: async (txHash: TransactionHash) => {
        const api = await (window as any).cardano.nami.enable();
        try {
          const signature = await api.signTx(txHash.to_hex());
          await analyticsService.trackWalletInteraction('sign', 'nami', { success: true });
          return signature;
        } catch (error) {
          await analyticsService.trackWalletInteraction('sign', 'nami', { error: true });
          throw error;
        }
      },
      getBalance: async () => {
        const api = await (window as any).cardano.nami.enable();
        return await api.getBalance();
      },
      getUtxos: async () => {
        const api = await (window as any).cardano.nami.enable();
        return await api.getUtxos();
      },
      getNetworkId: async () => {
        const api = await (window as any).cardano.nami.enable();
        return await api.getNetworkId();
      }
    };
  }

  // Placeholder implementations for other wallet APIs
  private createYoroiAPI(): WalletAPI {
    // Implementation for Yoroi wallet
    throw new Error('Yoroi wallet integration not implemented');
  }

  private createCCVaultAPI(): WalletAPI {
    // Implementation for CCVault wallet
    throw new Error('CCVault wallet integration not implemented');
  }

  public async connectWallet(walletName: string): Promise<boolean> {
    const wallet = this.availableWallets.get(walletName);
    if (!wallet) {
      throw new Error(`Wallet ${walletName} not available`);
    }

    try {
      const enabled = await wallet.enable();
      if (enabled) {
        this.activeWallet = wallet;
        await this.setPreferredWallet(walletName);
        
        // Update wallet info if available
        if (wallet.getNetworkId && wallet.getAddress) {
          const networkId = await wallet.getNetworkId();
          const address = await wallet.getAddress();
          const balance = await wallet.getBalance();

          this.walletInfo = {
            address,
            network: networkId === 0 ? 'testnet' : 'mainnet',
            balance: BigInt(balance),
            isConnected: true,
            provider: walletName
          };

          await this.persistWalletInfo();
        }

        await analyticsService.trackWalletInteraction('connect', walletName, { success: true });
        
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to connect to ${walletName}:`, error);
      await analyticsService.trackWalletInteraction('connect', walletName, { error: true });
      return false;
    }
  }

  public async getConnectedWalletAddress(): Promise<string | null> {
    if (!this.activeWallet) return null;
    try {
      return await this.activeWallet.getAddress();
    } catch (error) {
      console.error('Failed to get wallet address:', error);
      return null;
    }
  }

  private async setPreferredWallet(walletName: string): Promise<void> {
    await AsyncStorage.setItem(this.PREFERRED_WALLET_KEY, walletName);
  }

  private async getPreferredWallet(): Promise<string | null> {
    return await AsyncStorage.getItem(this.PREFERRED_WALLET_KEY);
  }

  private async connectToPreferredWallet(): Promise<void> {
    const preferred = await this.getPreferredWallet();
    if (preferred) {
      await this.connectWallet(preferred).catch(console.error);
    }
  }

  private async persistWalletInfo(): Promise<void> {
    if (this.walletInfo) {
      await AsyncStorage.setItem(this.WALLET_STORAGE_KEY, JSON.stringify(this.walletInfo));
    }
  }

  public async disconnectWallet(): Promise<void> {
    this.activeWallet = null;
    this.walletInfo = null;
    await AsyncStorage.removeItem(this.WALLET_STORAGE_KEY);
    await AsyncStorage.removeItem(this.PREFERRED_WALLET_KEY);
    await analyticsService.trackWalletInteraction('disconnect', 
      this.walletInfo ? this.walletInfo.provider : 'unknown');
}

export const walletService = WalletService.getInstance();