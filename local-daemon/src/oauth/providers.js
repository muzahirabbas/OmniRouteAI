/**
 * OAuth Provider Configuration for CLI Impersonation.
 * 
 * These Client IDs are extracted from official CLI tools.
 */
export const OAUTH_PROVIDERS = {
  claude: {
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    tokenUrl: "https://api.anthropic.com/v1/oauth/token",
    refreshUrl: "https://api.anthropic.com/v1/oauth/token"
  },
  gemini: {
    // These are public Client IDs for Google tools.
    // We use environment variables to avoid GitHub push protection.
    clientId: process.env.GOOGLE_CLI_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLI_CLIENT_SECRET,
    tokenUrl: "https://oauth2.googleapis.com/token"
  },
  qwen: {
    clientId: "f0304373b74a44d2b584a3fb70ca9e56",
    tokenUrl: "https://chat.qwen.ai/api/v1/oauth2/token"
  },
  codex: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    tokenUrl: "https://auth.openai.com/oauth/token"
  }
};
