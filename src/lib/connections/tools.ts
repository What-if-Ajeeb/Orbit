import { agentToolRegistry, toolFail } from '@/lib/ai/tool-registry';
import type { AgentTool } from '@/lib/ai/tool-registry';
import type { JsonSchema } from '@/lib/ai/types';

import {
  calendarCreate,
  calendarSearch,
  calendarUpdate,
  driveRead,
  driveSearch,
  driveTrash,
  gmailDraft,
  gmailRead,
  gmailSearch,
  gmailSend,
} from './api';
import { ConnectionError, type GoogleConnectionId } from './types';

export type ConnectionToolAction = 'read' | 'write';

export type ConnectionToolMeta = {
  name: string;
  label: string;
  connectionId: GoogleConnectionId;
  action: ConnectionToolAction;
  description: string;
};

const TOOL_META: ConnectionToolMeta[] = [
  {
    name: 'google_gmail_search',
    label: 'Search Gmail',
    connectionId: 'gmail',
    action: 'read',
    description: 'Find messages in the connected Gmail account.',
  },
  {
    name: 'google_gmail_read',
    label: 'Read Gmail message',
    connectionId: 'gmail',
    action: 'read',
    description: 'Read the subject, sender and plain text body of one Gmail message.',
  },
  {
    name: 'google_gmail_draft',
    label: 'Create Gmail draft',
    connectionId: 'gmail',
    action: 'write',
    description: 'Create a draft in the connected Gmail account. Requires approval.',
  },
  {
    name: 'google_gmail_send',
    label: 'Send Gmail message',
    connectionId: 'gmail',
    action: 'write',
    description: 'Send an email from the connected Gmail account. Requires approval.',
  },
  {
    name: 'google_calendar_search',
    label: 'Find calendar events',
    connectionId: 'google_calendar',
    action: 'read',
    description: 'Find upcoming events in the connected Google Calendar.',
  },
  {
    name: 'google_calendar_create',
    label: 'Create calendar event',
    connectionId: 'google_calendar',
    action: 'write',
    description: 'Create an event in the connected Google Calendar. Requires approval.',
  },
  {
    name: 'google_calendar_update',
    label: 'Change calendar event',
    connectionId: 'google_calendar',
    action: 'write',
    description: 'Change an event in the connected Google Calendar. Requires approval.',
  },
  {
    name: 'google_drive_search',
    label: 'Search Drive files',
    connectionId: 'google_drive',
    action: 'read',
    description: 'Find files in the connected Google Drive.',
  },
  {
    name: 'google_drive_read',
    label: 'Read Drive file',
    connectionId: 'google_drive',
    action: 'read',
    description: 'Read metadata and, for text files, the contents of one Drive file.',
  },
  {
    name: 'google_drive_trash',
    label: 'Trash Drive file',
    connectionId: 'google_drive',
    action: 'write',
    description: 'Move a file to trash in the connected Google Drive. Requires approval.',
  },
];

export const CONNECTION_TOOLS: ConnectionToolMeta[] = TOOL_META.map((tool) => ({ ...tool }));
export const CONNECTION_TOOL_NAMES: string[] = TOOL_META.map((tool) => tool.name);

function schema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

const STRING = { type: 'string' };
const LIMITED_STRING = { type: 'string', maxLength: 200 };
const LONG_STRING = { type: 'string', maxLength: 10_000 };

function defineTool(
  meta: ConnectionToolMeta,
  parameters: JsonSchema,
  run: (userId: number, args: Record<string, unknown>) => Promise<Record<string, unknown>>
): AgentTool {
  return {
    definition: {
      name: meta.name,
      description: meta.description,
      parameters,
    },
    meta: {
      source: 'connection',
      pluginId: `connection.${meta.connectionId}`,
      permissions: [`connection.${meta.connectionId}.${meta.action}`],
    },
    execute: async (context, args) => {
      if (context.signal?.aborted) {
        return { content: toolFail('Request cancelled.'), trace: '' };
      }

      try {
        const result = await run(context.userId, args);

        if (context.signal?.aborted) {
          return { content: toolFail('Request cancelled.'), trace: '' };
        }

        return {
          content: JSON.stringify(result),
          trace: `${meta.label} · ${meta.connectionId}`,
        };
      } catch (error) {
        const message =
          error instanceof ConnectionError
            ? error.message
            : 'The connected service could not complete this request.';

        return {
          content: toolFail(message),
          trace: `${meta.label} failed`,
        };
      }
    },
  };
}

const CONNECTION_AGENT_TOOLS: AgentTool[] = [
  defineTool(
    TOOL_META[0],
    schema({ query: STRING, limit: { type: 'number', minimum: 1, maximum: 25 } }),
    gmailSearch
  ),
  defineTool(TOOL_META[1], schema({ messageId: LIMITED_STRING }, ['messageId']), gmailRead),
  defineTool(
    TOOL_META[2],
    schema({ to: STRING, subject: LIMITED_STRING, body: LONG_STRING }, ['to', 'subject', 'body']),
    gmailDraft
  ),
  defineTool(
    TOOL_META[3],
    schema({ to: STRING, subject: LIMITED_STRING, body: LONG_STRING }, ['to', 'subject', 'body']),
    gmailSend
  ),
  defineTool(
    TOOL_META[4],
    schema({
      query: STRING,
      timeMin: STRING,
      timeMax: STRING,
      limit: { type: 'number', minimum: 1, maximum: 25 },
    }),
    calendarSearch
  ),
  defineTool(
    TOOL_META[5],
    schema(
      {
        summary: LIMITED_STRING,
        start: STRING,
        end: STRING,
        description: { type: 'string', maxLength: 4_000 },
        location: { type: 'string', maxLength: 300 },
        attendees: { type: 'array', items: STRING, maxItems: 20 },
      },
      ['summary', 'start', 'end']
    ),
    calendarCreate
  ),
  defineTool(
    TOOL_META[6],
    schema({
      eventId: LIMITED_STRING,
      summary: LIMITED_STRING,
      description: { type: 'string', maxLength: 4_000 },
      start: STRING,
      end: STRING,
    }, ['eventId']),
    calendarUpdate
  ),
  defineTool(
    TOOL_META[7],
    schema({ query: STRING, limit: { type: 'number', minimum: 1, maximum: 25 } }),
    driveSearch
  ),
  defineTool(TOOL_META[8], schema({ fileId: LIMITED_STRING }, ['fileId']), driveRead),
  defineTool(TOOL_META[9], schema({ fileId: LIMITED_STRING }, ['fileId']), driveTrash),
];

for (const tool of CONNECTION_AGENT_TOOLS) {
  agentToolRegistry.register(tool, { replace: true });
}
