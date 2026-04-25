import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { FileDiff } from '../diff';

// Mock config so getEnv('MOON_SHOT_KEY') does not throw.
mock.module('../config', () => ({
  getEnv: mock(() => 'test-key'),
  MOONSHOT_MODEL: 'test-model',
  MOONSHOT_TEMPERATURE: 1,
}));

// Mock the 'ai' module before importing the check so generateText is replaced.
mock.module('ai', () => ({
  generateText: mock(async () => ({
    output: { violations: [] },
  })),
  Output: {
    object: (opts: unknown) => opts,
  },
}));

// Mock the Moonshot provider — just needs to return a callable.
mock.module('@ai-sdk/moonshotai', () => ({
  createMoonshotAI: mock(() => () => 'mocked-moonshot-model'),
}));

// Import after mocks are installed.
const { checkBffRawErrorResponses, isBffPath, renderBffRawErrorLeakCheck } =
  await import('./bff-raw-error-response-check');
const { generateText } = await import('ai');

// Helper: override generateText return value for a single test.
function mockViolations(
  violations: { filePath: string; lineContent: string; description: string }[],
) {
  (generateText as ReturnType<typeof mock>).mockImplementation(async () => ({
    output: { violations },
  }));
}

afterEach(() => {
  (generateText as ReturnType<typeof mock>).mockImplementation(async () => ({
    output: { violations: [] },
  }));
});

describe('isBffPath', () => {
  test('matches unix-style src/bff segment', () => {
    expect(isBffPath('packages/foo/src/bff/handler.ts')).toBe(true);
  });

  test('matches Windows-style path', () => {
    expect(isBffPath('packages\\foo\\src\\bff\\handler.ts')).toBe(true);
  });

  test('does not match other src segments', () => {
    expect(isBffPath('src/feature-app/foo.ts')).toBe(false);
  });

  test('matches repo-root src/bff without leading slash', () => {
    expect(isBffPath('src/bff/post-customer-registration/index.ts')).toBe(true);
  });
});

describe('checkBffRawErrorResponses', () => {
  test('returns empty violations when no bff files — LLM never called', async () => {
    const fileDiffs: FileDiff[] = [
      {
        filePath: 'src/api/handler.ts',
        diff: `@@ -0,0 +1 @@\n+      return { body: JSON.stringify(error) };\n`,
      },
    ];
    const result = await checkBffRawErrorResponses(fileDiffs);
    expect(result.violations).toHaveLength(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  test('calls LLM and returns mapped violations for bff files', async () => {
    mockViolations([
      {
        filePath: 'repo/src/bff/register.ts',
        lineContent: '      body: JSON.stringify(error),',
        description: 'Raw Error serialized into response body',
      },
    ]);

    const fileDiffs: FileDiff[] = [
      {
        filePath: 'repo/src/bff/register.ts',
        diff: `@@ -1,3 +1,5 @@\n   } catch (error: unknown) {\n+    return {\n+      statusCode: 500,\n+      body: JSON.stringify(error),\n+    };\n   }\n`,
      },
    ];

    const result = await checkBffRawErrorResponses(fileDiffs);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].filePath).toBe('repo/src/bff/register.ts');
    expect(result.violations[0].lineContent).toContain('JSON.stringify(error)');
    expect(result.violations[0].description).toBe('Raw Error serialized into response body');
  });

  test('returns no violations when LLM finds none (e.g. error.message used)', async () => {
    mockViolations([]);

    const fileDiffs: FileDiff[] = [
      {
        filePath: 'repo/src/bff/register.ts',
        diff: `@@ -1,1 +1,2 @@\n+      body: JSON.stringify(error.message),\n`,
      },
    ];

    const result = await checkBffRawErrorResponses(fileDiffs);
    expect(result.violations).toHaveLength(0);
  });

  test('deterministic scan flags JSON.stringify(error) when LLM returns none', async () => {
    mockViolations([]);

    const fileDiffs: FileDiff[] = [
      {
        filePath: 'src/bff/post-customer-registration/index.ts',
        diff: `@@ -1,1 +1,2 @@\n+        body: JSON.stringify(error),\n`,
      },
    ];

    const result = await checkBffRawErrorResponses(fileDiffs);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations.some((v) => v.lineContent.includes('JSON.stringify(error)'))).toBe(
      true,
    );
  });

  test('returns empty violations when LLM throws and diff has no deterministic leak', async () => {
    (generateText as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error('LLM unavailable');
    });

    const fileDiffs: FileDiff[] = [
      {
        filePath: 'x/src/bff/x.ts',
        diff: `@@ -0,0 +1 @@\n+      const ok = true;\n`,
      },
    ];

    const result = await checkBffRawErrorResponses(fileDiffs);
    expect(result.violations).toHaveLength(0);
  });

  test('returns deterministic violations when LLM throws but diff matches patterns', async () => {
    (generateText as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error('LLM unavailable');
    });

    const fileDiffs: FileDiff[] = [
      {
        filePath: 'x/src/bff/x.ts',
        diff: `@@ -0,0 +1 @@\n+      return { statusCode: 500, body: error };\n`,
      },
    ];

    const result = await checkBffRawErrorResponses(fileDiffs);
    expect(result.violations).toHaveLength(1);
  });
});

describe('renderBffRawErrorLeakCheck', () => {
  test('returns empty string when no violations', () => {
    expect(renderBffRawErrorLeakCheck({ violations: [] })).toBe('');
  });

  test('renders markdown with file path and line content', () => {
    const md = renderBffRawErrorLeakCheck({
      violations: [{ filePath: 'a/src/bff/f.ts', lineContent: '  body: error' }],
    });
    expect(md).toContain('BFF: raw error leaked to client response');
    expect(md).toContain('a/src/bff/f.ts');
    expect(md).toContain('body: error');
  });

  test('appends description when present', () => {
    const md = renderBffRawErrorLeakCheck({
      violations: [
        {
          filePath: 'a/src/bff/f.ts',
          lineContent: '  body: error',
          description: 'Leaks API key via Error object',
        },
      ],
    });
    expect(md).toContain('Leaks API key via Error object');
  });
});
