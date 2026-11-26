import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeHostTool,
  nativeOutputSchema,
  objectSchema,
  readBoolean,
  readEnum,
  readNumber,
  readString,
} from './helpers';
import {
  asLineNumber,
  asRecord,
  asText,
  asTextList,
  EDUCATION_LEVELS,
  MAX_IMAGE_BASE64_CHARS,
  readImageAttachment,
  requestEducationJson,
} from './code-education';

export const CODE_PLUGIN_ID = 'orbit.builtin.code';

const CODE_INPUT_MAX = 20_000;
const PROBLEM_INPUT_MAX = 12_000;
const SNIPPET_OUTPUT_MAX = 8_000;
const TOOL_TIMEOUT_MS = 50_000;

type SolveMode = 'hints' | 'solution';
type TeachFormat = 'concept' | 'pseudocode' | 'dry-run' | 'visual';
type LearningMode = 'hint' | 'steps' | 'practice' | 'quiz' | 'followup';

const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
] as const;

export const codeManifest: PluginManifest = seedPluginManifest({
  pluginId: CODE_PLUGIN_ID,
  name: 'ORBIT Code',
  version: '1.0.0',
  description:
    'An education-only programming tutor for DSA problems, code explanation, debugging, complexity and guided learning. It explains and teaches; it does not edit, build or execute code.',
  category: 'ai',
  icon: 'school-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-code' },
  permissions: ['ai.invoke'],
  capabilities: ['tools.ai'],
  dependencies: [
    { pluginId: 'orbit.core.tools', version: '^1.0.0' },
    { pluginId: 'orbit.core.llm', version: '^1.0.0' },
  ],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const SOLVE_OUTPUT_SCHEMA = nativeOutputSchema({
  mode: { type: 'string', enum: ['hints', 'solution'] },
  level: { type: 'string', enum: [...EDUCATION_LEVELS] },
  language: { type: 'string' },
  topics: { type: 'array', items: { type: 'string' } },
  problemSummary: { type: 'string' },
  constraints: { type: 'array', items: { type: 'string' } },
  edgeCases: { type: 'array', items: { type: 'string' } },
  hints: { type: 'array', items: { type: 'string' } },
  bruteForce: { type: 'string' },
  optimized: { type: 'string' },
  steps: { type: 'array', items: { type: 'string' } },
  solution: { type: 'string' },
  complexity: {
    type: 'object',
    properties: {
      time: { type: 'string' },
      space: { type: 'string' },
      reasoning: { type: 'string' },
    },
    required: ['time', 'space', 'reasoning'],
    additionalProperties: false,
  },
  visualDescription: { type: 'string' },
  followUps: { type: 'array', items: { type: 'string' } },
});

const EXPLAIN_OUTPUT_SCHEMA = nativeOutputSchema({
  level: { type: 'string', enum: [...EDUCATION_LEVELS] },
  language: { type: 'string' },
  summary: { type: 'string' },
  lineByLine: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        line: { type: 'integer' },
        explanation: { type: 'string' },
      },
      required: ['line', 'explanation'],
      additionalProperties: false,
    },
  },
  functions: { type: 'array', items: { type: 'string' } },
  variables: { type: 'array', items: { type: 'string' } },
  controlFlow: { type: 'string' },
  executionFlow: { type: 'array', items: { type: 'string' } },
  expectedOutput: { type: 'string' },
  keyIdeas: { type: 'array', items: { type: 'string' } },
  followUps: { type: 'array', items: { type: 'string' } },
});

const TEACH_OUTPUT_SCHEMA = nativeOutputSchema({
  topic: { type: 'string' },
  level: { type: 'string', enum: [...EDUCATION_LEVELS] },
  format: { type: 'string', enum: ['concept', 'pseudocode', 'dry-run', 'visual'] },
  explanation: { type: 'string' },
  simpleExample: { type: 'string' },
  pseudocode: { type: 'string' },
  dryRun: { type: 'array', items: { type: 'string' } },
  visualDescription: { type: 'string' },
  keyTakeaways: { type: 'array', items: { type: 'string' } },
  followUps: { type: 'array', items: { type: 'string' } },
});

