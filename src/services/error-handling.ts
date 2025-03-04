// src/utils/ErrorHandling.ts
export class AppError extends Error {
    constructor(
      message: string,
      public code: string,
      public metadata?: Record<string, any>
    ) {
      super(message);
      this.name = 'AppError';
    }
  }
  
  export class NetworkError extends AppError {
    constructor(message: string, metadata?: Record<string, any>) {
      super(message, 'NETWORK_ERROR', metadata);
    }
  }
  
  export class BlockchainError extends AppError {
    constructor(message: string, metadata?: Record<string, any>) {
      super(message, 'BLOCKCHAIN_ERROR', metadata);
    }
  }
  
  export class AuthenticationError extends AppError {
    constructor(message: string, metadata?: Record<string, any>) {
      super(message, 'AUTH_ERROR', metadata);
    }
  }
  
  // Error handling middleware
  export const errorHandler = async (
    error: Error,
    context: string,
    retryFn?: () => Promise<any>
  ): Promise<void> => {
    console.error(`Error in ${context}:`, error);
  
    // Log error
    await analyticsService.trackError(error, context);
  
    // Handle specific error types
    if (error instanceof NetworkError) {
      if (retryFn) {
        await handleNetworkError(error, retryFn);
      }
    } else if (error instanceof BlockchainError) {
      await handleBlockchainError(error);
    } else if (error instanceof AuthenticationError) {
      await handleAuthError(error);
    }
  
    // Global error handling
    throw error;
  };
  
  // Network error handling with retry logic
  const handleNetworkError = async (
    error: NetworkError,
    retryFn: () => Promise<any>
  ): Promise<void> => {
    const maxRetries = 3;
    let attempts = 0;
  
    while (attempts < maxRetries) {
      try {
        await retryFn();
        return;
      } catch (retryError) {
        attempts++;
        if (attempts === maxRetries) {
          throw new AppError(
            'Maximum retry attempts reached',
            'MAX_RETRIES_EXCEEDED',
            { originalError: error }
          );
        }
        // Exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, Math.pow(2, attempts) * 1000)
        );
      }
    }
  };
  
  // Blockchain error handling
  const handleBlockchainError = async (error: BlockchainError): Promise<void> => {
    // Save failed transaction for retry
    await AsyncStorage.setItem(
      '@failed_transactions',
      JSON.stringify({
        timestamp: Date.now(),
        error: error.message,
        metadata: error.metadata,
      })
    );
  };
  
  // Authentication error handling
  const handleAuthError = async (error: AuthenticationError): Promise<void> => {
    // Clear invalid session
    await AsyncStorage.removeItem('@auth_session');
    // Redirect to login
    navigation.reset({
      index: 0,
      routes: [{ name: 'Auth' }],
    });
  };  