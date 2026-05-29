// src/services/ToastService.ts
//
// VoteBox Toast Notification Service
// ─────────────────────────────────────────────────────────────────────────────
// Replaces blocking Alert.alert() dialogs with smooth, non-intrusive toasts.
// 
// Benefits over Alert:
//   • Non-blocking — user can keep interacting
//   • Auto-dismiss after 3-4 seconds
//   • Stackable — multiple toasts queue nicely
//   • Better UX — feels modern and professional
//
// Usage:
//   toastService.success('Vote submitted!');
//   toastService.error('Network error — will retry when online');
//   toastService.info('Processing...');
// ─────────────────────────────────────────────────────────────────────────────

import { Platform, ToastAndroid } from 'react-native';

type ToastType = 'success' | 'error' | 'info' | 'warning';

class ToastService {
  private static instance: ToastService;

  private constructor() {}

  static getInstance(): ToastService {
    if (!ToastService.instance) {
      ToastService.instance = new ToastService();
    }
    return ToastService.instance;
  }

  // ── Toast Methods ───────────────────────────────────────────────────────────

  success(message: string, duration: 'short' | 'long' = 'short') {
    this.show(message, 'success', duration);
  }

  error(message: string, duration: 'short' | 'long' = 'long') {
    this.show(message, 'error', duration);
  }

  info(message: string, duration: 'short' | 'long' = 'short') {
    this.show(message, 'info', duration);
  }

  warning(message: string, duration: 'short' | 'long' = 'short') {
    this.show(message, 'warning', duration);
  }

  // ── Core Show Method ────────────────────────────────────────────────────────

  private show(message: string, type: ToastType, duration: 'short' | 'long') {
    const icon = this.getIcon(type);
    const fullMessage = `${icon} ${message}`;

    if (Platform.OS === 'android') {
      // Native Android toast
      const toastDuration = duration === 'long'
        ? ToastAndroid.LONG
        : ToastAndroid.SHORT;
      ToastAndroid.show(fullMessage, toastDuration);
    } else {
      // iOS fallback — would use a library like react-native-toast-message in production
      // For now, console log
      console.log(`[Toast ${type.toUpperCase()}]`, message);
    }
  }

  private getIcon(type: ToastType): string {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'info': return 'ℹ️';
      case 'warning': return '⚠️';
      default: return '';
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
export const toastService = ToastService.getInstance();
