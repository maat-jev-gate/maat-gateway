/*
 * https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe
 */

import { readFile } from 'node:fs/promises';

const envText = await readFile(new URL('./.env', import.meta.url), 'utf8');

for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match || line.trimStart().startsWith('#')) continue;

  const [, name, rawValue] = match;
  const value = rawValue.replace(/^("|')(.*)\1$/, '$2');
  if (!(name in process.env)) process.env[name] = value;
}

const { AI_GATEWAY_BASE_URL, AI_GATEWAY_API_KEY, AI_GATEWAY_JEV_MODEL } = process.env;

if (!AI_GATEWAY_BASE_URL || !AI_GATEWAY_API_KEY || !AI_GATEWAY_JEV_MODEL) {
  throw new Error(
    'Configure AI_GATEWAY_BASE_URL, AI_GATEWAY_API_KEY, and AI_GATEWAY_JEV_MODEL in .env.',
  );
}

const endpoint = new URL(
  'evaluate',
  `${AI_GATEWAY_BASE_URL.replace(/\/+$/, '')}/`,
);

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: AI_GATEWAY_JEV_MODEL,
    state: 'The customer says: The app crashes as soon as it opens. Please refund my subscription.',
    questions: {
      refund_requested: {
        type: 'boolean',
        instructions: 'Is the customer explicitly requesting a refund?',
      },
    },
  }),
});

const result = await response.json();

if (!response.ok) {
  throw new Error(`Jev request failed (HTTP ${response.status}): ${JSON.stringify(result)}`);
}

const probability = result.answers.refund_requested.probability;
console.log(`Refund request probability: ${probability}`);
console.log(`Classification: ${probability >= 0.5 ? 'Yes' : 'No'}`);
console.log('\nFull response:');
console.log(JSON.stringify(result, null, 2));
