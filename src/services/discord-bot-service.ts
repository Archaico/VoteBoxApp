// src/services/DiscordBotService.ts
import { Client, Intents, TextChannel, ThreadChannel } from 'discord.js';
import { config } from '../config';

export class DiscordBotService {
  private client: Client;
  private readonly GUILD_ID = config.DISCORD_GUILD_ID;
  private readonly PROPOSALS_CHANNEL_ID = config.DISCORD_PROPOSALS_CHANNEL_ID;

  constructor() {
    this.client = new Client({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Intents.FLAGS.GUILD_MEMBERS,
      ],
    });

    this.initializeBot();
  }

  private async initializeBot() {
    this.client.on('ready', () => {
      console.log(`Discord bot logged in as ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', this.handleMessage.bind(this));
    this.client.on('threadCreate', this.handleThreadCreate.bind(this));

    await this.client.login(config.DISCORD_BOT_TOKEN);
  }

  async createProposalThread(proposal: {
    id: string;
    title: string;
    description: string;
    author: string;
  }): Promise<string> {
    const channel = await this.client.channels.fetch(this.PROPOSALS_CHANNEL_ID) as TextChannel;
    
    const thread = await channel.threads.create({
      name: `📋 ${proposal.title}`,
      autoArchiveDuration: 60 * 24,
    });

    await thread.send({
      embeds: [{
        title: proposal.title,
        description: proposal.description,
        color: 0x0099ff,
        fields: [
          {
            name: 'Author',
            value: proposal.author,
            inline: true,
          },
          {
            name: 'Proposal ID',
            value: proposal.id,
            inline: true,
          },
        ],
        footer: {
          text: 'React with 👍 to follow this proposal',
        },
      }],
    });

    return thread.id;
  }

  async sendNotification(threadId: string, message: string): Promise<void> {
    const thread = await this.client.channels.fetch(threadId) as ThreadChannel;
    await thread.send(message);
  }

  private async handleMessage(message: any) {
    // Handle incoming Discord messages
    if (message.author.bot) return;

    // Sync message to app's built-in discussion system
    await hybridDiscussionService.syncDiscordMessage({
      threadId: message.channel.id,
      content: message.content,
      author: message.author.username,
      timestamp: message.createdTimestamp,
    });
  }

  private async handleThreadCreate(thread: ThreadChannel) {
    // Set up thread monitoring and notifications
    await this.setupThreadNotifications(thread);
  }

  private async setupThreadNotifications(thread: ThreadChannel) {
    // Monitor thread for activity
    thread.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      // Notify subscribers
      const subscribers = await this.getThreadSubscribers(thread.id);
      for (const subscriber of subscribers) {
        await notificationService.sendNotification(subscriber, {
          title: `New message in ${thread.name}`,
          body: `${message.author.username}: ${message.content.substring(0, 100)}...`,
          data: {
            type: 'discussion',
            threadId: thread.id,
          },
        });
      }
    });
  }

  private async getThreadSubscribers(threadId: string): Promise<string[]> {
    // Get users who reacted with 👍
    const thread = await this.client.channels.fetch(threadId) as ThreadChannel;
    const messages = await thread.messages.fetch();
    const firstMessage = messages.first();
    
    if (!firstMessage) return [];

    const reaction = firstMessage.reactions.cache.get('👍');
    if (!reaction) return [];

    const users = await reaction.users.fetch();
    return users.filter(user => !user.bot).map(user => user.id);
  }
}

export const discordBotService = new DiscordBotService();