const DEBUG_OUTPUT_SCHEMA = nativeOutputSchema({
  level: { type: 'string', enum: [...EDUCATION_LEVELS] },
  language: { type: 'string' },
  summary: { type: 'string' },
  likelyCauses: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        cause: { type: 'string' },
        why: { type: 'string' },
      },
      required: ['cause', 'why'],
      additionalProperties: false,
    },
  },
  suggestedFix: { type: 'string' },
  fixedExplanation: { type: 'string' },
  verificationSteps: { type: 'array', items: { type: 'string' } },
  followUps: { type: 'array', items: { type: 'string' } },
});

const COMPLEXITY_OUTPUT_SCHEMA = nativeOutputSchema({
  level: { type: 'string', enum: [...EDUCATION_LEVELS] },
  explanation: { type: 'string' },
  notation: { type: 'array', items: { type: 'string' } },
  analyses: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        time: { type: 'string' },
        space: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['name', 'time', 'space', 'reasoning'],
      additionalProperties: false,
    },
  },
  comparison: { type: 'string' },
  optimizationTips: { type: 'array', items: { type: 'string' } },
  followUps: { type: 'array', items: { type: 'string' } },
});

const LEARNING_OUTPUT_SCHEMA = nativeOutputSchema({
  topic: { type: 'string' },
  mode: { type: 'string', enum: ['hint', 'steps', 'practice', 'quiz', 'followup'] },
  level: { type: 'string', enum: [...EDUCATION_LEVELS] },
  title: { type: 'string' },
  content: { type: 'string' },
  hints: { type: 'array', items: { type: 'string' } },
  steps: { type: 'array', items: { type: 'string' } },
  questions: { type: 'array', items: { type: 'string' } },
  answer: { type: 'string' },
  explanation: { type: 'string' },
  nextActions: { type: 'array', items: { type: 'string' } },
});

const DSA_SYSTEM = [
  'You are ORBIT Code, a mobile-first programming tutor.',
  'Teach DSA problems across arrays, strings, linked lists, stacks, queues, trees, graphs, recursion, dynamic programming, sorting and searching.',
  'In hints mode, give progressive hints and approach names only; never reveal a complete algorithm or code.',
  'In solution mode, explain the brute force and optimized approaches, give step-by-step reasoning, and include one short illustrative snippet when useful.',
  'Never claim that code was executed here.',
  'Return JSON with keys: topics, problemSummary, constraints, edgeCases, hints, bruteForce, optimized, steps, solution, complexity, visualDescription, followUps.',
  'complexity must be an object with time, space and reasoning.',
].join(' ');

const EXPLAIN_SYSTEM = [
  'You are ORBIT Code, a mobile-first code explainer.',
  'Explain pasted code line by line, including functions, variables, loops and conditions.',
  'Show a small execution flow and the expected output when it can be inferred; do not claim to run the code.',
  'Support common languages and say when the language is unclear.',
  'Return JSON with keys: summary, lineByLine, functions, variables, controlFlow, executionFlow, expectedOutput, keyIdeas, followUps.',
  'lineByLine must be an array of objects with integer line and string explanation.',
].join(' ');

const TEACH_SYSTEM = [
  'You are ORBIT Code, a programming fundamentals and algorithm tutor.',
  'Teach the requested concept with a simple example, pseudocode or a dry run, and a short text description of any useful visual.',
  'Never claim to execute code or provide an IDE.',
  'Return JSON with keys: explanation, simpleExample, pseudocode, dryRun, visualDescription, keyTakeaways, followUps.',
].join(' ');

const DEBUG_SYSTEM = [
  'You are ORBIT Code, a debugging tutor.',
  'Read pasted code and an optional error message, identify likely causes, explain why they happen and suggest an educational correction.',
  'Do not claim to run the code or open files; describe verification steps the learner can perform.',
  'Return JSON with keys: summary, likelyCauses, suggestedFix, fixedExplanation, verificationSteps, followUps.',
  'likelyCauses must be an array of objects with cause and why.',
].join(' ');

