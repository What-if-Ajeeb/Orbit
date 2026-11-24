import { CATEGORY_META } from './catalog';
import { assessCommand } from './command-policy';
import { redactSecrets, summarizeArguments, truncate } from './redact';
import type {
  AgentIdentity,
  ClassifiedPermissionAction,
  PairedDeviceRecord,
  PermissionCategory,
  PermissionTarget,
  RiskLevel,
} from './types';

type ClassifyInput = {
  toolName: string;
  args: Record<string, unknown>;
  agent: AgentIdentity;
  projectId: string;
  projectLabel: string;
  devices?: PairedDeviceRecord[];
};

const SAFE_TASK_TOOLS = new Set([
  'list_tasks',
  'create_task',
  'update_task',
  'complete_task',
]);

const ARTIFACT_TOOLS = new Set([
  'artifact_create',
  'artifact_update',
  'artifact_edit',
  'artifact_read',
  'artifact_list',
]);

const GOOGLE_READ_TOOLS = new Set([
  'google_gmail_search',
  'google_gmail_read',
  'google_calendar_search',
  'google_drive_search',
  'google_drive_read',
]);

const GOOGLE_WRITE_TOOLS = new Set([
  'google_gmail_draft',
  'google_gmail_send',
  'google_calendar_create',
  'google_calendar_update',
  'google_drive_trash',
]);

const COMMAND_TOOL_PATTERN =
  /(?:^|_)(?:command|terminal|shell|exec|execute|run)(?:$|_)/i;

const FILE_DELETE_PATTERN = /(?:delete|remove|unlink|trash|rm)(?:[_-]?(?:file|folder|path|dir))?/i;
const FILE_READ_PATTERN = /(?:read|open|list|stat|inspect)(?:[_-]?(?:file|folder|path|dir))?/i;
const FILE_WRITE_PATTERN = /(?:write|create|edit|patch|append|save|mkdir)(?:[_-]?(?:file|folder|path|dir))?/i;
const BROWSER_PATTERN = /(?:browser|playwright|puppeteer|selenium|automation)/i;
const WEB_PATTERN = /(?:web|url|http|fetch|search|scrape|crawl|website|request)/i;
const INSTALL_PATTERN = /(?:install|dependency|dependencies|package|apk|app_install)/i;
const CAMERA_PATTERN = /(?:camera|microphone|mic|record_audio|photo|video|audio)/i;
const LOCATION_PATTERN = /(?:location|gps|geolocation)/i;
const CONTACTS_PATTERN = /(?:contact|address_book)/i;
const DATABASE_PATTERN = /(?:database|sqlite|sql|query|record|table)/i;
const NETWORK_PATTERN = /(?:network|socket|ping|dns|bandwidth)/i;
const BACKGROUND_PATTERN = /(?:background|cron|schedule|automation|job|queue)/i;

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstString(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function firstNumber(args: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = args[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return Number(value);
    }
  }

  return null;
}

