/**
 * Token estimation service.
 * 
 * Uses tiktoken for accurate token counting when available.
 * Falls back to character-based estimation for offline/simple use.
 * 
 * Installation (optional):
 *   npm install tiktoken
 * 
 * tiktoken provides accurate token counts for:
 * - OpenAI models (gpt-*, o1, o3)
 * - Anthropic models (claude-*)
 * - And many more
 */

let tiktoken = null;
let tiktokenEncoder = null;

/**
 * Try to load tiktoken dynamically (optional dependency).
 * @returns {Promise<boolean>} true if tiktoken is available
 */
async function loadTiktoken() {
  if (tiktoken !== null) return tiktoken !== null;
  
  try {
    // Dynamic import - tiktoken is optional
    tiktoken = await import('tiktoken');
    return true;
  } catch {
    // tiktoken not installed - use fallback estimation
    tiktoken = false;
    return false;
  }
}

/**
 * Get or create a tiktoken encoder for a specific model.
 * @param {string} model - Model name (e.g., 'gpt-4', 'claude-3')
 * @returns {Promise<object|null>} Encoder or null if tiktoken not available
 */
async function getEncoder(model) {
  if (!(await loadTiktoken())) return null;
  
  // Map common model names to tiktoken model identifiers
  const modelMap = {
    // OpenAI
    'gpt-4': 'gpt-4',
    'gpt-4o': 'gpt-4o',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    'gpt-5': 'gpt-4o', // Use gpt-4o as approximation
    'o1': 'o2024-11-20',
    'o1-mini': 'o2024-11-20',
    'o3-mini': 'o2024-11-20',
    
    // Anthropic (approximate with cl100k_base)
    'claude': 'claude',
    
    // Default fallback
    'default': 'gpt-3.5-turbo',
  };
  
  // Find best matching encoder
  let encoderName = 'gpt-3.5-turbo'; // Default fallback
  
  for (const [pattern, name] of Object.entries(modelMap)) {
    if (model.toLowerCase().includes(pattern)) {
      encoderName = name;
      break;
    }
  }
  
  // Cache encoder for reuse
  if (!tiktokenEncoder || tiktokenEncoder.model !== encoderName) {
    try {
      const { get_encoding } = tiktoken;
      tiktokenEncoder = {
        model: encoderName,
        encoder: get_encoding(encoderName),
      };
    } catch {
      return null;
    }
  }
  
  return tiktokenEncoder.encoder;
}

/**
 * Estimate tokens using tiktoken (accurate) or fallback (approximate).
 * 
 * @param {string|Array} text - Text or multimodal array to count tokens for
 * @param {string} [model] - Optional model name for tiktoken
 * @returns {Promise<number>} Token count
 */
export async function countTokens(text, model = 'gpt-3.5-turbo') {
  if (!text) return 0;

  // 1. Handle multimodal content (array of parts)
  if (Array.isArray(text)) {
    let total = 0;
    for (const part of text) {
      if (typeof part === 'string') {
        total += await countTokens(part, model);
      } else if (part.type === 'text' && part.text) {
        total += await countTokens(part.text, model);
      } else if (part.type === 'image_url' || part.type === 'image') {
        // High-level heuristic: ~1000 tokens for vision
        // (OpenAI uses ~170-1105, Gemini 258, Anthropic ~1600)
        total += 1000;
      } else if (part.type === 'audio' || part.type === 'video') {
        // Size-based heuristic for large media: 1MB ≈ 2000 tokens
        // (Gemini uses ~32 tokens per second of audio)
        const bytes = part.data ? (part.data.length * 3) / 4 : 0;
        const mb = bytes / (1024 * 1024);
        total += Math.max(100, Math.ceil(mb * 2000));
      }
    }
    return total;
  }
  
  // 2. Handle simple text
  // Try tiktoken first
  const encoder = await getEncoder(model);
  if (encoder) {
    try {
      const tokens = encoder.encode(text);
      return tokens.length;
    } catch {
      // Fall through to estimation
    }
  }
  
  // Fallback: character-based estimation
  // More accurate than simple /4: accounts for word boundaries
  return estimateTokensFallback(text);
}

/**
 * Fallback token estimation when tiktoken is not available.
 * Uses a more sophisticated algorithm than simple character division.
 * 
 * @param {string} text
 * @returns {number}
 */
function estimateTokensFallback(text) {
  if (!text) return 0;
  
  // Split into words (handles multiple languages better)
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  // Average tokens per word varies by language:
  // - English: ~1.3 tokens/word (subword tokenization)
  // - Code: ~1.5 tokens/word (more special characters)
  // - Mixed: ~1.4 tokens/word average
  
  // Simple heuristic: count words + punctuation
  const punctuation = (text.match(/[.,!?;:'"(){}\[\]<>]/g) || []).length;
  const numbers = (text.match(/\d+/g) || []).length;
  
  // Base estimate: words * 1.3 (average for English text)
  const baseTokens = Math.ceil(words.length * 1.3);
  
  // Add extra for punctuation and numbers (they often become separate tokens)
  const extraTokens = Math.ceil((punctuation + numbers) * 0.5);
  
  return baseTokens + extraTokens;
}

/**
 * Legacy estimateTokens function (for backward compatibility).
 * Uses simple character-based estimation.
 * 
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate input tokens BEFORE sending a request.
 * This is called by routerService before the request to ensure
 * input token counts are always available for quota accounting.
 *
 * @param {string} prompt
 * @param {string} [systemPrompt='']
 * @param {string} [model='gpt-3.5-turbo']
 * @returns {Promise<number>}
 */
export async function estimateInputTokens(prompt, systemPrompt = '', model = 'gpt-3.5-turbo') {
  const combined = (systemPrompt ? systemPrompt + '\n' : '') + (prompt || '');
  return countTokens(combined, model);
}

/**
 * Clean up tiktoken encoder (call on shutdown).
 */
export function cleanupTiktoken() {
  if (tiktokenEncoder?.encoder) {
    try {
      tiktokenEncoder.encoder.free();
    } catch {}
  }
  tiktokenEncoder = null;
}