const COMPLEXITY_SYSTEM = [
  'You are ORBIT Code, a complexity and optimization tutor.',
  'Explain Big O notation, analyze time and space complexity, compare approaches and teach optimization ideas.',
  'Never claim to execute code.',
  'Return JSON with keys: explanation, notation, analyses, comparison, optimizationTips, followUps.',
  'analyses must be an array of objects with name, time, space and reasoning.',
].join(' ');

const LEARNING_SYSTEM = [
  'You are ORBIT Code, a guided learning-mode tutor.',
  'Give hints before complete answers. Generate practice questions, quizzes and follow-up questions.',
  'Adapt all wording to the requested level: beginner, intermediate or advanced.',
  'Never reveal the answer unless revealAnswer is true.',
  'Never claim to execute code or provide a coding workspace.',
  'Return JSON with keys: title, content, hints, steps, questions, answer, explanation, nextActions.',
].join(' ');

function buildPrompt(lines: (string | undefined)[]): string {
  return lines.filter((line): line is string => Boolean(line)).join('\n\n');
}

function parseLines(value: unknown): { line: number; explanation: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 80).map((entry, index) => {
    const record = asRecord(entry);

    return {
      line: asLineNumber(record.line, index + 1),
      explanation: asText(record.explanation, 600),
    };
  });
}

function parseCauseList(value: unknown): { cause: string; why: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 8).map((entry) => {
    const record = asRecord(entry);

    return {
      cause: asText(record.cause, 500),
      why: asText(record.why, 1_200),
    };
  });
}

function parseAnalyses(value: unknown): {
  name: string;
  time: string;
  space: string;
  reasoning: string;
}[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 4).map((entry, index) => {
    const record = asRecord(entry);

    return {
      name: asText(record.name, 80) || `Approach ${index + 1}`,
      time: asText(record.time, 200),
      space: asText(record.space, 200),
      reasoning: asText(record.reasoning, 1_200),
    };
  });
}

const solveDsaTool = nativeHostTool('code_solve_dsa', {
  name: 'code_solve_dsa',
  description:
    'Explain a DSA problem from text or an attached image. Give hints first by default, or a full step-by-step solution with brute-force and optimized approaches, complexity and edge cases when requested. Educational only; it never executes code.',
  parameters: objectSchema(
    {
      problem: { type: 'string', minLength: 1, maxLength: PROBLEM_INPUT_MAX },
      language: { type: 'string', minLength: 1, maxLength: 40 },
      level: { type: 'string', enum: [...EDUCATION_LEVELS] },
      mode: { type: 'string', enum: ['hints', 'solution'] },
      image: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          mimeType: { type: 'string', enum: [...IMAGE_MIME_TYPES] },
          data: { type: 'string', minLength: 1, maxLength: MAX_IMAGE_BASE64_CHARS },
        },
        required: ['data'],
        additionalProperties: false,
      },
      imageNotes: { type: 'string', maxLength: 2_000 },
    },
    []
  ),
  outputSchema: SOLVE_OUTPUT_SCHEMA,
  timeoutMs: TOOL_TIMEOUT_MS,
  async execute(args, context) {
    const problem = readString(args, 'problem', { maxLength: PROBLEM_INPUT_MAX });
    const language = readString(args, 'language', { maxLength: 40 }) ?? 'language-neutral';
    const level = readEnum(args, 'level', EDUCATION_LEVELS, { defaultValue: 'intermediate' })!;
    const mode = readEnum<SolveMode>(args, 'mode', ['hints', 'solution'], {
      defaultValue: 'hints',
    })!;
    const image = readImageAttachment(args.image);
    const imageNotes = readString(args, 'imageNotes', { maxLength: 2_000 });

    if (!problem && !image) {
      throw new Error('Provide a problem statement or an attached image.');
    }

    const data = await requestEducationJson(
      DSA_SYSTEM,
      buildPrompt([
        `Level: ${level}`,
        `Mode: ${mode}`,
        `Snippet language: ${language}`,
        image ? 'The learner attached an image of the problem; use it as the source statement.' : undefined,
        problem
          ? `Problem or transcription:\n${problem}`
          : 'No text statement was supplied; read the problem from the attached image.',
        imageNotes ? `Image notes:\n${imageNotes}` : undefined,
      ]),
      { image, signal: context.signal }
    );
    const complexity = asRecord(data.complexity);

    return {
      mode,
      level,
      language,
      topics: asTextList(data.topics, 8, 80),
      problemSummary: asText(data.problemSummary, 1_200),
      constraints: asTextList(data.constraints, 10, 400),
      edgeCases: asTextList(data.edgeCases, 10, 400),
      hints: asTextList(data.hints, 8, 600),
      bruteForce: asText(data.bruteForce, 2_000),
      optimized: asText(data.optimized, 2_000),
      steps: asTextList(data.steps, 16, 600),
      solution: asText(data.solution, SNIPPET_OUTPUT_MAX, false),
      complexity: {
        time: asText(complexity.time, 200),
        space: asText(complexity.space, 200),
        reasoning: asText(complexity.reasoning, 1_200),
      },
      visualDescription: asText(data.visualDescription, 1_200),
      followUps: asTextList(data.followUps, 6, 400),
    };
  },
});