function prettyToolName(name: string): string {
  return name
    .replace(/^mcp__/, '')
    .replace(/__/g, ' · ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function maxRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_ORDER[left] >= RISK_ORDER[right] ? left : right;
}

function hasSensitiveExternalAction(args: Record<string, unknown>, toolName: string): boolean {
  const riskyKeys = [
    'amount',
    'price',
    'payment',
    'purchase',
    'checkout',
    'transfer',
    'withdraw',
    'refund',
    'recipient',
    'to',
    'send',
    'email',
    'message',
    'card',
    'cvv',
    'wallet',
    'publish',
    'post',
  ];
  const riskyName = /(?:send|message|email|post|publish|purchase|pay|transfer|delete|remove|update|write)/i;
  const keyMatches = Object.keys(args).some((key) =>
    riskyKeys.some((risky) => key.toLowerCase().includes(risky))
  );

  return keyMatches || riskyName.test(toolName);
}

function makeAction(
  input: ClassifyInput,
  fields: {
    category: PermissionCategory;
    risk: RiskLevel;
    title: string;
    summary: string;
    actions: string[];
    target: PermissionTarget;
    reason: string;
    scopeKey: string;
    autoApprove?: boolean;
    command?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }
): ClassifiedPermissionAction {
  const risk = fields.risk;

  return {
    agent: input.agent,
    category: fields.category,
    risk,
    toolName: input.toolName,
    title: redactSecrets(fields.title),
    summary: redactSecrets(fields.summary),
    actions: fields.actions.map((action) => truncate(redactSecrets(action), 220)),
    target: {
      ...fields.target,
      label: redactSecrets(fields.target.label),
      detail: fields.target.detail ? redactSecrets(fields.target.detail) : undefined,
    },
    reason: redactSecrets(fields.reason),
    commandPreview: fields.command ? truncate(redactSecrets(fields.command), 600) : null,
    projectId: input.projectId,
    projectLabel: input.projectLabel,
    scopeKey: fields.scopeKey,
    // High-risk actions can never be "always allowed".
    allowAlways: risk !== 'high',
    autoApprove: fields.autoApprove === true,
    metadata: {
      categoryLabel: CATEGORY_META[fields.category].label,
      ...fields.metadata,
    },
  };
}

function taskActions(toolName: string, args: Record<string, unknown>): string[] {
  const title = firstString(args, ['title', 'name']);
  const taskId = firstNumber(args, ['task_id', 'id']);

  if (toolName === 'create_task') {
    return [
      title ? `Create task “${title}”` : 'Create a new task',
      args.due_at ? `Set a deadline` : 'Save to Orbit’s local database',
    ];
  }

  if (toolName === 'update_task') {
    return [taskId === null ? 'Update a task' : `Update task #${taskId}`];
  }

  if (toolName === 'complete_task') {
    return [taskId === null ? 'Mark a task complete' : `Mark task #${taskId} complete`];
  }

  if (toolName === 'delete_task') {
    return [taskId === null ? 'Delete a task' : `Permanently delete task #${taskId}`];
  }

  return ['Read task data from Orbit’s local database'];
}

function artifactActions(toolName: string, args: Record<string, unknown>): string[] {
  const title = firstString(args, ['title']);
  const id = firstString(args, ['id']);

  switch (toolName) {
    case 'artifact_create':
      return [title ? `Save artifact “${title}”` : 'Save a new artifact'];
    case 'artifact_update':
      return [id ? `Replace the content of ${id}` : 'Replace artifact content'];
    case 'artifact_edit':
      return [id ? `Apply small edits to ${id}` : 'Apply small edits'];
    default:
      return [id ? `Read artifact ${id}` : 'Read artifact data'];
  }
}

function commandTarget(input: ClassifyInput): PermissionTarget {
  const requestedId = firstString(input.args, ['device_id', 'deviceId']);
  const device =
    input.devices?.find((entry) => entry.id === requestedId) ?? input.devices?.[0];

  if (!device) {
    return {
      kind: 'device',
      label: 'Connected computer',
      detail: 'No ORBIT Desktop Companion is paired yet.',
    };
  }

  return {
    kind: 'device',
    label: device.name,
    detail: `${device.platform} · paired companion`,
  };
}

export function classifyToolAction(input: ClassifyInput): ClassifiedPermissionAction {
  const rawName = input.toolName;
  const name = rawName.toLowerCase();
  const args = input.args;
  const command = firstString(args, ['command', 'cmd', 'script', 'shell']);
  const path = firstString(args, ['path', 'file', 'file_path', 'directory', 'dir', 'cwd']);
  const url = firstString(args, ['url', 'href', 'link', 'website']);
  const display = prettyToolName(rawName);

  if (GOOGLE_READ_TOOLS.has(name) || GOOGLE_WRITE_TOOLS.has(name)) {
    const writing = GOOGLE_WRITE_TOOLS.has(name);
    const provider = name.includes('gmail')
      ? 'Gmail'
      : name.includes('calendar')
        ? 'Google Calendar'
        : 'Google Drive';

    return makeAction(input, {
      category: 'external_api',
      risk: writing ? 'high' : 'medium',
      title: writing
        ? `Allow ${input.agent.name} to change ${provider}?`
        : `Allow ${input.agent.name} to read ${provider}?`,
      summary: writing
        ? 'This changes data in your connected Google account. Approve only when you trust this exact request.'
        : 'Orbit will read content from your connected Google account. Tokens stay in Android Keystore and are never passed to plugins.',
      actions: [`Use ${display} on ${provider}`, ...summarizeArguments(args, 3)],
      target: {
        kind: 'service',
        label: provider,
        detail: 'Connected Google account',
      },
      reason: 'The agent needs the connected account to complete your request.',
      scopeKey: `google:${rawName}:${input.projectId}`,
      autoApprove: false,
      metadata: { connection: 'google', tool: rawName, sensitive: true },
    });
  }

  if (ARTIFACT_TOOLS.has(name)) {
    const reading = name === 'artifact_read' || name === 'artifact_list';

    return makeAction(input, {
      category: 'database_operations',
      risk: 'low',
      title: reading
        ? 'Read artifacts from your Orbit database'
        : 'Save an artifact to your Orbit database',
      summary:
        'Artifacts are self-contained files the agent saves on this device. This stays local, uses no network, and needs no extra approval.',
      actions: artifactActions(name, args),
      target: { kind: 'resource', label: 'Orbit artifacts', detail: 'On this device' },
      reason: 'The agent needs to save or read artifact content to complete your request.',
      scopeKey: `artifact:${name}:${input.projectId}`,
      autoApprove: true,
      metadata: { localOnly: true, noNetwork: true },
    });
  }

  if (SAFE_TASK_TOOLS.has(name)) {
    return makeAction(input, {
      category: 'database_operations',
      risk: 'low',
      title:
        name === 'list_tasks'
          ? 'Read tasks from your Orbit database'
          : `Run ${prettyToolName(name)} in your Orbit database`,
      summary:
        'This is a low-risk, on-device task operation. It never leaves your phone and stays inside your task data.',
      actions: taskActions(name, args),
      target: { kind: 'resource', label: 'Orbit task database', detail: 'On this device' },
      reason: 'The agent needs to read or update task data to complete your request.',
      scopeKey: `${name}:${input.projectId}`,
      autoApprove: true,
      metadata: { localOnly: true },
    });
  }

  if (name === 'delete_task') {
    return makeAction(input, {
      category: 'database_operations',
      risk: 'high',
      title: 'Delete a task from your Orbit database?',
      summary:
        'This permanently removes the task and its reminder. Deletion is high risk and needs explicit approval every time.',
      actions: taskActions(name, args),
      target: { kind: 'resource', label: 'Orbit task database', detail: 'On this device' },
      reason: 'The agent was asked to delete data. This cannot be undone.',
      scopeKey: `delete_task:${input.projectId}`,
      metadata: { destructive: true },
    });
  }

  if (name.startsWith('mcp__')) {
    const parts = rawName.split('__').filter(Boolean);
    const server = parts.length > 2 ? parts[1] : 'MCP server';
    const risyAction = hasSensitiveExternalAction(args, rawName);
    const risk: RiskLevel = risyAction ? 'high' : 'medium';

    return makeAction(input, {
      category: 'external_api',
      risk,
      title: `Allow ${input.agent.name} to use “${display}”?`,
      summary:
        'Orbit will call an external MCP tool. Its server can read or change data outside this phone.',
      actions: [
        `Call ${display} on ${server}`,
        ...summarizeArguments(args, 3),
      ],
      target: {
        kind: 'service',
        label: `${server} MCP server`,
        detail: 'External service',
      },
      reason:
        'The connected MCP server exposes this tool. The agent needs it to answer your request.',
      scopeKey: `mcp:${rawName}:${input.projectId}`,
      metadata: { server, tool: rawName },
    });
  }

  if (name.startsWith('cordis_')) {
    const mutates = !name.includes('list');
    return makeAction(input, {
      category: mutates ? 'background_automation' : 'database_operations',
      risk: mutates ? 'high' : 'low',
      title: mutates
        ? 'Run agent-created code on this device?'
        : 'Inspect Orbit plugins on this device?',
      summary: mutates
        ? 'Creator mode can install and run JavaScript plugins inside Orbit. That code has the same access as the app.'
        : 'This reads the local plugin registry only.',
      actions: [
        `Run ${display}`,
        ...summarizeArguments(args, 3),
      ],
      target: { kind: 'application', label: 'Orbit plugin runtime', detail: 'This Android device' },
      reason:
        'Creator mode lets the agent extend Orbit at runtime. Installing code is a high-risk operation.',
      scopeKey: `cordis:${name}:${input.projectId}`,
      autoApprove: !mutates,
      metadata: { creatorMode: true },
    });
  }

  if (COMMAND_TOOL_PATTERN.test(name) || name === 'computer_execute') {
    const assessment = assessCommand(command || '');
    const remote = name === 'computer_execute' || Boolean(input.devices?.length) || Boolean(firstString(args, ['device_id']));
    const risk = command ? assessment.risk : 'high';
    const cwd = firstString(args, ['cwd', 'working_directory', 'directory']);
    const target = remote
      ? commandTarget(input)
      : {
          kind: 'resource' as const,
          label: 'Sandboxed script runner',
          detail: 'On this device',
        };

    return makeAction(input, {
      category: remote ? 'computer_access' : 'terminal_commands',
      risk,
      title: command
        ? `Allow ${input.agent.name} to ${risk === 'medium' ? 'run a build command' : 'execute a command'} on ${remote ? 'your connected computer' : 'this device'}?`
        : `Allow ${input.agent.name} to execute a command?`,
      summary: risk === 'medium'
        ? 'This command matches the sandbox-friendly build, test, or read allowlist.'
        : 'This is not a sandboxed build command. It can change files or system state, so every run needs approval.',
      actions: [
        command ? `Execute: ${truncate(command, 140)}` : 'Execute a shell command',
        cwd ? `Working directory: ${cwd}` : 'Use the companion’s configured workspace',
        ...(assessment.safe ? ['Command class: sandboxed build/test'] : ['Command class: unrestricted']),
      ],
      target,
      reason: remote
        ? 'The command runs outside this phone. ORBIT Desktop Companion will authenticate the request before execution.'
        : 'The agent needs to run a command to complete your request.',
      scopeKey: remote
        ? `computer:${target.label}:${assessment.safe ? 'safe' : 'unrestricted'}`
        : `terminal:${assessment.safe ? 'safe' : 'unrestricted'}`,
      command: command || undefined,
      metadata: {
        commandClass: assessment.safe ? 'safe' : 'unrestricted',
        remote,
        blocked: assessment.blocked,
      },
    });
  }

  if (FILE_DELETE_PATTERN.test(name) && (name.includes('file') || name.includes('fs') || name.includes('path'))) {
    return makeAction(input, {
      category: 'file_delete',
      risk: 'high',
      title: `Allow ${input.agent.name} to delete a file?`,
      summary: 'Deleted files may not be recoverable. This needs explicit approval every time.',
      actions: [
        path ? `Delete: ${path}` : `Run ${display}`,
        ...summarizeArguments(args, 2),
      ],
      target: { kind: 'file', label: path || 'Project file', detail: input.projectLabel },
      reason: 'The task requires removing a file. This is destructive and cannot be always-allowed.',
      scopeKey: `delete:${input.projectId}:${path || 'file'}`,
      metadata: { destructive: true },
    });
  }

  if (FILE_WRITE_PATTERN.test(name) && (name.includes('file') || name.includes('fs') || name.includes('path'))) {
    return makeAction(input, {
      category: 'file_write',
      risk: 'medium',
      title: `Allow ${input.agent.name} to create or modify project files?`,
      summary: 'The agent will write inside the approved project. Existing files may be replaced.',
      actions: [
        path ? `Write to: ${path}` : 'Create or modify project files',
        ...summarizeArguments(args, 2),
      ],
      target: { kind: 'file', label: path || 'Project workspace', detail: input.projectLabel },
      reason: 'The agent needs to save project changes requested by the user.',
      scopeKey: `file_write:${input.projectId}:${path || 'workspace'}`,
    });
  }

  if (FILE_READ_PATTERN.test(name) && (name.includes('file') || name.includes('fs') || name.includes('path'))) {
    return makeAction(input, {
      category: 'file_read',
      risk: 'low',
      title: `Allow ${input.agent.name} to read project files?`,
      summary: 'The agent will read files from the approved project so it can understand the work.',
      actions: [
        path ? `Read: ${path}` : 'Read project files',
        ...summarizeArguments(args, 2),
      ],
      target: { kind: 'file', label: path || 'Project workspace', detail: input.projectLabel },
      reason: 'The agent needs file contents to complete your request.',
      scopeKey: `file_read:${input.projectId}:${path || 'workspace'}`,
    });
  }

  if (INSTALL_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'app_installation',
      risk: 'high',
      title: `Allow ${input.agent.name} to install software?`,
      summary: 'Installed packages run code and may change the device or project. This needs approval every time.',
      actions: [
        `Run ${display}`,
        ...summarizeArguments(args, 3),
      ],
      target: { kind: 'application', label: display, detail: input.projectLabel },
      reason: 'The task requires installing new software or dependencies.',
      scopeKey: `install:${input.projectId}:${display}`,
      metadata: { destructive: true },
    });
  }

  if (BROWSER_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'browser_automation',
      risk: 'medium',
      title: `Allow ${input.agent.name} to control a browser?`,
      summary: 'The agent can navigate pages, click controls, and fill forms.',
      actions: [
        `Run ${display}`,
        ...summarizeArguments(args, 3),
      ],
      target: { kind: 'website', label: url || 'Browser session', detail: input.projectLabel },
      reason: 'The requested workflow needs browser automation.',
      scopeKey: `browser:${input.projectId}:${display}`,
    });
  }

  if (CAMERA_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'camera_microphone',
      risk: 'high',
      title: `Allow ${input.agent.name} to use the camera or microphone?`,
      summary: 'This accesses sensitive Android sensors. Android will also ask for its own runtime permission.',
      actions: [
        `Run ${display}`,
        'Access camera / microphone',
        ...summarizeArguments(args, 2),
      ],
      target: { kind: 'resource', label: 'This Android device', detail: 'Camera / microphone' },
      reason: 'The task explicitly needs image, video, or audio input.',
      scopeKey: `sensors:${input.projectId}:${display}`,
      metadata: { androidRuntime: true },
    });
  }

  if (LOCATION_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'location',
      risk: 'high',
      title: `Allow ${input.agent.name} to read your location?`,
      summary: 'This reads precise or approximate location from Android after a runtime permission check.',
      actions: [`Run ${display}`, 'Read device location', ...summarizeArguments(args, 2)],
      target: { kind: 'resource', label: 'This Android device', detail: 'Location services' },
      reason: 'The task explicitly needs location data.',
      scopeKey: `location:${input.projectId}:${display}`,
      metadata: { androidRuntime: true },
    });
  }

  if (CONTACTS_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'contacts',
      risk: 'high',
      title: `Allow ${input.agent.name} to read your contacts?`,
      summary: 'Contact data is sensitive. Android will also show its runtime permission prompt.',
      actions: [`Run ${display}`, 'Read contact records', ...summarizeArguments(args, 2)],
      target: { kind: 'resource', label: 'This Android device', detail: 'Contacts' },
      reason: 'The task explicitly needs contact information.',
      scopeKey: `contacts:${input.projectId}:${display}`,
      metadata: { androidRuntime: true },
    });
  }

  if (DATABASE_PATTERN.test(name)) {
    const destructive = /(?:delete|drop|truncate|update|insert|alter)/i.test(name);
    return makeAction(input, {
      category: 'database_operations',
      risk: destructive ? 'high' : 'medium',
      title: `Allow ${input.agent.name} to run a database operation?`,
      summary: destructive
        ? 'This can permanently change or remove records.'
        : 'This reads or queries a database.',
      actions: [`Run ${display}`, ...summarizeArguments(args, 3)],
      target: { kind: 'service', label: 'Database', detail: input.projectLabel },
      reason: 'The task needs structured data from a database.',
      scopeKey: `db:${input.projectId}:${display}:${destructive ? 'write' : 'read'}`,
      metadata: destructive ? { destructive: true } : undefined,
    });
  }

  if (WEB_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'website_access',
      risk: 'low',
      title: `Allow ${input.agent.name} to access a website?`,
      summary: 'The agent will read the page or send a search request.',
      actions: [`Run ${display}`, ...summarizeArguments(args, 3)],
      target: { kind: 'website', label: url || 'Approved website', detail: input.projectLabel },
      reason: 'The task needs current information from the web.',
      scopeKey: `web:${input.projectId}:${display}`,
    });
  }

  if (NETWORK_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'network_access',
      risk: 'medium',
      title: `Allow ${input.agent.name} to use the network?`,
      summary: 'The agent will make an outbound network request.',
      actions: [`Run ${display}`, ...summarizeArguments(args, 3)],
      target: { kind: 'service', label: 'Network', detail: input.projectLabel },
      reason: 'The task needs to communicate with a network service.',
      scopeKey: `network:${input.projectId}:${display}`,
    });
  }

  if (BACKGROUND_PATTERN.test(name)) {
    return makeAction(input, {
      category: 'background_automation',
      risk: 'medium',
      title: `Allow ${input.agent.name} to run a background automation?`,
      summary: 'The automation can continue working after this turn ends.',
      actions: [`Run ${display}`, ...summarizeArguments(args, 3)],
      target: { kind: 'application', label: 'Orbit automation runtime', detail: input.projectLabel },
      reason: 'The task requires work outside the current chat turn.',
      scopeKey: `automation:${input.projectId}:${display}`,
    });
  }

  const risk = maxRisk(CATEGORY_META.background_automation.defaultRisk, 'medium');

  return makeAction(input, {
    category: 'background_automation',
    risk,
    title: `Allow ${input.agent.name} to run “${display}”?`,
    summary: 'This tool is not in the built-in safe list, so Orbit is asking before it runs.',
    actions: [`Run ${display}`, ...summarizeArguments(args, 3)],
    target: { kind: 'application', label: display, detail: input.projectLabel },
    reason: 'The agent needs this tool to complete your request.',
    scopeKey: `tool:${rawName}:${input.projectId}`,
  });
}

export function requestTitleForTool(
  toolName: string,
  agent: AgentIdentity,
  category: PermissionCategory
): string {
  const tool = asString(toolName);
  return `Allow ${agent.name} to use ${CATEGORY_META[category].shortLabel.toLowerCase()} (${prettyToolName(tool)})?`;
}
