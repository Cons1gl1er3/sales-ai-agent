import * as dotenv from "dotenv";
import { resolve } from "path";

// Load environment variables from .env file
dotenv.config({ path: resolve(__dirname, "../.env") });

// Bot configuration
export const botConfig = {
  host: process.env.BOT_HOST || "0.0.0.0",
  port: parseInt(process.env.BOT_PORT || "8766"),
  audioParams: {
    sampleRate: 24000,
  },
};

// Proxy configuration
export const proxyConfig = {
  host: process.env.PROXY_HOST || "0.0.0.0",
  port: parseInt(process.env.PROXY_PORT || "8765"),
  botUrl: process.env.BOT_URL || "ws://localhost:8766",
  audioParams: {
    sampleRate: 24000,
    channels: 1,
  },
};

// API keys
export const apiKeys = {
  meetingBaas: process.env.MEETING_BAAS_API_KEY || "",
  openai: process.env.OPENAI_API_KEY || "",
};

// API URLs
export const apiUrls = {
  meetingBaas:
    process.env.MEETING_BAAS_API_URL || "https://api.meetingbaas.com",
};

if (!apiKeys.openai) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}
