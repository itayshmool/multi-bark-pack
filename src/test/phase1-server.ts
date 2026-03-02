#!/usr/bin/env node
/**
 * Phase 1: Server Module Tests
 *
 * Tests individual server modules in isolation
 * Run: npx tsx src/test/phase1-server.ts
 */

import assert from 'node:assert';
import { genId } from '../server/state.js';
import { sanitizeName } from '../server/naming.js';
import { timeSince } from '../server/status.js';

interface TestResult {
  passed: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
}

const results: TestResult = { passed: 0, failed: 0, errors: [] };

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    results.passed++;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`  ❌ ${name}`);
    console.log(`     ${message}`);
    results.failed++;
    results.errors.push({ name, error: message });
  }
}

// ============================================
// Test Suite 1: ID Generation
// ============================================

console.log('\n📦 ID Generation Tests\n');

test('genId returns 6-char hex string', () => {
  const id = genId();
  assert(typeof id === 'string', 'should be string');
  assert.strictEqual(id.length, 6, 'should be 6 chars');
  assert(/^[0-9a-f]{6}$/.test(id), 'should be hex');
});

test('genId returns unique IDs', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(genId());
  }
  assert.strictEqual(ids.size, 100, 'should generate 100 unique IDs');
});

// ============================================
// Test Suite 2: Name Sanitization
// ============================================

console.log('\n📦 Name Sanitization Tests\n');

test('sanitizeName returns null for empty input', () => {
  assert.strictEqual(sanitizeName(''), null);
  assert.strictEqual(sanitizeName(null), null);
  assert.strictEqual(sanitizeName(undefined), null);
});

test('sanitizeName capitalizes first letter', () => {
  const name = sanitizeName('chase');
  assert(name, 'should return a name');
  assert.strictEqual(name[0], name[0].toUpperCase(), 'first letter should be capitalized');
});

test('sanitizeName removes special characters', () => {
  const name = sanitizeName('test@name!');
  assert(name, 'should return a name');
  assert(!/[@!]/.test(name), 'should not contain special characters');
});

// ============================================
// Test Suite 3: Time Formatting
// ============================================

console.log('\n📦 Time Formatting Tests\n');

test('timeSince returns string', () => {
  const result = timeSince(new Date());
  assert(typeof result === 'string', 'should return string');
});

test('timeSince handles recent dates', () => {
  const result = timeSince(new Date(Date.now() - 30000)); // 30 seconds ago
  assert(result.includes('s') || result.includes('sec') || result.includes('just'), 'should show seconds or "just now"');
});

test('timeSince handles minutes', () => {
  const result = timeSince(new Date(Date.now() - 5 * 60 * 1000)); // 5 minutes ago
  assert(result.includes('m') || result.includes('min'), 'should show minutes');
});

test('timeSince handles hours', () => {
  const result = timeSince(new Date(Date.now() - 3 * 60 * 60 * 1000)); // 3 hours ago
  assert(result.includes('h') || result.includes('hour'), 'should show hours');
});

// ============================================
// Summary
// ============================================

console.log('\n' + '='.repeat(50));
console.log(`\n📊 Results: ${results.passed} passed, ${results.failed} failed\n`);

if (results.failed > 0) {
  console.log('❌ Failures:');
  for (const { name, error } of results.errors) {
    console.log(`   - ${name}: ${error}`);
  }
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
  process.exit(0);
}
