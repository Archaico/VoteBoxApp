// src/services/RateLimiterService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

interface RateLimit {
  count: number;
  timestamp: number;
}

export class RateLimiterService {
  private static instance: RateLimiterService;
  private readonly RATE_LIMIT_KEY = 'vote_rate_limit';
  private readonly MAX_VOTES_PER_WINDOW = 5; // Maximum votes per time window
  private readonly TIME_WINDOW_MS = 60000; // 1 minute window

  private constructor() {}

  static getInstance(): RateLimiterService {
    if (!this.instance) {
      this.instance = new RateLimiterService();
    }
    return this.instance;
  }

  async checkRateLimit(userPubKey: string): Promise<boolean> {
    try {
      const currentLimit = await this.getCurrentLimit(userPubKey);
      
      // Reset limit if time window has passed
      if (Date.now() - currentLimit.timestamp > this.TIME_WINDOW_MS) {
        await this.resetLimit(userPubKey);
        return true;
      }

      // Check if limit exceeded
      if (currentLimit.count >= this.MAX_VOTES_PER_WINDOW) {
        return false;
      }

      // Increment counter
      await this.incrementLimit(userPubKey);
      return true;
    } catch (error) {
      console.error('Error checking rate limit:', error);
      return false;
    }
  }

  private async getCurrentLimit(userPubKey: string): Promise<RateLimit> {
    const key = `${this.RATE_LIMIT_KEY}_${userPubKey}`;
    const stored = await AsyncStorage.getItem(key);
    
    if (!stored) {
      return { count: 0, timestamp: Date.now() };
    }

    return JSON.parse(stored);
  }

  private async resetLimit(userPubKey: string): Promise<void> {
    const key = `${this.RATE_LIMIT_KEY}_${userPubKey}`;
    const newLimit: RateLimit = {
      count: 1,
      timestamp: Date.now()
    };
    await AsyncStorage.setItem(key, JSON.stringify(newLimit));
  }

  private async incrementLimit(userPubKey: string): Promise<void> {
    const key = `${this.RATE_LIMIT_KEY}_${userPubKey}`;
    const currentLimit = await this.getCurrentLimit(userPubKey);
    
    const newLimit: RateLimit = {
      count: currentLimit.count + 1,
      timestamp: currentLimit.timestamp
    };
    
    await AsyncStorage.setItem(key, JSON.stringify(newLimit));
  }

  async getRemainingVotes(userPubKey: string): Promise<number> {
    const currentLimit = await this.getCurrentLimit(userPubKey);
    
    if (Date.now() - currentLimit.timestamp > this.TIME_WINDOW_MS) {
      return this.MAX_VOTES_PER_WINDOW;
    }

    return Math.max(0, this.MAX_VOTES_PER_WINDOW - currentLimit.count);
  }

  async getTimeToReset(userPubKey: string): Promise<number> {
    const currentLimit = await this.getCurrentLimit(userPubKey);
    return Math.max(0, this.TIME_WINDOW_MS - (Date.now() - currentLimit.timestamp));
  }
}

export const rateLimiterService = RateLimiterService.getInstance();