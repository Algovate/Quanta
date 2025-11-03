import assert from 'node:assert';
import { parseAiResponse } from '../src/ai/prompt-parser.js';

/**
 * Test enhanced prompt parsing logic
 * Validates that the prompt parser correctly handles <output> tags
 */

async function testEnhancedFormatWithTags() {
  const response = `<thinking>
ASSESS: BTC showing strong bullish structure, indicators align.
EVALUATE: Good RR, confidence 0.82.
DECIDE: LONG entry.
VALIDATE: All checks pass.
</thinking>

<output>
{
  "signals": [
    {
      "coin": "BTC",
      "action": "LONG",
      "confidence": 0.82,
      "reasoning": "Strong uptrend",
      "entry_price": 50000,
      "position_size": 0.1,
      "stop_loss": 0.03,
      "profit_target": 0.06,
      "invalidation_condition": "Price closes below $48500",
      "leverage": 8
    }
  ]
}
</output>`;

  const result = parseAiResponse(response);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].coin, 'BTC');
  assert.strictEqual(result[0].action, 'LONG');
  assert.strictEqual(result[0].confidence, 0.82);
}

async function testRejectionEmptySignals() {
  const response = `<thinking>
ASSESS: Setup decent but...
VALIDATE: Would exceed max risk. Must REJECT.
</thinking>

<output>
{"signals": []}
</output>`;

  const result = parseAiResponse(response);
  assert.strictEqual(result.length, 0);
}

async function testLegacyFormat() {
  const response = `{
  "signals": [
    {
      "coin": "ETH",
      "action": "SHORT",
      "confidence": 0.75,
      "reasoning": "Bearish setup",
      "entry_price": 3000,
      "position_size": 2.0,
      "stop_loss": 0.04,
      "profit_target": 0.08,
      "leverage": 5
    }
  ]
}`;

  const result = parseAiResponse(response);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].coin, 'ETH');
  assert.strictEqual(result[0].action, 'SHORT');
}

async function testMultipleSignals() {
  const response = `<thinking>
Two good setups identified.
</thinking>

<output>
{
  "signals": [
    {
      "coin": "BTC",
      "action": "LONG",
      "confidence": 0.85,
      "reasoning": "Strong uptrend",
      "entry_price": 50000,
      "position_size": 0.1,
      "stop_loss": 0.03,
      "profit_target": 0.06,
      "leverage": 10
    },
    {
      "coin": "ETH",
      "action": "CLOSE",
      "confidence": 0.9,
      "reasoning": "Profit target reached"
    }
  ]
}
</output>`;

  const result = parseAiResponse(response);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].coin, 'BTC');
  assert.strictEqual(result[1].coin, 'ETH');
}

async function testMalformedJSON() {
  const response = `<thinking>
Some reasoning here.
</thinking>

<output>
{
  "signals": [
    {
      "coin": "BTC",
      // missing comma
      "action": "LONG"
    }
  ]
}
</output>`;

  const result = parseAiResponse(response);
  assert.strictEqual(result.length, 0);
}

async function testNoSignalsField() {
  const response = `<output>
{"error": "Something went wrong"}
</output>`;

  const result = parseAiResponse(response);
  assert.strictEqual(result.length, 0);
}

async function run() {
  const tests = [
    { name: 'Enhanced format with tags', fn: testEnhancedFormatWithTags },
    { name: 'Rejection empty signals', fn: testRejectionEmptySignals },
    { name: 'Legacy format', fn: testLegacyFormat },
    { name: 'Multiple signals', fn: testMultipleSignals },
    { name: 'Malformed JSON', fn: testMalformedJSON },
    { name: 'No signals field', fn: testNoSignalsField },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      console.log(`✓ ${test.name}`);
      passed++;
    } catch (e) {
      console.error(`✗ ${test.name}:`, (e as Error)?.message);
      failed++;
    }
  }

  console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void run();

