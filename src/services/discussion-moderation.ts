// src/services/ModerationService.ts
export class ModerationService {
    private readonly MODERATORS_KEY = '@discussion_moderators';
    private readonly REPORTED_COMMENTS_KEY = '@reported_comments';
  
    async addModerator(userId: string, permissions: string[]) {
      const moderators = await this.getModerators();
      moderators[userId] = {
        permissions,
        addedAt: Date.now(),
      };
      await AsyncStorage.setItem(
        this.MODERATORS_KEY,
        JSON.stringify(moderators)
      );
    }
  
    async removeModerator(userId: string) {
      const moderators = await this.getModerators();
      delete moderators[userId];
      await AsyncStorage.setItem(
        this.MODERATORS_KEY,
        JSON.stringify(moderators)
      );
    }
  
    async reportComment(comment: {
      id: string;
      proposalId: string;
      content: string;
      author: string;
      reason: string;
      reportedBy: string;
    }) {
      const reports = await this.getReportedComments();
      reports.push({
        ...comment,
        reportedAt: Date.now(),
        status: 'pending',
      });
      await AsyncStorage.setItem(
        this.REPORTED_COMMENTS_KEY,
        JSON.stringify(reports)
      );
  
      // Notify moderators
      const moderators = await this.getModerators();
      for (const moderatorId of Object.keys(moderators)) {
        await notificationService.sendNotification(moderatorId, {
          title: 'New Comment Report',
          body: `Comment reported in proposal ${comment.proposalId}`,
          data: {
            type: 'moderation',
            commentId: comment.id,
          },
        });
      }
    }
  
    async moderateComment(commentId: string, action: 'approve' | 'remove', moderatorId: string) {
      const reports = await this.getReportedComments();
      const report = reports.find(r => r.id === commentId);
      
      if (report) {
        report.status = action;
        report.moderatedBy = moderatorId;
        report.moderatedAt = Date.now();
  
        if (action === 'remove') {
          await hybridDiscussionService.removeComment(report.proposalId, commentId);
          await discordBotService.removeMessage(report.proposalId, commentId);
        }
  
        await AsyncStorage.setItem(
          this.REPORTED_COMMENTS_KEY,
          JSON.stringify(reports)
        );
      }
    }
  
    private async getModerators(): Promise<Record<string, {
      permissions: string[];
      addedAt: number;
    }>> {
      const stored = await AsyncStorage.getItem(this.MODERATORS_KEY);
      return stored ? JSON.parse(stored) : {};
    }
  
    private async getReportedComments() {
      const stored = await AsyncStorage.getItem(this.REPORTED_COMMENTS_KEY);
      return stored ? JSON.parse(stored) : [];
    }
  }
  
  export const moderationService = new ModerationService();  