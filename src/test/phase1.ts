#!/usr/bin/env node
/**
 * Phase 1: Backend Parity Tests
 *
 * Tests that multi-bark-pack works identically to bark-pack
 * Run: npx tsx src/test/phase1.ts
 */

import assert from 'node:assert';
import * as backends from '../backends/index.js';
import createClaudeCodeBackend from '../backends/claude-code.js';
import * as streamParsers from '../stream-parsers/index.js';
import claudeParser from '../stream-parsers/claude.js';

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

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
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
// Test Suite 1: Backend Module
// ============================================

console.log('\n📦 Backend Module Tests\n');

test('backends module loads', () => {
  assert(backends, 'backends module should exist');
  assert(typeof backends.initialize === 'function', 'should have initialize function');
  assert(typeof backends.get === 'function', 'should have get function');
  assert(typeof backends.list === 'function', 'should have list function');
});

test('claude-code backend factory works', () => {
  const backend = createClaudeCodeBackend();
  assert(backend, 'backend should be created');
  assert.strictEqual(backend.name, 'claude-code');
  assert.strictEqual(backend.displayName, 'Claude Code');
});

test('claude-code backend has required interface', () => {
  const backend = createClaudeCodeBackend();

  // Identity
  assert(backend.name, 'should have name');
  assert(backend.displayName, 'should have displayName');

  // Availability
  assert(typeof backend.isInstalled === 'function', 'should have isInstalled');
  assert(typeof backend.getVersion === 'function', 'should have getVersion');

  // Models
  assert(Array.isArray(backend.models), 'should have models array');
  assert(backend.defaultModel, 'should have defaultModel');
  assert(typeof backend.validateModel === 'function', 'should have validateModel');

  // Session
  assert(typeof backend.canResume === 'boolean', 'should have canResume');
  assert(typeof backend.generateSessionId === 'function', 'should have generateSessionId');

  // Command building
  assert(typeof backend.buildCommand === 'function', 'should have buildCommand');

  // Capabilities
  assert(backend.capabilities, 'should have capabilities');
  assert(typeof backend.capabilities.streaming === 'boolean');
  assert(typeof backend.capabilities.sessionPersistence === 'boolean');
});

test('claude-code generateSessionId returns UUID', () => {
  const backend = createClaudeCodeBackend();
  const sessionId = backend.generateSessionId();

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(uuidRegex.test(sessionId), `should be valid UUID, got: ${sessionId}`);
});

test('claude-code validateModel works', () => {
  const backend = createClaudeCodeBackend();

  assert(backend.validateModel('sonnet'), 'sonnet should be valid');
  assert(backend.validateModel('haiku'), 'haiku should be valid');
  assert(backend.validateModel('opus'), 'opus should be valid');
  assert(!backend.validateModel('gpt-4'), 'gpt-4 should be invalid');
});

test('claude-code buildCommand generates script', () => {
  const backend = createClaudeCodeBackend();

  const result = backend.buildCommand({
    promptFile: '/tmp/test.prompt',
    sessionId: 'test-session-id',
    isResume: false,
    model: 'sonnet',
    systemPromptFile: '/tmp/test.sysprompt',
    streamParserScript: '/tmp/stream-display.js',
    agentId: 'abc123',
    tmpDir: '/tmp',
  });

  assert(result.script, 'should return script');
  assert(result.script.includes('#!/bin/bash'), 'should be bash script');
  assert(result.script.includes('claude'), 'should invoke claude');
  assert(result.script.includes('--session-id'), 'should have session-id for new session');
  assert(result.script.includes('sonnet'), 'should include model');
});

test('claude-code buildCommand uses --resume for follow-up', () => {
  const backend = createClaudeCodeBackend();

  const result = backend.buildCommand({
    promptFile: '/tmp/test.prompt',
    sessionId: 'test-session-id',
    isResume: true,
    model: 'haiku',
    systemPromptFile: '/tmp/test.sysprompt',
    streamParserScript: '/tmp/stream-display.js',
    agentId: 'abc123',
    tmpDir: '/tmp',
  });

  assert(result.script.includes('--resume'), 'should use --resume for follow-up');
  assert(!result.script.includes('--system-prompt'), 'should not include system-prompt on resume');
});

// ============================================
// Test Suite 2: Stream Parser Module
// ============================================

console.log('\n📦 Stream Parser Tests\n');

test('stream-parsers module loads', () => {
  assert(streamParsers, 'stream-parsers module should exist');
  assert(typeof streamParsers.get === 'function', 'should have get function');
  assert(typeof streamParsers.list === 'function', 'should have list function');
});

test('claude parser is registered', () => {
  const parser = streamParsers.get('claude');
  assert(parser, 'claude parser should be registered');
  assert.strictEqual(parser.name, 'claude');
});

