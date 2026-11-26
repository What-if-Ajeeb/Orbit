import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CODE_PLUGIN_ID, NATIVE_PLUGIN_MANIFESTS } from '../native';
import { createNativeHarness } from './native-harness';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-native-test' }));
vi.mock('expo-linking', () => ({ openURL: vi.fn(async () => undefined) }));
vi.mock('@/lib/safety/trash', () => ({
  SafetyTrash: class {
    list(): Promise<unknown[]> {
      return Promise.resolve([]);
    }
  },
}));

const mocks = vi.hoisted(() => ({
  requestCompletion: vi.fn(),
  loadAiSettings: vi.fn(async () => ({
    provider: 'openai',
    mode: 'cloud',
    baseUrl: 'https://api.example.com/v1',
    model: 'test-model',
    apiKey: 'sk-test',
  })),
}));

vi.mock('@/lib/ai/providers', () => ({
  requestCompletion: mocks.requestCompletion,
}));
vi.mock('@/lib/ai/settings', () => ({
  loadAiSettings: mocks.loadAiSettings,
}));

vi.mock('@/lib/tasks', () => ({
  listTasks: vi.fn(async () => []),
  getTaskStats: vi.fn(async () => ({
    openCount: 0,
    doneCount: 0,
    dueToday: 0,
    overdue: 0,
    nextReminderAt: null,
  })),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock('@/lib/agent-actions/service', () => ({
  AGENT_ACTION_PROJECT_ID: 'orbit-agent-actions',
}));
vi.mock('@/lib/chat', () => ({
  getChatStore: () => ({ listConversations: vi.fn(async () => []) }),
}));
vi.mock('@/lib/workflows', () => ({
  WorkflowStore: class {
    list() {
      return Promise.resolve([]);
    }
    listRuns() {
      return Promise.resolve([]);
    }
  },
}));
vi.mock('@/lib/buddy', () => ({
  listUserBuddies: vi.fn(async () => []),
  getUserBuddy: vi.fn(async () => null),
  listBuddyActivities: vi.fn(async () => []),
  getInventory: vi.fn(async () => []),
  getEvolutionBranches: vi.fn(() => []),
  canEvolveTo: vi.fn(() => ({ ok: false, missing: [] })),
  getForm: vi.fn(() => undefined),
  setActiveBuddy: vi.fn(async () => undefined),
  tryEvolve: vi.fn(async () => ({ ok: false, error: 'unavailable' })),
}));
vi.mock('@/lib/mcp/registry', () => ({
  getMcpStatuses: vi.fn(() => []),
  getMcpToolCount: vi.fn(() => 0),
  syncMcpTools: vi.fn(async () => ({ statuses: [], toolCount: 0, syncedAt: 0 })),
}));
vi.mock('@/lib/mcp/settings', () => ({
  loadMcpServers: vi.fn(async () => []),
}));

async function enableCode() {
  const harness = await createNativeHarness();
  const manifest = NATIVE_PLUGIN_MANIFESTS.find(
    (entry) => entry.pluginId === CODE_PLUGIN_ID
  )!;

  await harness.registry.install(CODE_PLUGIN_ID);
  await harness.permissions.grant(
    CODE_PLUGIN_ID,
    manifest.permissions,
    'core',
    'test'
  );
  await harness.registry.enable(CODE_PLUGIN_ID);
  return harness;
}

function reply(data: Record<string, unknown>): void {
  mocks.requestCompletion.mockResolvedValueOnce({
    text: JSON.stringify(data),
    toolCalls: [],
  });
}

function lastCompletionArgs(): {
  messages: { role: string; content: string; attachments?: unknown[] }[];
  tools: unknown[];
  options: { signal?: AbortSignal };
} {
  const call = mocks.requestCompletion.mock.calls.at(-1)!;

  return {
    messages: call[1] as { role: string; content: string; attachments?: unknown[] }[],
    tools: call[2] as unknown[],
    options: call[3] as { signal?: AbortSignal },
  };
}

const context = { db: {} as SQLiteDatabase, userId: 7 };

describe('ORBIT Code native plugin', () => {
  beforeEach(() => {
    mocks.requestCompletion.mockReset();
    mocks.loadAiSettings.mockClear();
  });

  it('declares education-only permissions and registers no editor or execution tools', async () => {
    const manifest = NATIVE_PLUGIN_MANIFESTS.find(
      (entry) => entry.pluginId === CODE_PLUGIN_ID
    )!;

    expect(manifest.permissions).toEqual(['ai.invoke']);
    expect(manifest.capabilities).toEqual(['tools.ai']);
    expect(manifest.category).toBe('ai');
    expect(manifest.description).toMatch(/education-only programming tutor/);

    const harness = await enableCode();

    for (const toolName of [
      'code_artifact_save',
      'code_artifact_read',
      'code_paired_devices',
      'code_execute',
      'code_editor',
    ]) {
      expect(harness.toolHost.has(`plugin__orbit_builtin_code__${toolName}`)).toBe(false);
    }

    expect(harness.toolHost.has('plugin__orbit_builtin_code__code_solve_dsa')).toBe(true);
    expect(harness.toolHost.has('plugin__orbit_builtin_code__code_explain_code')).toBe(true);
    expect(harness.toolHost.has('plugin__orbit_builtin_code__code_teach_concept')).toBe(true);
    expect(harness.toolHost.has('plugin__orbit_builtin_code__code_debug_code')).toBe(true);
    expect(harness.toolHost.has('plugin__orbit_builtin_code__code_analyze_complexity')).toBe(true);
    expect(harness.toolHost.has('plugin__orbit_builtin_code__code_learning_mode')).toBe(true);
  });

  it('solves a DSA problem from text and an image with steps and complexity', async () => {
    const harness = await enableCode();
    reply({
      topics: ['arrays', 'hashing'],
      problemSummary: 'Find two indices whose values add to a target.',
      constraints: ['Exactly one answer', 'Cannot reuse one element'],
      edgeCases: ['Duplicate values', 'No valid pair'],
      hints: ['Think about what complement each value needs.'],
      bruteForce: 'Check every pair.',
      optimized: 'Store seen values in a hash map.',
      steps: ['Scan values', 'Look up target minus value', 'Return the pair'],
      solution: 'function twoSum(nums, target) { /* educational snippet */ }',
      complexity: {
        time: 'O(n)',
        space: 'O(n)',
        reasoning: 'One pass with a hash map of seen complements.',
      },
      visualDescription: 'A table of index, value and needed complement.',
      followUps: ['Try the sorted two-pointer variant.'],
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_solve_dsa');
    const result = await tool!.execute(context, {
      problem: 'Solve the two-sum problem.',
      language: 'javascript',
      level: 'beginner',
      mode: 'solution',
      image: {
        name: 'question.png',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
      },
      imageNotes: 'The image shows nums = [2,7,11,15], target = 9.',
    });
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      mode: 'solution',
      level: 'beginner',
      language: 'javascript',
      problemSummary: 'Find two indices whose values add to a target.',
      constraints: ['Exactly one answer', 'Cannot reuse one element'],
      hints: ['Think about what complement each value needs.'],
      bruteForce: 'Check every pair.',
      optimized: 'Store seen values in a hash map.',
      solution: 'function twoSum(nums, target) { /* educational snippet */ }',
      complexity: { time: 'O(n)', space: 'O(n)' },
      followUps: ['Try the sorted two-pointer variant.'],
    });
    expect(parsed.steps).toHaveLength(3);

    const { messages, tools, options } = lastCompletionArgs();
    expect(mocks.loadAiSettings).toHaveBeenCalledTimes(1);
    expect(tools).toEqual([]);
    expect(messages[0].content).toContain('DSA problems');
    expect(messages[0].content).toContain('Return only one valid JSON object.');
    expect(messages[1].content).toContain('Mode: solution');
    expect(messages[1].content).toContain('Solve the two-sum problem.');
    expect(messages[1].attachments).toEqual([
      {
        name: 'question.png',
        kind: 'image',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
      },
    ]);
    expect(options.signal).toBeDefined();
  });

  it('accepts an image-only DSA question without requiring a text statement', async () => {
    const harness = await enableCode();
    reply({
      topics: ['trees'],
      problemSummary: 'Count the nodes in the pictured binary tree.',
      constraints: ['Each edge appears once'],
      edgeCases: ['Empty tree'],
      hints: ['Visit each node exactly once.'],
      bruteForce: '',
      optimized: 'A depth-first traversal counts nodes.',
      steps: ['Visit root', 'Count left subtree', 'Count right subtree'],
      solution: '',
      complexity: { time: 'O(n)', space: 'O(h)', reasoning: 'Each node is visited once.' },
      visualDescription: 'A root with two children.',
      followUps: ['Try an iterative traversal.'],
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_solve_dsa');
    const result = await tool!.execute(context, {
      mode: 'hints',
      image: {
        name: 'tree.png',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
      },
      imageNotes: 'The image is a small binary tree.',
    });
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      mode: 'hints',
      problemSummary: 'Count the nodes in the pictured binary tree.',
      hints: ['Visit each node exactly once.'],
      complexity: { time: 'O(n)', space: 'O(h)' },
    });
    expect(lastCompletionArgs().messages[1].content).toContain(
      'No text statement was supplied'
    );
    expect(lastCompletionArgs().messages[1].attachments).toHaveLength(1);
  });

  it('explains pasted code line by line with execution flow and expected output', async () => {
    const harness = await enableCode();
    reply({
      summary: 'The loop accumulates a total.',
      lineByLine: [
        { line: '1', explanation: 'Starts total at zero.' },
        { line: 2, explanation: 'Adds each value to total.' },
      ],
      functions: ['sumValues'],
      variables: ['total', 'value'],
      controlFlow: 'A for loop runs once per value.',
      executionFlow: ['total = 0', 'total = 2', 'total = 5'],
      expectedOutput: '5',
      keyIdeas: ['Accumulator pattern'],
      followUps: ['How would this change for an empty array?'],
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_explain_code');
    const result = await tool!.execute(context, {
      code: 'let total = 0;\nfor (const value of [2, 3]) total += value;',
      language: 'javascript',
      level: 'beginner',
    });
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      level: 'beginner',
      language: 'javascript',
      summary: 'The loop accumulates a total.',
      lineByLine: [
        { line: 1, explanation: 'Starts total at zero.' },
        { line: 2, explanation: 'Adds each value to total.' },
      ],
      functions: ['sumValues'],
      variables: ['total', 'value'],
      controlFlow: 'A for loop runs once per value.',
      expectedOutput: '5',
    });
    expect(parsed.executionFlow).toHaveLength(3);
    expect(lastCompletionArgs().messages[1].content).toContain('for (const value of [2, 3])');
  });

  it('teaches an algorithm concept with pseudocode and a dry run', async () => {
    const harness = await enableCode();
    reply({
      explanation: 'Binary search halves the remaining range each step.',
      simpleExample: 'Find 9 in [1, 3, 9, 12].',
      pseudocode: 'while low <= high: mid = ...',
      dryRun: ['low=0 high=3 mid=1', 'low=2 high=3 mid=2', 'found 9'],
      visualDescription: 'A sorted array with the middle marker moving right.',
      keyTakeaways: ['Requires sorted input', 'O(log n) time'],
      followUps: ['What breaks if the array is unsorted?'],
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_teach_concept');
    const result = await tool!.execute(context, {
      topic: 'binary search',
      format: 'pseudocode',
      level: 'intermediate',
    });
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      topic: 'binary search',
      format: 'pseudocode',
      explanation: 'Binary search halves the remaining range each step.',
      pseudocode: 'while low <= high: mid = ...',
      visualDescription: 'A sorted array with the middle marker moving right.',
    });
    expect(parsed.dryRun).toHaveLength(3);
    expect(lastCompletionArgs().messages[1].content).toContain('Requested format: pseudocode');
  });

  it('explains likely bugs and the corrected code without executing anything', async () => {
    const harness = await enableCode();
    reply({
      summary: 'The index check is off by one.',
      likelyCauses: [
        { cause: 'Using <= instead of <', why: 'The loop reads past the final element.' },
      ],
      suggestedFix: 'for (let i = 0; i < items.length; i++) { ... }',
      fixedExplanation: 'The strict comparison stops before the array ends.',
      verificationSteps: ['Try an empty array', 'Try a one-item array'],
      followUps: ['Why does an empty array now work?'],
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_debug_code');
    const result = await tool!.execute(context, {
      code: 'for (let i = 0; i <= items.length; i++) console.log(items[i]);',
      error: 'TypeError: Cannot read property length of undefined',
      language: 'javascript',
      level: 'beginner',
    });
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      level: 'beginner',
      summary: 'The index check is off by one.',
      likelyCauses: [
        { cause: 'Using <= instead of <', why: 'The loop reads past the final element.' },
      ],
      suggestedFix: 'for (let i = 0; i < items.length; i++) { ... }',
      fixedExplanation: 'The strict comparison stops before the array ends.',
    });
    expect(parsed.verificationSteps).toHaveLength(2);
    expect(lastCompletionArgs().messages[1].content).toContain(
      'TypeError: Cannot read property length of undefined'
    );
  });

  it('compares complexity across approaches', async () => {
    const harness = await enableCode();
    reply({
      explanation: 'Big O describes how work grows with input size.',
      notation: ['O(1)', 'O(n)', 'O(n log n)'],
      analyses: [
        {
          name: 'Nested loops',
          time: 'O(n²)',
          space: 'O(1)',
          reasoning: 'Each item is compared with every other item.',
        },
        {
          name: 'Hash set',
          time: 'O(n)',
          space: 'O(n)',
          reasoning: 'Each lookup is constant on average.',
        },
      ],
      comparison: 'The hash set trades memory for speed.',
      optimizationTips: ['Replace repeated scans with a lookup table.'],
      followUps: ['When would O(1) space be worth O(n²) time?'],
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_analyze_complexity');
    const result = await tool!.execute(context, {
      approaches: [
        { name: 'Nested loops', code: 'for (...) for (...) ...' },
        { name: 'Hash set', code: 'const seen = new Set(); ...' },
      ],
      level: 'advanced',
    });
    const parsed = JSON.parse(result.content);

    expect(parsed).toMatchObject({
      ok: true,
      level: 'advanced',
      explanation: 'Big O describes how work grows with input size.',
      notation: ['O(1)', 'O(n)', 'O(n log n)'],
      comparison: 'The hash set trades memory for speed.',
    });
    expect(parsed.analyses).toHaveLength(2);
    expect(lastCompletionArgs().messages[1].content).toContain('Alternative approaches:');
  });

  it('hides quiz answers until the learner asks to reveal them', async () => {
    const harness = await enableCode();
    reply({
      title: 'Recursion quiz',
      content: 'Answer the questions one at a time.',
      hints: ['Think about the base case first.'],
      steps: ['Identify the base case', 'Find the smaller problem'],
      questions: ['What stops a recursive function?', 'What is the call stack?'],
      answer: 'A base case stops recursion.',
      explanation: 'Without a base case, calls continue forever.',
      nextActions: ['Try the practice question.'],
    });
    reply({
      title: 'Recursion quiz',
      content: 'Answer the questions one at a time.',
      hints: [],
      steps: [],
      questions: ['What stops a recursive function?'],
      answer: 'A base case stops recursion.',
      explanation: 'Without a base case, calls continue forever.',
      nextActions: ['Try a dry run.'],
    });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_learning_mode');
    const hidden = await tool!.execute(context, {
      topic: 'recursion base cases',
      mode: 'quiz',
      level: 'beginner',
      step: 2,
    });
    const hiddenParsed = JSON.parse(hidden.content);

    expect(hiddenParsed).toMatchObject({
      ok: true,
      topic: 'recursion base cases',
      mode: 'quiz',
      level: 'beginner',
      title: 'Recursion quiz',
      content: 'Answer the questions one at a time.',
      answer: '',
      explanation: '',
    });
    expect(hiddenParsed.questions).toHaveLength(2);
    expect(lastCompletionArgs().messages[1].content).toContain('Reveal answer: no');

    const revealed = await tool!.execute(context, {
      topic: 'recursion base cases',
      mode: 'quiz',
      level: 'beginner',
      revealAnswer: true,
    });
    const revealedParsed = JSON.parse(revealed.content);

    expect(revealedParsed).toMatchObject({
      ok: true,
      answer: 'A base case stops recursion.',
      explanation: 'Without a base case, calls continue forever.',
    });
    expect(lastCompletionArgs().messages[1].content).toContain('Reveal answer: yes');
  });

  it('rejects unconfigured AI responses instead of returning placeholder lessons', async () => {
    const harness = await enableCode();
    mocks.requestCompletion.mockResolvedValueOnce({ text: 'Not JSON', toolCalls: [] });

    const tool = harness.toolHost.tools.get('plugin__orbit_builtin_code__code_learning_mode');
    const result = await tool!.execute(context, {
      topic: 'stacks',
      mode: 'hint',
    });

    expect(JSON.parse(result.content)).toMatchObject({ ok: false });
    expect(result.trace).toContain('failed');
  });
});
