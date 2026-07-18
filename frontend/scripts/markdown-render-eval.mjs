import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeAiMarkdown } from '../lib/markdown-normalize.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const fixtureDir = path.join(frontendRoot, 'fixtures', 'markdown-rendering');

function countChars(value) {
  return Array.from(String(value)).length;
}

function flattenStrings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenStrings);
  return [];
}

function assertIncludes(actual, expectedValues, label, failures) {
  for (const expected of expectedValues ?? []) {
    if (!actual.includes(expected)) {
      failures.push(`${label} missing expected text: ${JSON.stringify(expected)}`);
    }
  }
}

function assertForbidden(actual, forbiddenValues, label, failures) {
  for (const forbidden of forbiddenValues ?? []) {
    if (actual.includes(forbidden)) {
      failures.push(`${label} contains forbidden text: ${JSON.stringify(forbidden)}`);
    }
  }
}

function checkMarkdownFixture(fixture) {
  const failures = [];
  const normalized = normalizeAiMarkdown(String(fixture.input ?? ''));
  const expected = fixture.expected ?? {};

  assertIncludes(normalized, expected.normalizedIncludes, 'normalized', failures);
  assertForbidden(normalized, expected.forbiddenText, 'normalized', failures);

  return { failures, normalized };
}

function checkCardPreviewFixture(fixture) {
  const failures = [];
  const expected = fixture.expected ?? {};
  const values = flattenStrings(fixture.input);

  if (expected.type === 'stringArray' && !Array.isArray(fixture.input)) {
    failures.push('input must be a string array');
  }

  if (expected.type === 'objectStringArrays') {
    if (!fixture.input || typeof fixture.input !== 'object' || Array.isArray(fixture.input)) {
      failures.push('input must be an object of string arrays');
    } else {
      for (const [key, value] of Object.entries(fixture.input)) {
        if (!Array.isArray(value)) failures.push(`${key} must be a string array`);
      }
    }
  }

  if (expected.type === 'objectStrings') {
    if (!fixture.input || typeof fixture.input !== 'object' || Array.isArray(fixture.input)) {
      failures.push('input must be an object of strings');
    } else {
      for (const [key, value] of Object.entries(fixture.input)) {
        if (typeof value !== 'string') failures.push(`${key} must be a string`);
      }
    }
  }

  for (const value of values) {
    if (expected.maxCharsEach && countChars(value) > expected.maxCharsEach) {
      failures.push(`card preview value exceeds ${expected.maxCharsEach} chars: ${JSON.stringify(value)}`);
    }
    for (const token of expected.forbiddenMarkdownTokens ?? []) {
      if (value.includes(token)) {
        failures.push(`card preview value contains forbidden token ${JSON.stringify(token)}: ${JSON.stringify(value)}`);
      }
    }
  }

  if (expected.maxItems && Array.isArray(fixture.input) && fixture.input.length > expected.maxItems) {
    failures.push(`input has more than ${expected.maxItems} items`);
  }

  if (expected.maxItems && fixture.input && typeof fixture.input === 'object' && !Array.isArray(fixture.input)) {
    for (const [key, value] of Object.entries(fixture.input)) {
      if (Array.isArray(value) && value.length > expected.maxItems) {
        failures.push(`${key} has more than ${expected.maxItems} items`);
      }
    }
  }

  return { failures, normalized: null };
}

function checkResultBoundaryFixture(fixture) {
  const failures = [];
  const input = fixture.input ?? {};
  const expected = fixture.expected ?? {};
  const textNormalized = normalizeAiMarkdown(String(input.text ?? ''));
  const bodyNormalized = flattenStrings(input.completeDraft?.body ?? []).map((item) => normalizeAiMarkdown(item)).join('\n\n');
  const combined = `${textNormalized}\n${bodyNormalized}`;

  assertIncludes(textNormalized, expected.textNormalizedIncludes, 'text normalized', failures);
  assertIncludes(bodyNormalized, expected.bodyNormalizedIncludes, 'body normalized', failures);
  assertForbidden(combined, expected.forbiddenText, 'result boundary normalized text', failures);

  return { failures, normalized: { text: textNormalized, body: bodyNormalized } };
}

async function readFixtures() {
  const entries = await fs.readdir(fixtureDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(fixtureDir, entry.name))
    .sort();

  const fixtures = [];
  for (const file of files) {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`${path.relative(frontendRoot, file)} must contain a fixture array`);
    }
    for (const fixture of parsed) fixtures.push({ ...fixture, file: path.relative(frontendRoot, file) });
  }
  return fixtures;
}

async function run() {
  const fixtures = await readFixtures();
  const results = [];

  for (const fixture of fixtures) {
    if (fixture.status === 'pending') {
      results.push({
        id: fixture.id,
        scenario: fixture.scenario,
        surface: fixture.surface,
        status: 'pending',
        reason: fixture.reason ?? 'Pending fixture',
      });
      continue;
    }

    let result;
    if (fixture.surface === 'card_preview') {
      result = checkCardPreviewFixture(fixture);
    } else if (fixture.surface === 'result_boundary') {
      result = checkResultBoundaryFixture(fixture);
    } else {
      result = checkMarkdownFixture(fixture);
    }

    results.push({
      id: fixture.id,
      scenario: fixture.scenario,
      surface: fixture.surface,
      fieldPath: fixture.fieldPath,
      status: result.failures.length ? 'failed' : 'passed',
      failures: result.failures,
      normalized: result.normalized,
    });
  }

  const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    pending: results.filter((item) => item.status === 'pending').length,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
