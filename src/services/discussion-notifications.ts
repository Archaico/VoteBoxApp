// src/services/NotificationService.ts
import PushNotification from 'react-native-push-notification';
import { discordBotService } from './DiscordBotService';

export class DiscussionNotificationService {
  initialize() {
    PushNotification.createChannel(
      {
        channelId: 'discussions',
        channelName: 'Discussion Notifications',
        channelDescription: 'Notifications for proposal discussions',
        playSound: true,
        soundName: 'default',
        importance: 4,
        vibrate: true,
      },
      (created) => console.log(`Discussion notifications channel created: ${created}`)
    );
  }

  async subscribeToDiscussion(proposalId: string, userId: string) {
    await AsyncStorage.setItem(
      `discussion_sub_${proposalId}_${userId}`,
      'true'
    );
  }

  async unsubscribeFromDiscussion(proposalId: string, userId: string) {
    await AsyncStorage.removeItem(
      `discussion_sub_${proposalId}_${userId}`
    );
  }

  async notifyNewComment({
    proposalId,
    proposalTitle,
    commentAuthor,
    commentContent,
    subscribers,
  }: {
    proposalId: string;
    proposalTitle: string;
    commentAuthor: string;
    commentContent: string;
    subscribers: string[];
  }) {
    // Send in-app notification
    PushNotification.localNotification({
      channelId: 'discussions',
      title: `New comment on ${proposalTitle}`,
      message: `${commentAuthor}: ${commentContent.substring(0, 100)}...`,
      playSound: true,
      priority: 'high',
      data: {
        proposalId,
        type: 'discussion',
      },
    });

    // Send Discord notification
    const threadId = await discordBotService.getThreadId(proposalId);
    if (threadId) {
      await discordBotService.sendNotification(
        threadId,
        `💬 New comment from ${commentAuthor}\n${commentContent}`
      );
    }
  }
}

export const discussionNotificationService = new DiscussionNotificationService();