import type { SQLiteDatabase } from 'expo-sqlite';

import { AGENT_ACTION_PROJECT_ID } from './agent-actions/service';
import { WorkflowStore } from './workflows';

/** Stable workspace scope shared by chat, the projects plugin and the agent. */
export const WORKSPACE_PROJECT_ID = 'orbit-workspace';
export const WORKSPACE_PROJECT_LABEL = 'Orbit workspace';

export type ChatProjectScope = {
  id: string;
  label: string;
  source: 'workspace' | 'agent-actions' | 'workflow';
};

export const WORKSPACE_PROJECT_SCOPE: ChatProjectScope = {
  id: WORKSPACE_PROJECT_ID,
  label: WORKSPACE_PROJECT_LABEL,
  source: 'workspace',
};

/**
 * Lists the project-scope identities already used by ORBIT. This reads existing
 * records and never creates a parallel projects table.
 */
export async function listChatProjectScopes(
  db: SQLiteDatabase,
  userId: number
): Promise<ChatProjectScope[]> {
  const workflows = await new WorkflowStore(db).list(userId);

  return [
    WORKSPACE_PROJECT_SCOPE,
    { id: AGENT_ACTION_PROJECT_ID, label: 'Agent actions', source: 'agent-actions' },
    ...workflows.map((workflow) => ({
      id: `workflow-${workflow.id}`,
      label: `Workflow: ${workflow.name}`,
      source: 'workflow' as const,
    })),
  ];
}
