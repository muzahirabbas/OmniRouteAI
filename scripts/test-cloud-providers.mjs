#!/usr/bin/env node
/**
 * OmniRouteAI - Cloud Provider Health Check Script
 * 
 * Tests remote REST API provider connections without requiring valid API keys.
 * A response of 401 Unauthorized / Invalid API Key is considered a SUCCESS, 
 * because it proves our endpoint, headers, and payload formats are correctly hitting the remote server.
 */

import { GroqAdapter } from '../src/adapters/groqAdapter.js';
import { GeminiAdapter } from '../src/adapters/geminiAdapter.js';
import { AnthropicAdapter } from '../src/adapters/anthropicAdapter.js';
import { OpenAIAdapter } from '../src/adapters/openaiAdapter.js';
import { InceptionAdapter } from '../src/adapters/inceptionAdapter.js';
import { OllamaCloudAdapter } from '../src/adapters/ollamaCloudAdapter.js';
import { OpenRouterAdapter } from '../src/adapters/openrouterAdapter.js';
import { AlibabaAdapter } from '../src/adapters/alibabaAdapter.js';
import { CerebrasAdapter } from '../src/adapters/cerebrasAdapter.js';
import { CloudflareAdapter } from '../src/adapters/cloudflareAdapter.js';
import { CohereAdapter } from '../src/adapters/cohereAdapter.js';
import { DeepSeekAdapter } from '../src/adapters/deepseekAdapter.js';
import { HuggingFaceAdapter } from '../src/adapters/huggingfaceAdapter.js';
import { MoonshotAdapter } from '../src/adapters/moonshotAdapter.js';
import { NvidiaAdapter } from '../src/adapters/nvidiaAdapter.js';
import { SambaNovaAdapter } from '../src/adapters/sambanovaAdapter.js';
import { TogetherAdapter } from '../src/adapters/togetherAdapter.js';
import { XAIAdapter } from '../src/adapters/xaiAdapter.js';
import { XiaomiAdapter } from '../src/adapters/xiaomiAdapter.js';

// Mock Config specifically for Cloudflare to bypass configuration checks in the test environment
process.env.CF_ACCOUNT_ID = 'test-account-id';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

const TEST_PROMPT = "This is an automated health check.";
const RANDOM_API_KEY = "sk-test-invalid-key-1234567890abcdef";

const PROVIDERS = [
  { name: 'Groq',         model: 'llama3-8b-8192',       AdapterClass: GroqAdapter },
  { name: 'Gemini',       model: 'gemini-1.5-flash',     AdapterClass: GeminiAdapter },
  { name: 'Anthropic',    model: 'claude-3-haiku-20240307',AdapterClass: AnthropicAdapter },
  { name: 'OpenAI',       model: 'gpt-4o-mini',          AdapterClass: OpenAIAdapter },
  { name: 'Inception',    model: 'inception-base',       AdapterClass: InceptionAdapter },
  { name: 'Ollama-Cloud', model: 'llama3',               AdapterClass: OllamaCloudAdapter },
  { name: 'OpenRouter',   model: 'openrouter/auto',      AdapterClass: OpenRouterAdapter },
  { name: 'Alibaba',      model: 'qwen-turbo',           AdapterClass: AlibabaAdapter },
  { name: 'Cerebras',     model: 'llama3.1-8b',          AdapterClass: CerebrasAdapter },
  { name: 'Cloudflare',   model: '@cf/meta/llama-3-8b-instruct', AdapterClass: CloudflareAdapter },
  { name: 'Cohere',       model: 'command-r-plus',       AdapterClass: CohereAdapter },
  { name: 'DeepSeek',     model: 'deepseek-chat',        AdapterClass: DeepSeekAdapter },
  { name: 'HuggingFace',  model: 'meta-llama/Meta-Llama-3-8B-Instruct', AdapterClass: HuggingFaceAdapter },
  { name: 'Moonshot',     model: 'moonshot-v1-8k',       AdapterClass: MoonshotAdapter },
  { name: 'NVIDIA',       model: 'mistralai/mixtral-8x7b-instruct-v0.1', AdapterClass: NvidiaAdapter },
  { name: 'SambaNova',    model: 'Meta-Llama-3.1-8B-Instruct', AdapterClass: SambaNovaAdapter },
  { name: 'Together',     model: 'meta-llama/Llama-2-70b-chat-hf', AdapterClass: TogetherAdapter },
  { name: 'xAI',          model: 'grok-beta',            AdapterClass: XAIAdapter },
  { name: 'Xiaomi',       model: 'mi-mix',               AdapterClass: XiaomiAdapter },
];

function log(level, msg) {
  const ts = new Date().toLocaleTimeString();
  const color = level === 'OK' ? GREEN : level === 'FAIL' ? RED : YELLOW;
  console.log(`[${ts}] ${color}${BOLD}${level}${RESET} ${msg}`);
}

async function testAdapter(provider) {
  const adapter = new provider.AdapterClass();
  try {
    // Send a non-streaming request
    await adapter.sendRequest(TEST_PROMPT, provider.model, RANDOM_API_KEY);
    
    // If it unbelievably succeeds with a fake key
    return { ok: true, detail: 'Succeeded (Unexpected, fake key accepted?)' };
  } catch (err) {
    // We EXPECT an error here.
    const msg = err.message || err.toString();
    const status = err.status || err.statusCode;

    // Different APIs throw 401 Unauthorized, 403 Forbidden, 400 Bad Request, or invalid token messages.
    const isAuthError = 
      status === 401 || 
      status === 403 || 
      msg.toLowerCase().includes('key') || 
      msg.toLowerCase().includes('auth') || 
      msg.toLowerCase().includes('token') ||
      msg.toLowerCase().includes('unauthorized') ||
      msg.toLowerCase().includes('invalid');

    if (isAuthError) {
      return { ok: true, detail: `Reached API successfully (Rejected key: ${msg.split('\n')[0].substring(0, 100)})` };
    } else {
      return { ok: false, detail: `Failed with unexpected error: ${msg.split('\n')[0].substring(0, 100)}` };
    }
  }
}

async function main() {
  console.log(`\n${BOLD}OmniRouteAI — Cloud Provider Health Check${RESET}`);
  console.log(`Validating API endpoints using dummy token '${RANDOM_API_KEY}'\n`);

  const results = [];

  for (const provider of PROVIDERS) {
    process.stdout.write(`  Testing ${provider.name.padEnd(15)} ... `);
    const { ok, detail } = await testAdapter(provider);
    results.push({ name: provider.name, ok, detail });
    
    const symbol = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`${symbol}  ${detail}`);
  }

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log(`\n${BOLD}─────────── Summary ───────────${RESET}`);
  console.log(`${GREEN}Passed: ${passed}${RESET}  ${RED}Failed: ${failed}${RESET}  Total: ${results.length}`);

  if (failed > 0) {
    console.log(`\n${BOLD}Failed integrations (Check network/endpoints):${RESET}`);
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  ${RED}✗ ${r.name}${RESET}: ${r.detail}`);
    });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
