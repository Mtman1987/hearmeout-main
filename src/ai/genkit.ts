// Genkit is loaded dynamically at runtime only
// This file exists so imports don't break but does nothing at build time

let _ai: any = null;

export function getAi(): any {
  if (_ai) return _ai;
  // Dynamic require at runtime — never during build
  const { genkit } = require('genkit');
  const { googleAI } = require('@genkit-ai/google-genai');
  _ai = genkit({ plugins: [googleAI()], model: 'googleai/gemini-2.5-flash' });
  return _ai;
}

// Dummy export for backward compat — not used by rewritten flows
export const ai = {} as any;
