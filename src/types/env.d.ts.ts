// src/types/env.d.ts
//
// TypeScript declarations for environment variables
// This tells TypeScript about the variables imported from @env

declare module '@env' {
  export const DISCORD_WEBHOOK_URL: string;
  export const DISCORD_ENABLED: string;
  export const DISCORD_SERVER_INVITE: string;
}
