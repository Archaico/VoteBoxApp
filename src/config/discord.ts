// src/config/discord.ts
//
// VoteBox Discord Integration Configuration
// ─────────────────────────────────────────────────────────────────────────────
// 
// HARDCODED configuration (no environment variables)
// Discord is DISABLED by default - enable when ready to test
//
// ─────────────────────────────────────────────────────────────────────────────

export const DISCORD_CONFIG = {
  // Your Discord webhook URL
  WEBHOOK_URL: 'https://discord.com/api/webhooks/1474477381648384052/w5vDU9_K-qfHKvDh8wrOfsigd4-5CgeE6E6Jm6ey2MBMb7IKCjrakTILHaf-KzzaEXOe',
  
  // Feature flag - DISABLED by default
  // Change to true when ready to test Discord integration
  ENABLED: false,
  
  // Optional: Discord server invite link
  // Add this if you want an "Join Discord" button in the app
  SERVER_INVITE_URL: '',
};

// Debug logging (only in development)
if (__DEV__) {
  console.log('[Discord Config]', {
    enabled: DISCORD_CONFIG.ENABLED,
    hasWebhook: !!DISCORD_CONFIG.WEBHOOK_URL,
    hasInvite: !!DISCORD_CONFIG.SERVER_INVITE_URL,
  });
}
