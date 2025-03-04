// src/services/AnalyticsService.ts

interface AnalyticsEvent {
    type: string;
    data?: any;
    timestamp: number;
  }
  
  class AnalyticsService {
    private static instance: AnalyticsService;
  
    private constructor() {}
  
    static getInstance(): AnalyticsService {
      if (!this.instance) {
        this.instance = new AnalyticsService();
      }
      return this.instance;
    }
  
    async trackEvent(eventName: string, data: any = {}): Promise<void> {
      const event: AnalyticsEvent = {
        type: eventName,
        data,
        timestamp: Date.now()
      };
  
      try {
        console.log('Analytics Event:', event);
        // Here you would typically send to your analytics service
        // For now, we'll just log to console
      } catch (error) {
        console.error('Error tracking event:', error);
      }
    }
  
    async trackWalletInteraction(action: string, walletName: string, details?: any): Promise<void> {
      await this.trackEvent('wallet_interaction', {
        action,
        walletName,
        ...details
      });
    }
  
    async trackError(error: Error, context: string): Promise<void> {
      await this.trackEvent('error', {
        message: error.message,
        context,
        stack: error.stack
      });
    }
  
    async trackTransaction(transactionData: {
      transactionId: string;
      type: string;
      status: string;
      timestamp: number;
      feeAmount?: string;
      walletType?: string;
    }): Promise<void> {
      await this.trackEvent('transaction', transactionData);
    }
  }
  
  export const analyticsService = AnalyticsService.getInstance();