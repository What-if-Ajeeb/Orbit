import { AGENT_ACTION_PROJECT_ID } from '@/lib/agent-actions/service';
import { ArtifactStore } from '@/lib/artifacts';
import { getChatStore } from '@/lib/chat';
import { MASTER_AGENT } from '@/lib/permissions/agents';
import { redactSecrets } from '@/lib/permissions/redact';
import { WORKSPACE_PROJECT_ID } from '@/lib/project-scopes';
import { listTasks } from '@/lib/tasks';
import { WorkflowStore } from '@/lib/workflows';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeOutputSchema,
  nativeTool,
  objectSchema,
  readNumber,
} from './helpers';

export const PROJECTS_PLUGIN_ID = 'orbit.builtin.projects';

const SUMMARY_MAX = 500;

export const projectsManifest: PluginManifest = seedPluginManifest({
  pluginId: PROJECTS_PLUGIN_ID,
  name: 'ORBIT Projects',
  version: '1.0.0',
  description:
    'Read-only view over the existing workspace composition: chats, tasks, artifacts and workflow runs. There is no separate projects table and no invented project CRUD.',
  category: 'service',
  icon: 'view-dashboard-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-projects' },
  permissions: ['ai.invoke', 'storage.read'],
  capabilities: ['tools.ai'],
  dependencies: [
    { pluginId: 'orbit.core.session', version: '^1.0.0' },
    { pluginId: 'orbit.core.tools', version: '^1.0.0' },
  ],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const SUMMARY_OUTPUT_SCHEMA = nativeOutputSchema({
  workspaceId: { type: 'string' },
  counts: {
    type: 'object',
    properties: {
      conversations: { type: 'integer' },
      tasks: { type: 'integer' },
      artifacts: { type: 'integer' },
      workflowRuns: { type: 'integer' },
    },
    required: ['conversations', 'tasks', 'artifacts', 'workflowRuns'],
    additionalProperties: false,
  },
  conversations: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        updatedAt: { type: 'integer' },
      },
      required: ['id', 'title', 'updatedAt'],
      additionalProperties: false,
    },
  },
  tasks: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['id', 'title', 'status'],
      additionalProperties: false,
    },
  },
  artifacts: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['id', 'title', 'type'],
      additionalProperties: false,
    },
  },
});

const SCOPES_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  scopes: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { type: 'string' },
        source: { type: 'string' },
      },
      required: ['id', 'label', 'source'],
      additionalProperties: false,
    },
  },
});

const RUNS_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  runs: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        workflowId: { type: 'integer' },
        workflowName: { type: 'string' },
        status: { type: 'string' },
        startedAt: { type: 'integer' },
        finishedAt: { type: ['integer', 'null'] },
        summary: { type: 'string' },
      },
      required: [
        'id',
        'workflowId',
        'workflowName',
        'status',
        'startedAt',
        'finishedAt',
        'summary',
      ],
      additionalProperties: false,
    },
  },
});

const summaryTool = nativeTool('projects_workspace_summary', {
  name: 'projects_workspace_summary',
  description:
    'Summarize the current workspace from real chats, tasks, artifacts and workflow runs. Read-only.',
  parameters: objectSchema({}, []),
  outputSchema: SUMMARY_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(_args, context) {
    const workflows = new WorkflowStore(context.db);
    const [conversations, tasks, artifacts, runs] = await Promise.all([
      getChatStore(context.db).listConversations(
        context.userId,
        20,
        MASTER_AGENT.id
      ),
      listTasks(context.db, context.userId, { status: 'all', limit: 50 }),
      new ArtifactStore(context.db).list(context.userId, 50),
      workflows.listRuns(context.userId, 20),
    ]);

    return {
      workspaceId: WORKSPACE_PROJECT_ID,
      counts: {
        conversations: conversations.length,
        tasks: tasks.length,
        artifacts: artifacts.length,
        workflowRuns: runs.length,
      },
      conversations: conversations.map((entry) => ({
        id: entry.id,
        title: entry.title,
        updatedAt: entry.updatedAt,
      })),
      tasks: tasks.map((entry) => ({
        id: entry.id,
        title: entry.title,
        status: entry.status,
      })),
      artifacts: artifacts.map((entry) => ({
        id: entry.id,
        title: entry.title,
        type: entry.type,
      })),
    };
  },
});

const scopesTool = nativeTool('projects_scopes', {
  name: 'projects_scopes',
  description:
    'List stable project scopes used by ORBIT: the workspace, agent actions and each saved workflow. Read-only.',
  parameters: objectSchema({}, []),
  outputSchema: SCOPES_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(_args, context) {
    const workflows = await new WorkflowStore(context.db).list(context.userId);
    const scopes = [
      { id: WORKSPACE_PROJECT_ID, label: 'Orbit workspace', source: 'workspace' },
      { id: AGENT_ACTION_PROJECT_ID, label: 'Agent actions', source: 'agent-actions' },
      ...workflows.map((workflow) => ({
        id: `workflow-${workflow.id}`,
        label: `Workflow: ${workflow.name}`,
        source: 'workflow',
      })),
    ];

    return { total: scopes.length, scopes };
  },
});

const runsTool = nativeTool('projects_workflow_runs', {
  name: 'projects_workflow_runs',
  description:
    'List recent workflow runs with redacted summaries. Read-only; it does not start workflows.',
  parameters: objectSchema(
    { limit: { type: 'integer', minimum: 1, maximum: 50 } },
    []
  ),
  outputSchema: RUNS_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(args, context) {
    const limit = readNumber(args, 'limit', { min: 1, max: 50 }) ?? 20;
    const runs = await new WorkflowStore(context.db).listRuns(context.userId, limit);

    return {
      total: runs.length,
      runs: runs.map((run) => {
        const summary = redactSecrets(run.summary);
        return {
          id: run.id,
          workflowId: run.workflowId,
          workflowName: run.workflowName,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          summary: summary.slice(0, SUMMARY_MAX),
        };
      }),
    };
  },
});

export const projectsImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.projects] projects plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.projects] projects plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.projects] projects plugin reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(summaryTool);
    void sdk.tools.register(scopesTool);
    void sdk.tools.register(runsTool);
  },
};
