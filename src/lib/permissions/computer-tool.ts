import { executeCompanionCommand } from './devices';
import { redactSecrets, truncate } from './redact';
import { toolFail, toolOk, type AgentTool } from '../ai/tool-registry';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '';
}

/**
 * The only way an agent can touch a computer is through an explicitly paired
 * ORBIT Desktop Companion. There is no local fallback and no direct remote
 * shell: pairing, authentication and workspace restrictions live in the
 * companion, and permission validation happens before this tool is called.
 */
export const COMPUTER_EXECUTE_TOOL: AgentTool = {
  definition: {
    name: 'computer_execute',
    description:
      'Run a terminal command on a computer that the user explicitly paired through ORBIT Desktop Companion. Use only when the user asks for work on their connected computer. Never claim a command ran unless this tool returns ok.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The exact shell command to run on the paired computer.',
        },
        cwd: {
          type: 'string',
          description:
            'Optional working directory inside the companion’s approved workspace.',
        },
        device_id: {
          type: 'string',
          description:
            'Optional paired device id. Omit to use the active paired computer.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  async execute({ db, userId }, args) {
    const command = asString(args.command).trim();
    const cwd = asString(args.cwd).trim();
    const deviceId = asString(args.device_id).trim();

    if (!command) {
      return { content: toolFail('command is required.'), trace: '' };
    }

    try {
      const result = await executeCompanionCommand({
        db,
        userId,
        command,
        cwd: cwd || undefined,
        deviceId: deviceId || undefined,
      });
      const summary = firstLine(result.stdout) || firstLine(result.stderr);

      return {
        content: toolOk({
          device: result.deviceName,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
        trace: summary
          ? `Ran on ${result.deviceName}: ${truncate(redactSecrets(summary), 90)}`
          : `Ran on ${result.deviceName} (exit ${result.exitCode ?? 'unknown'})`,
      };
    } catch (error) {
      return {
        content: toolFail(
          error instanceof Error ? error.message : 'The computer could not run this command.'
        ),
        trace: '',
      };
    }
  },
};