test('claude parser has required interface', () => {
  assert(claudeParser.name, 'should have name');
  assert(claudeParser.toolIcons, 'should have toolIcons');
  assert(typeof claudeParser.parseLine === 'function', 'should have parseLine');
  assert(typeof claudeParser.getToolIcon === 'function', 'should have getToolIcon');
});

test('claude parser parseLine handles text delta', () => {
  const line = JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello world' },
    },
  });

  const result = claudeParser.parseLine(line);
  assert(result, 'should return result');
  assert.strictEqual(result.type, 'text');
  assert.strictEqual(result.text, 'Hello world');
});

test('claude parser parseLine handles tool use', () => {
  const line = JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Bash' },
    },
  });

  const result = claudeParser.parseLine(line);
  assert(result, 'should return result');
  assert.strictEqual(result.type, 'tool');
  assert.strictEqual(result.name, 'Bash');
  assert.strictEqual(result.icon, '💻');
});

test('claude parser parseLine handles result', () => {
  const line = JSON.stringify({
    type: 'result',
    result: 'Task completed',
    is_error: false,
    total_cost_usd: 0.05,
  });

  const result = claudeParser.parseLine(line);
  assert(result, 'should return result');
  assert.strictEqual(result.type, 'result');
  assert.strictEqual(result.text, 'Task completed');
  assert.strictEqual(result.isError, false);
  assert.strictEqual(result.costUsd, 0.05);
});

test('claude parser parseLine returns null for invalid JSON', () => {
  const result = claudeParser.parseLine('not valid json');
  assert.strictEqual(result, null);
});

test('claude parser getToolIcon returns correct icons', () => {
  assert.strictEqual(claudeParser.getToolIcon('Bash'), '💻');
  assert.strictEqual(claudeParser.getToolIcon('Read'), '📖');
  assert.strictEqual(claudeParser.getToolIcon('Edit'), '✏️');
  assert.strictEqual(claudeParser.getToolIcon('Grep'), '🔍');
  assert.strictEqual(claudeParser.getToolIcon('UnknownTool'), '🔧');
});

// ============================================
// Test Suite 3: Backend Initialization
// ============================================

console.log('\n📦 Backend Initialization Tests\n');

(async () => {
  await testAsync('backends.initialize works', async () => {
    const result = await backends.initialize({
      enabledBackends: ['claude-code'],
      defaultBackend: 'claude-code',
    });

    assert(result, 'should return backends map');
    assert(result['claude-code'], 'should have claude-code backend');
  });

  await testAsync('backends.get returns initialized backend', async () => {
    const backend = backends.get('claude-code');
    assert(backend, 'should return backend');
    assert.strictEqual(backend.name, 'claude-code');
  });

  await testAsync('backends.getDefault returns default backend', async () => {
    const backend = backends.getDefault('claude-code');
    assert(backend, 'should return default backend');
  });

  await testAsync('backends.list returns backend info', async () => {
    const backendList = backends.list();
    assert(Array.isArray(backendList), 'should return array');
    assert(backendList.length > 0, 'should have at least one backend');

    const claude = backendList.find(b => b.name === 'claude-code');
    assert(claude, 'should include claude-code');
    assert(claude.models, 'should have models');
    assert(claude.capabilities, 'should have capabilities');
  });

  await testAsync('backends.isAvailable works', async () => {
    assert(backends.isAvailable('claude-code'), 'claude-code should be available');
    assert(!backends.isAvailable('nonexistent'), 'nonexistent should not be available');
  });

  await testAsync('backends.getCapabilityMatrix works', async () => {
    const matrix = backends.getCapabilityMatrix();
    assert(matrix.capabilities, 'should have capabilities list');
    assert(matrix.backends, 'should have backends map');
    assert(matrix.backends['claude-code'], 'should have claude-code capabilities');
  });

  await testAsync('backends.formatCapabilityMatrix returns string', async () => {
    const text = backends.formatCapabilityMatrix();
    assert(typeof text === 'string', 'should return string');
    assert(text.includes('Claude Code'), 'should include backend name');
  });

  // ============================================
  // Test Suite 4: Claude CLI Availability
  // ============================================

  console.log('\n📦 Claude CLI Tests\n');

  await testAsync('claude CLI is installed', async () => {
    const backend = backends.get('claude-code');
    assert(backend, 'should have backend');
    const installed = await backend.isInstalled();
    assert(installed, 'claude CLI should be installed');
  });

  await testAsync('claude CLI version is available', async () => {
    const backend = backends.get('claude-code');
    assert(backend, 'should have backend');
    const version = await backend.getVersion();
    assert(version, 'should return version string');
    console.log(`     (version: ${version.trim().substring(0, 50)})`);
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
})();