const explainCodeTool = nativeHostTool('code_explain_code', {
  name: 'code_explain_code',
  description:
    'Explain pasted code line by line, including variables, loops, conditions, execution flow and expected output. Educational only; it never edits or executes the code.',
  parameters: objectSchema(
    {
      code: { type: 'string', minLength: 1, maxLength: CODE_INPUT_MAX },
      language: { type: 'string', minLength: 1, maxLength: 40 },
      level: { type: 'string', enum: [...EDUCATION_LEVELS] },
    },
    ['code']
  ),
  outputSchema: EXPLAIN_OUTPUT_SCHEMA,
  timeoutMs: TOOL_TIMEOUT_MS,
  async execute(args, context) {
    const code = readString(args, 'code', {
      required: true,
      maxLength: CODE_INPUT_MAX,
      trim: false,
    })!;
    const language = readString(args, 'language', { maxLength: 40 }) ?? 'auto-detect';
    const level = readEnum(args, 'level', EDUCATION_LEVELS, { defaultValue: 'intermediate' })!;

    const data = await requestEducationJson(
      EXPLAIN_SYSTEM,
      buildPrompt([
        `Level: ${level}`,
        `Language: ${language}`,
        `Code to explain:\n${code}`,
      ]),
      { signal: context.signal }
    );

    return {
      level,
      language,
      summary: asText(data.summary, 1_500),
      lineByLine: parseLines(data.lineByLine),
      functions: asTextList(data.functions, 12, 500),
      variables: asTextList(data.variables, 12, 500),
      controlFlow: asText(data.controlFlow, 1_500),
      executionFlow: asTextList(data.executionFlow, 12, 600),
      expectedOutput: asText(data.expectedOutput, 1_000, false),
      keyIdeas: asTextList(data.keyIdeas, 10, 500),
      followUps: asTextList(data.followUps, 6, 400),
    };
  },
});

const teachConceptTool = nativeHostTool('code_teach_concept', {
  name: 'code_teach_concept',
  description:
    'Teach programming fundamentals and algorithms with simple examples, pseudocode, dry runs and text descriptions of useful visuals. No editor or execution environment is provided.',
  parameters: objectSchema(
    {
      topic: { type: 'string', minLength: 1, maxLength: 500 },
      level: { type: 'string', enum: [...EDUCATION_LEVELS] },
      format: { type: 'string', enum: ['concept', 'pseudocode', 'dry-run', 'visual'] },
      example: { type: 'string', maxLength: 6_000 },
    },
    ['topic']
  ),
  outputSchema: TEACH_OUTPUT_SCHEMA,
  timeoutMs: TOOL_TIMEOUT_MS,
  async execute(args, context) {
    const topic = readString(args, 'topic', { required: true, maxLength: 500 })!;
    const level = readEnum(args, 'level', EDUCATION_LEVELS, { defaultValue: 'intermediate' })!;
    const format = readEnum<TeachFormat>(args, 'format', ['concept', 'pseudocode', 'dry-run', 'visual'], {
      defaultValue: 'concept',
    })!;
    const example = readString(args, 'example', { maxLength: 6_000 });

    const data = await requestEducationJson(
      TEACH_SYSTEM,
      buildPrompt([
        `Level: ${level}`,
        `Requested format: ${format}`,
        `Topic: ${topic}`,
        example ? `Example or context from the learner:\n${example}` : undefined,
      ]),
      { signal: context.signal }
    );

    return {
      topic,
      level,
      format,
      explanation: asText(data.explanation, 2_000),
      simpleExample: asText(data.simpleExample, 2_000, false),
      pseudocode: asText(data.pseudocode, SNIPPET_OUTPUT_MAX, false),
      dryRun: asTextList(data.dryRun, 16, 600),
      visualDescription: asText(data.visualDescription, 1_200),
      keyTakeaways: asTextList(data.keyTakeaways, 10, 500),
      followUps: asTextList(data.followUps, 6, 400),
    };
  },
});

