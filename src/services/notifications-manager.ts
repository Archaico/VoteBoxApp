// src/services/NotificationsManager.ts
import PushNotification, { Importance } from 'react-native-push-notification';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { analyticsService } from './AnalyticsService';

interface NotificationPreferences {
  proposalDeadlines: boolean;
  voteConfirmations: boolean;
  newProposals: boolean;
  resultUpdates: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export class NotificationsManager {
  private static instance: NotificationsManager;
  private readonly PREFERENCES_KEY = '@notification_preferences';
  
  private constructor() {
    this.initializeNotifications();
  }

  static getInstance(): NotificationsManager {
    if (!NotificationsManager.instance) {
      NotificationsManager.instance = new NotificationsManager();
    }
    return NotificationsManager.instance;
  }

  private initializeNotifications() {
    PushNotification.configure({
      onRegister: (token) => {
        this.handleTokenRegistration(token);
      },
      onNotification: (notification) => {
        this.handleNotificationReceived(notification);
      },
      permissions: {
        alert: true,
        badge: true,
        sound: true,
      },
      popInitialNotification: true,
      requestPermissions: Platform.OS === 'ios',
    });

    // Create default notification channel for Android
    if (Platform.OS === 'android') {
      PushNotification.createChannel(
        {
          channelId: 'voting-app-notifications',
          channelName: 'Voting Notifications',
          channelDescription: 'Notifications for voting activities',
          playSound: true,
          soundName: 'default',
          importance: Importance.HIGH,
          vibrate: true,
        },
        (created) => console.log(`Notification channel created: ${created}`)
      );
    }
  }

  async showNotification({
    title,
    message,
    type,
    data = {},
  }: {
    title: string;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
    data?: any;
  }) {
    const preferences = await this.getPreferences();

    PushNotification.localNotification({
      channelId: 'voting-app-notifications',
      title,
      message,
      playSound: preferences.soundEnabled,
      vibrate: preferences.vibrationEnabled,
      priority: 'high',
      data: { ...data, type },
    });

    await analyticsService.trackEvent('notification_shown', {
      type,
      title,
    });
  }

  async scheduleDeadlineReminder(proposalId: string, title: string, deadline: number) {
    const preferences = await this.getPreferences();
    if (!preferences.proposalDeadlines) return;

    // Schedule reminders at 24h, 1h, and 15min before deadline
    const reminderTimes = [
      { time: 24 * 60 * 60 * 1000, label: '24 hours' },
      { time: 60 * 60 * 1000, label: '1 hour' },
      { time: 15 * 60 * 1000, label: '15 minutes' },
    ];

    for (const reminder of reminderTimes) {
      const scheduledTime = deadline - reminder.time;
      if (scheduledTime > Date.now()) {
        PushNotification.localNotificationSchedule({
          channelId: 'voting-app-notifications',
          title: 'Voting Deadline Approaching',
          message: `The proposal "${title}" ends in ${reminder.label}`,
          date: new Date(scheduledTime),
          allowWhileIdle: true,
          data: { proposalId, type: 'deadline' },
        });
      }
    }
  }

  async notifyVoteConfirmation(proposalTitle: string, choice: string) {
    const preferences = await this.getPreferences();
    if (!preferences.voteConfirmations) return;

    this.showNotification({
      title: 'Vote Confirmed',
      message: `Your vote for "${choice}" on proposal "${proposalTitle}" has been recorded`,
      type: 'success',
    });
  }

  async notifyNewProposal(proposal: any) {
    const preferences = await this.getPreferences();
    if (!preferences.newProposals) return;

    this.showNotification({
      title: 'New Proposal Available',
      message: `A new proposal "${proposal.title}" is now available for voting`,
      type: 'info',
      data: { proposalId: proposal.id },
    });
  }

  async notifyResultUpdate(proposal: any) {
    const preferences = await this.getPreferences();
    if (!preferences.resultUpdates) return;

    this.showNotification({
      title: 'Voting Results Updated',
      message: `Results for "${proposal.title}" have been updated`,
      type: 'info',
      data: { proposalId: proposal.id },
    });
  }

  private async handleTokenRegistration(token: any) {
    try {
      await AsyncStorage.setItem('@notification_token', token.token);
      await analyticsService.trackEvent('notification_token_registered', {
        token: token.token,
      });
    } catch (error) {
      console.error('Error saving notification token:', error);
    }
  }

  private async handleNotificationReceived(notification: any) {
    await analyticsService.trackEvent('notification_received', {
      type: notification.data?.type,
      title: notification.title,
    });
  }

  async getPreferences(): Promise<NotificationPreferences> {
    try {
      const stored = await AsyncStorage.getItem(this.PREFERENCES_KEY);
      return stored
        ? JSON.parse(stored)
        : this.getDefaultPreferences();
    } catch (error) {
      console.error('Error getting notification preferences:', error);
      return this.getDefaultPreferences();
    }
  }

  async updatePreferences(preferences: Partial<NotificationPreferences>) {
    try {
      const current = await this.getPreferences();
      const updated = { ...current, ...preferences };
      await AsyncStorage.setItem(
        this.PREFERENCES_KEY,
        JSON.stringify(updated)
      );
      await analyticsService.trackEvent('notification_preferences_updated', preferences);
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      throw error;
    }
  }

  private getDefaultPreferences(): NotificationPreferences {
    return {
      proposalDeadlines: true,
      voteConfirmations: true,
      newProposals: true,
      resultUpdates: true,
      soundEnabled: true,
      vibrationEnabled: true,
    };
  }
}

export const notificationsManager = NotificationsManager.getInstance();