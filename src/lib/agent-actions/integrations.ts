import { blockedCommandReason, validatePath } from '@/lib/permissions/command-policy';

import type {
  AgentActionDisplay,
  AgentActionIntegration,
} from './types';

type AnyPayload = Record<string, unknown>;

function defineIntegration<T extends AnyPayload>(
  definition: AgentActionIntegration<T>
): AgentActionIntegration<AnyPayload> {
  const resolveToolName =
    typeof definition.toolName === 'function'
      ? definition.toolName
      : () => definition.toolName as string;

  return {
    kind: definition.kind,
    label: definition.label,
    toolName: (payload) => resolveToolName(payload as T),
    requiredPermissions: definition.requiredPermissions,
    approval: definition.approval,
    validate: (payload) => definition.validate(payload as T),
    describe: (payload) => definition.describe(payload as T),
    buildArgs: (payload) => definition.buildArgs(payload as T),
  };
}

function text(value: unknown, max = 4_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function linesFrom(values: [string, string | string[] | undefined][]): string[] {
  return values.flatMap(([label, value]) => {
    if (Array.isArray(value)) {
      return value.length > 0 ? [`${label}: ${value.join(', ')}`] : [];
    }

    return value ? [`${label}: ${value}`] : [];
  });
}

function display(title: string, target: string, lines: string[]): AgentActionDisplay {
  return { title, target, lines };
}

const SAFE_PATH = /^[A-Za-z0-9._/\- ]+$/;
const SAFE_REF = /^[A-Za-z0-9._/\-]+$/;

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildGitCommand(payload: AnyPayload): { command: string; error: string | null } {
  const operation = text(payload.operation, 30);
  const repoPath = text(payload.repoPath, 500);
  const message = text(payload.message, 500);
  const remote = text(payload.remote, 100) || 'origin';
  const branch = text(payload.branch, 200);

  if (!SAFE_PATH.test(repoPath)) {
    return {
      command: '',
      error: 'Repository path may only contain letters, numbers, spaces, dots, slashes, dashes and underscores.',
    };
  }

  const root = `git -C ${quoteShell(repoPath)}`;
  let command: string;

  switch (operation) {
    case 'status':
      command = `${root} status --short`;
      break;
    case 'diff':
      command = `${root} diff`;
      break;
    case 'log':
      command = `${root} log --oneline -n 10`;
      break;
    case 'branch':
      command = `${root} branch --show-current`;
      break;
    case 'fetch':
      command = `${root} fetch ${quoteShell(remote)}`;
      break;
    case 'commit':
      if (!message) {
        return { command: '', error: 'A commit message is required.' };
      }
      command = `${root} commit -m ${quoteShell(message)}`;
      break;
    case 'push':
      if (!SAFE_REF.test(remote) || (branch && !SAFE_REF.test(branch))) {
        return { command: '', error: 'Remote and branch names contain unsupported characters.' };
      }
      command = branch
        ? `${root} push ${quoteShell(remote)} ${quoteShell(branch)}`
        : `${root} push ${quoteShell(remote)}`;
      break;
    default:
      return { command: '', error: 'Unsupported git operation.' };
  }

  const blocked = blockedCommandReason(command);

  return blocked ? { command: '', error: blocked } : { command, error: null };
}

const integrations = new Map<string, AgentActionIntegration<AnyPayload>>();

export function registerAgentActionIntegration<T extends AnyPayload>(
  definition: AgentActionIntegration<T>
): void {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(definition.kind)) {
    throw new Error('Action integration kind must be a short lowercase slug.');
  }

  integrations.set(definition.kind, defineIntegration(definition));
}

export function getAgentActionIntegration(kind: string): AgentActionIntegration<AnyPayload> | null {
  return integrations.get(kind) ?? null;
}

export function listAgentActionIntegrations(): {
  kind: string;
  label: string;
  requiredPermissions: readonly string[];
  approval: 'always' | 'never';
}[] {
  return Array.from(integrations.values()).map(({ kind, label, requiredPermissions, approval }) => ({
    kind,
    label,
    requiredPermissions,
    approval,
  }));
}

