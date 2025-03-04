// src/services/DiscussionService.ts
import { Client, MessageEmbed } from 'discord.js';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface BuiltInComment {
  id: string;
  proposalId: string;
  author: string;
  content: string;
  timestamp: number;
  replyTo?: string;
  reactions?: {
    type: string;
    count: number;
    users: string[];
  }[];
}

interface DiscordThread {
  proposalId: string;
  channelId: string;
  threadId: string;
  lastSynced: number;
}

export class HybridDiscussionService {
  private discordClient: Client;
  private readonly DISCORD_CHANNEL_ID = 'your-discord-channel-id';
  private readonly COMMENTS_KEY = '@proposal_comments';
  private readonly DISCORD_THREADS_KEY = '@discord_threads';

  constructor() {
    this.initializeDiscord();
  }

  private async initializeDiscord() {
    this.discordClient = new Client({
      intents: ['GUILDS', 'GUILD_MESSAGES', 'GUILD_MESSAGE_REACTIONS']
    });

    await this.discordClient.login('your-bot-token');
  }

  // Create new discussion for a proposal
  async createDiscussion(proposal: {
    id: string;
    title: string;
    description: string;
  }): Promise<{ threadId: string }> {
    try {
      // Create Discord thread
      const channel = await this.discordClient.channels.fetch(this.DISCORD_CHANNEL_ID);
      const embed = new MessageEmbed()
        .setTitle(`📋 New Proposal: ${proposal.title}`)
        .setDescription(proposal.description)
        .setURL(`your-app-url/proposals/${proposal.id}`)
        .setColor('#0099ff');

      const message = await channel.send({ embeds: [embed] });
      const thread = await message.startThread({
        name: `Discussion: ${proposal.title}`,
        autoArchiveDuration: 60 * 24, // 24 hours
      });

      // Store thread reference
      await this.storeDiscordThread({
        proposalId: proposal.id,
        channelId: this.DISCORD_CHANNEL_ID,
        threadId: thread.id,
        lastSynced: Date.now(),
      });

      return { threadId: thread.id };
    } catch (error) {
      console.error('Error creating discussion:', error);
      throw error;
    }
  }

  // Add comment to both systems
  async addComment(proposalId: string, comment: {
    author: string;
    content: string;
    replyTo?: string;
  }): Promise<void> {
    try {
      // Add to built-in system
      const builtInComment: BuiltInComment = {
        id: Date.now().toString(),
        proposalId,
        author: comment.author,
        content: comment.content,
        timestamp: Date.now(),
        replyTo: comment.replyTo,
        reactions: [],
      };
      
      await this.storeBuiltInComment(builtInComment);

      // Add to Discord thread
      const thread = await this.getDiscordThread(proposalId);
      if (thread) {
        const discordThread = await this.discordClient.channels.fetch(thread.threadId);
        await discordThread.send({
          content: `**${comment.author}**: ${comment.content}`,
        });
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }

  // Get all comments for a proposal
  async getComments(proposalId: string): Promise<{
    builtInComments: BuiltInComment[];
    discordMessages: any[];
  }> {
    try {
      // Get built-in comments
      const builtInComments = await this.getBuiltInComments(proposalId);

      // Get Discord messages
      const thread = await this.getDiscordThread(proposalId);
      let discordMessages = [];
      
      if (thread) {
        const discordThread = await this.discordClient.channels.fetch(thread.threadId);
        const messages = await discordThread.messages.fetch();
        discordMessages = messages.map(msg => ({
          id: msg.id,
          author: msg.author.username,
          content: msg.content,
          timestamp: msg.createdTimestamp,
          reactions: msg.reactions.cache.map(reaction => ({
            type: reaction.emoji.name,
            count: reaction.count,
          })),
        }));
      }

      return {
        builtInComments,
        discordMessages,
      };
    } catch (error) {
      console.error('Error getting comments:', error);
      throw error;
    }
  }

  // Sync comments between systems
  async syncComments(proposalId: string): Promise<void> {
    try {
      const thread = await this.getDiscordThread(proposalId);
      if (!thread) return;

      const discordThread = await this.discordClient.channels.fetch(thread.threadId);
      const messages = await discordThread.messages.fetch();

      // Get new messages since last sync
      const newMessages = messages.filter(msg => 
        msg.createdTimestamp > thread.lastSynced
      );

      // Add new Discord messages to built-in system
      for (const msg of newMessages.values()) {
        if (!msg.author.bot) {
          await this.storeBuiltInComment({
            id: msg.id,
            proposalId,
            author: msg.author.username,
            content: msg.content,
            timestamp: msg.createdTimestamp,
            reactions: msg.reactions.cache.map(reaction => ({
              type: reaction.emoji.name,
              count: reaction.count,
              users: [],
            })),
          });
        }
      }

      // Update last sync time
      await this.updateThreadSyncTime(proposalId, Date.now());
    } catch (error) {
      console.error('Error syncing comments:', error);
      throw error;
    }
  }

  // Storage helpers
  private async storeBuiltInComment(comment: BuiltInComment): Promise<void> {
    const comments = await this.getBuiltInComments(comment.proposalId);
    comments.push(comment);
    await AsyncStorage.setItem(
      `${this.COMMENTS_KEY}_${comment.proposalId}`,
      JSON.stringify(comments)
    );
  }

  private async getBuiltInComments(proposalId: string): Promise<BuiltInComment[]> {
    const stored = await AsyncStorage.getItem(`${this.COMMENTS_KEY}_${proposalId}`);
    return stored ? JSON.parse(stored) : [];
  }

  private async storeDiscordThread(thread: DiscordThread): Promise<void> {
    const threads = await this.getDiscordThreads();
    threads.push(thread);
    await AsyncStorage.setItem(this.DISCORD_THREADS_KEY, JSON.stringify(threads));
  }

  private async getDiscordThreads(): Promise<DiscordThread[]> {
    const stored = await AsyncStorage.getItem(this.DISCORD_THREADS_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  private async getDiscordThread(proposalId: string): Promise<DiscordThread | null> {
    const threads = await this.getDiscordThreads();
    return threads.find(t => t.proposalId === proposalId) || null;
  }

  private async updateThreadSyncTime(proposalId: string, timestamp: number): Promise<void> {
    const threads = await this.getDiscordThreads();
    const threadIndex = threads.findIndex(t => t.proposalId === proposalId);
    if (threadIndex >= 0) {
      threads[threadIndex].lastSynced = timestamp;
      await AsyncStorage.setItem(this.DISCORD_THREADS_KEY, JSON.stringify(threads));
    }
  }
}

export const hybridDiscussionService = new HybridDiscussionService();