const debugCodeTool = nativeHostTool('code_debug_code', {
  name: 'code_debug_code',
  description:
    'Explain likely bugs in pasted code and an optional error message, why they happen and how the corrected version works. It suggests educational fixes but never runs code.',
  parameters: objectSchema(
    {
      code: { type: 'string', minLength: 1, maxLength: CODE_INPUT_MAX },
      error: { type: 'string', maxLength: 6_000 },
      language: { type: 'string', minLength: 1, maxLength: 40 },
      level: { type: 'string', enum: [...EDUCATION_LEVELS] },
    },
    ['code']
  ),
  outputSchema: DEBUG_OUTPUT_SCHEMA,
  timeoutMs: TOOL_TIMEOUT_MS,
  async execute(args, context) {
    const code = readString(args, 'code', {
      required: true,
      maxLength: CODE_INPUT_MAX,
      trim: false,
    })!;
    const error = readString(args, 'error', { maxLength: 6_000 });
    const language = readString(args, 'language', { maxLength: 40 }) ?? 'auto-detect';
    const level = readEnum(args, 'level', EDUCATION_LEVELS, { defaultValue: 'intermediate' })!;

    const data = await requestEducationJson(
      DEBUG_SYSTEM,
      buildPrompt([
        `Level: ${level}`,
        `Language: ${language}`,
        `Code:\n${code}`,
        error ? `Error message or symptom:\n${error}` : 'No error message was supplied.',
      ]),
      { signal: context.signal }
    );

    return {
      level,
      language,
      summary: asText(data.summary, 1_500),
      likelyCauses: parseCauseList(data.likelyCauses),
      suggestedFix: asText(data.suggestedFix, SNIPPET_OUTPUT_MAX, false),
      fixedExplanation: asText(data.fixedExplanation, 2_000),
      verificationSteps: asTextList(data.verificationSteps, 10, 600),
      followUps: asTextList(data.followUps, 6, 400),
    };
  },
});

const complexityTool = nativeHostTool('code_analyze_complexity', {
  name: 'code_analyze_complexity',
  description:
    'Explain Big O notation, analyze time and space complexity, and compare up to four approaches. Accept code, named alternatives or a topic. Educational only; it never executes code.',
  parameters: objectSchema(
    {
      code: { type: 'string', maxLength: CODE_INPUT_MAX },
      approaches: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            code: { type: 'string', minLength: 1, maxLength: CODE_INPUT_MAX },
          },
          required: ['name', 'code'],
          additionalProperties: false,
        },
      },
      topic: { type: 'string', maxLength: 500 },
      level: { type: 'string', enum: [...EDUCATION_LEVELS] },
    },
    []
  ),
  outputSchema: COMPLEXITY_OUTPUT_SCHEMA,
  timeoutMs: TOOL_TIMEOUT_MS,
  async execute(args, context) {
    const code = readString(args, 'code', { maxLength: CODE_INPUT_MAX, trim: false });
    const topic = readString(args, 'topic', { maxLength: 500 });
    const level = readEnum(args, 'level', EDUCATION_LEVELS, { defaultValue: 'intermediate' })!;

    const approaches = Array.isArray(args.approaches)
      ? args.approaches.slice(0, 4).map((entry, index) => {
          const record = asRecord(entry);

          return {
            name: asText(record.name, 80) || `Approach ${index + 1}`,
            code: asText(record.code, CODE_INPUT_MAX, false),
          };
        })
      : [];

    if (!code && !topic && approaches.length === 0) {
      throw new Error('Provide code, approaches or a topic to analyze.');
    }

    const data = await requestEducationJson(
      COMPLEXITY_SYSTEM,
      buildPrompt([
        `Level: ${level}`,
        `Topic: ${topic ?? 'complexity of the supplied code'}`,
        code ? `Code:\n${code}` : undefined,
        approaches.length > 0
          ? `Alternative approaches:\n${approaches
              .map((entry) => `${entry.name}:\n${entry.code}`)
              .join('\n\n')}`
          : undefined,
      ]),
      { signal: context.signal }
    );

    return {
      level,
      explanation: asText(data.explanation, 2_000),
      notation: asTextList(data.notation, 10, 400),
      analyses: parseAnalyses(data.analyses),
      comparison: asText(data.comparison, 2_000),
      optimizationTips: asTextList(data.optimizationTips, 10, 600),
      followUps: asTextList(data.followUps, 6, 400),
    };
  },
});