registerAgentActionIntegration<AnyPayload>({
  kind: 'email',
  label: 'Email',
  toolName: 'google_gmail_send',
  requiredPermissions: ['connection.gmail.write'],
  approval: 'always',
  validate: (payload) => {
    const to = text(payload.to, 320);
    const subject = text(payload.subject, 200);
    const body = text(payload.body, 10_000);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return 'Enter a valid recipient email address.';
    }
    if (!subject) {
      return 'A subject is required.';
    }
    if (!body) {
      return 'A message body is required.';
    }
    return null;
  },
  describe: (payload) =>
    display(
      `Send email to ${text(payload.to, 320)}`,
      text(payload.to, 320),
      linesFrom([
        ['Subject', text(payload.subject, 200)],
        ['Cc', text(payload.cc, 320)],
        ['Bcc', text(payload.bcc, 320)],
        ['Body', `${text(payload.body, 10_000).length} characters`],
      ])
    ),
  buildArgs: (payload) => {
    const args: AnyPayload = {
      to: text(payload.to, 320),
      subject: text(payload.subject, 200),
      body: text(payload.body, 10_000),
    };
    const cc = text(payload.cc, 320);
    const bcc = text(payload.bcc, 320);

    if (cc) args.cc = cc;
    if (bcc) args.bcc = bcc;
    return args;
  },
});

registerAgentActionIntegration<AnyPayload>({
  kind: 'file',
  label: 'File operation',
  toolName: (payload) =>
    payload.operation === 'restore' ? 'file_restore' : 'file_trash',
  requiredPermissions: ['file.safety.write'],
  approval: 'always',
  validate: (payload) => {
    const operation = text(payload.operation, 30);
    const path = text(payload.path, 1_000);

    if (operation !== 'trash' && operation !== 'restore') {
      return 'File operation must be trash or restore.';
    }
    if (!path) {
      return 'A file path is required.';
    }

    return validatePath(path);
  },
  describe: (payload) =>
    display(
      `${text(payload.operation, 30) === 'restore' ? 'Restore' : 'Trash'} file`,
      text(payload.path, 1_000),
      [`Operation: ${text(payload.operation, 30)}`, `Path: ${text(payload.path, 1_000)}`]
    ),
  buildArgs: (payload) => ({ path: text(payload.path, 1_000) }),
});

registerAgentActionIntegration<AnyPayload>({
  kind: 'git',
  label: 'Git operation',
  toolName: 'computer_execute',
  requiredPermissions: ['computer.execute'],
  approval: 'always',
  validate: (payload) => buildGitCommand(payload).error,
  describe: (payload) => {
    const { command } = buildGitCommand(payload);

    return display(
      `Run ${text(payload.operation, 30) || 'git'} operation`,
      text(payload.repoPath, 500),
      [
        `Repository: ${text(payload.repoPath, 500)}`,
        `Command: ${command}`,
        ...linesFrom([
          ['Message', text(payload.message, 500)],
          ['Remote', text(payload.remote, 100)],
          ['Branch', text(payload.branch, 200)],
        ]),
      ]
    );
  },
  buildArgs: (payload) => ({ command: buildGitCommand(payload).command }),
});

registerAgentActionIntegration<AnyPayload>({
  kind: 'calendar',
  label: 'Calendar',
  toolName: (payload) =>
    payload.operation === 'update' ? 'google_calendar_update' : 'google_calendar_create',
  requiredPermissions: ['connection.google_calendar.write'],
  approval: 'always',
  validate: (payload) => {
    const operation = text(payload.operation, 30);

    if (operation === 'update' && !text(payload.eventId, 200)) {
      return 'An event ID is required for updates.';
    }
    if (operation !== 'update') {
      if (!text(payload.summary, 200)) {
        return 'An event title is required.';
      }
      if (!text(payload.start, 100) || !text(payload.end, 100)) {
        return 'Both start and end times are required.';
      }
    }
    return null;
  },
  describe: (payload) => {
    const operation = text(payload.operation, 30);
    const title = operation === 'update' ? text(payload.eventId, 200) : text(payload.summary, 200);

    return display(
      operation === 'update' ? `Update event ${title}` : `Create event ${title}`,
      title,
      linesFrom([
        ['Start', text(payload.start, 100)],
        ['End', text(payload.end, 100)],
        ['Location', text(payload.location, 300)],
        ['Description', text(payload.description, 4_000)],
        ['Attendees', Array.isArray(payload.attendees) ? payload.attendees.map((value) => text(value, 320)) : undefined],
      ])
    );
  },
  buildArgs: (payload) => {
    const operation = text(payload.operation, 30);
    const args: AnyPayload = {};

    if (operation === 'update') {
      args.eventId = text(payload.eventId, 200);
    } else {
      args.summary = text(payload.summary, 200);
      args.start = text(payload.start, 100);
      args.end = text(payload.end, 100);
    }

    const description = text(payload.description, 4_000);
    const location = text(payload.location, 300);

    if (description) args.description = description;
    if (location) args.location = location;

    if (Array.isArray(payload.attendees)) {
      const attendees = payload.attendees
        .map((value) => text(value, 320))
        .filter((value) => value.length > 0)
        .slice(0, 20);

      if (attendees.length > 0) args.attendees = attendees;
    }

    return args;
  },
});
