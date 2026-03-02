#!/usr/bin/env node
/**
 * Run all Phase 1 tests
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [
  'phase1.ts',
  'phase1-server.ts',
];

console.log('🧪 Running Phase 1 Tests\n');
console.log('='.repeat(50) + '\n');

let allPassed = true;

for (const test of tests) {
  console.log(`\n🔬 Running ${test}...\n`);

  try {
    execSync(`npx tsx ${path.join(__dirname, test)}`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..'),
    });
  } catch {
    allPassed = false;
  }
}

console.log('\n' + '='.repeat(50));

if (allPassed) {
  console.log('\n🎉 All test suites passed!\n');
  process.exit(0);
} else {
  console.log('\n💥 Some tests failed!\n');
  process.exit(1);
}