const learningModeTool = nativeHostTool('code_learning_mode', {
  name: 'code_learning_mode',
  description:
    'Guided learning workflow: progressive hints, step-by-step explanations, practice questions, quizzes, follow-ups and level-adjusted answers. Answers stay hidden unless revealAnswer is true.',
  parameters: objectSchema(
    {
      topic: { type: 'string', minLength: 1, maxLength: 1_000 },
      mode: { type: 'string', enum: ['hint', 'steps', 'practice', 'quiz', 'followup'] },
      level: { type: 'string', enum: [...EDUCATION_LEVELS] },
      step: { type: 'integer', minimum: 1, maximum: 10 },
      contextCode: { type: 'string', maxLength: 8_000 },
      revealAnswer: { type: 'boolean' },
    },
    ['topic']
  ),
  outputSchema: LEARNING_OUTPUT_SCHEMA,
  timeoutMs: TOOL_TIMEOUT_MS,
  async execute(args, context) {
    const topic = readString(args, 'topic', { required: true, maxLength: 1_000 })!;
    const mode = readEnum<LearningMode>(args, 'mode', ['hint', 'steps', 'practice', 'quiz', 'followup'], {
      defaultValue: 'hint',
    })!;
    const level = readEnum(args, 'level', EDUCATION_LEVELS, { defaultValue: 'intermediate' })!;
    const step = readNumber(args, 'step', { min: 1, max: 10 }) ?? 1;
    const contextCode = readString(args, 'contextCode', { maxLength: 8_000, trim: false });
    const revealAnswer = readBoolean(args, 'revealAnswer', { defaultValue: false })!;

    const data = await requestEducationJson(
      LEARNING_SYSTEM,
      buildPrompt([
        `Mode: ${mode}`,
        `Level: ${level}`,
        `Hint step: ${step}`,
        `Reveal answer: ${revealAnswer ? 'yes' : 'no'}`,
        `Topic or problem: ${topic}`,
        contextCode ? `Learner code or notes:\n${contextCode}` : undefined,
      ]),
      { signal: context.signal }
    );

    return {
      topic,
      mode,
      level,
      title: asText(data.title, 160),
      content: asText(data.content, 2_000),
      hints: asTextList(data.hints, 8, 600),
      steps: asTextList(data.steps, 12, 600),
      questions: asTextList(data.questions, 8, 600),
      answer: revealAnswer ? asText(data.answer, 2_000) : '',
      explanation: revealAnswer ? asText(data.explanation, 2_000) : '',
      nextActions: asTextList(data.nextActions, 6, 400),
    };
  },
});

export const codeImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.code] education tutor started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.code] education tutor stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.code] education tutor reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(solveDsaTool);
    void sdk.tools.register(explainCodeTool);
    void sdk.tools.register(teachConceptTool);
    void sdk.tools.register(debugCodeTool);
    void sdk.tools.register(complexityTool);
    void sdk.tools.register(learningModeTool);
  },
};
