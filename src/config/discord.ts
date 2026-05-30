// src/config/discord.ts
//
// VoteBox Discord Integration Configuration
// ─────────────────────────────────────────────────────────────────────────────
// Webhook URL is loaded from EXPO_PUBLIC_DISCORD_WEBHOOK_URL in .env
// Never hardcode the webhook URL — it grants public posting rights to your channel.
// ─────────────────────────────────────────────────────────────────────────────

export const DISCORD_CONFIG = {
  WEBHOOK_URL: process.env.EXPO_PUBLIC_DISCORD_WEBHOOK_URL ?? '',

  // Feature flag - DISABLED by default
  // Change to true when ready to test Discord integration
  ENABLED: false,

  // Optional: Discord server invite link
  SERVER_INVITE_URL: '',
};

if (__DEV__) {
  console.log('[Discord Config]', {
    enabled: DISCORD_CONFIG.ENABLED,
    hasWebhook: !!DISCORD_CONFIG.WEBHOOK_URL,
    hasInvite: !!DISCORD_CONFIG.SERVER_INVITE_URL,
  });
}
