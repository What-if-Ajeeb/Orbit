import type { SQLiteDatabase } from 'expo-sqlite';

import { formatDue, parseTaskText } from '../dates';
import { completeTask, createTask, listTasks } from '../tasks';

export type LocalAgentResult = {
  reply: string;
  traces: string[];
};

export type LocalToolExecutor = (
  toolName: 'list_tasks' | 'complete_task' | 'create_task',
  args: Record<string, unknown>
) => Promise<{ content: string; success: boolean; trace?: string; error?: string }>;

const HELP_TEXT = `Main abhi system mode me hoon — tasks aur reminders local pe chalte hain, koi cloud API key zaroori nahi.

Ye commands chalte hain:
• "Add task pay electricity bill tomorrow 5pm"
• "Remind me to call mom at 7pm"
• "What's pending?"
• "Complete 3"

Phone pe Ollama chal raha ho to Settings → AI se on-device model connect karo; natural chat wahan se open hoga. Cloud key optional hai.`;

type LocalTask = { id: number; title: string; dueAt: number | null; remindAt: number | null };

function extractCreateText(text: string): { text: string; reminder: boolean } | null {
  const patterns: { pattern: RegExp; reminder: boolean }[] = [
    { pattern: /^(?:please\s+)?remind me\s+(?:to|about|that)\s+(.+)$/i, reminder: true },
    { pattern: /^(?:please\s+)?reminder\s*[:\-–]?\s*(.+)$/i, reminder: true },
    { pattern: /^(.+?)\s+yaad\s+dila(?:o|na|do)\s*[?.!]*$/i, reminder: true },
    { pattern: /^(.+?)\s+(?:ka\s+)?reminder\s+(?:laga|set|bana)\s*(?:do|de)?\s*[?.!]*$/i, reminder: true },
    {
      pattern:
        /^(?:add|create|make|new)\s+(?:a\s+|an\s+|one\s+)?(?:task|todo|reminder)?\s*[:\-–]?\s*(.+)$/i,
      reminder: false,
    },
    { pattern: /^(?:task|todo)\s*[:\-–]\s*(.+)$/i, reminder: false },
    { pattern: /^(.+?)\s+(?:ka\s+)?task\s+(?:bana|add|lagao|daal)\s*(?:do|de)?\s*[?.!]*$/i, reminder: false },
  ];

  for (const entry of patterns) {
    const match = text.match(entry.pattern);

    if (match?.[1]?.trim()) {
      return { text: match[1].trim(), reminder: entry.reminder };
    }
  }

  return null;
}

function isGreeting(text: string): boolean {
  return /^(?:hi|hello|hey|namaste|namaskar|hola|yo)\b[!. ]*$/i.test(text.trim());
}

function isAcknowledgement(text: string): boolean {
  return /^(?:thanks|thank you|ok|okay|cool|great|nice|perfect|sounds good|haan|theek hai|shukriya|dhanyavad)[!. ]*$/i.test(
    text.trim()
  );
}

function parseLocalTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tasksFromTool(content: string): LocalTask[] {
  try {
    const parsed = JSON.parse(content) as {
      ok?: unknown;
      tasks?: Record<string, unknown>[];
    };
    if (parsed.ok !== true || !Array.isArray(parsed.tasks)) return [];
    return parsed.tasks
      .map((entry) => ({
        id: typeof entry.id === 'number' ? entry.id : Number(entry.id),
        title: typeof entry.title === 'string' ? entry.title : '',
        dueAt: parseLocalTimestamp(entry.due_at),
        remindAt: parseLocalTimestamp(entry.remind_at),
      }))
      .filter((task) => Number.isInteger(task.id) && task.id > 0 && Boolean(task.title));
  } catch {
    return [];
  }
}

function titleFromTool(content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      ok?: unknown;
      task?: { title?: unknown };
    };
    return parsed.ok === true && typeof parsed.task?.title === 'string' ? parsed.task.title : '';
  } catch {
    return '';
  }
}

async function listLocalTasks(
  db: SQLiteDatabase,
  userId: number,
  execute?: LocalToolExecutor
): Promise<LocalTask[]> {
  if (!execute) {
    const tasks = await listTasks(db, userId, { status: 'open', limit: 50 });
    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      remindAt: task.remindAt,
    }));
  }

  const result = await execute('list_tasks', { status: 'open', limit: 50 });
  return result.success ? tasksFromTool(result.content) : [];
}

export async function runLocalAgent(
  db: SQLiteDatabase,
  userId: number,
  text: string,
  execute?: LocalToolExecutor
): Promise<LocalAgentResult> {
  const input = text.trim();

  if (!input) {
    return { reply: HELP_TEXT, traces: [] };
  }

  if (isGreeting(input)) {
    return {
      reply: `Namaste! Main Orbit hoon — system mode me tasks aur reminders manage kar sakta hoon.\n\n${HELP_TEXT}`,
      traces: [],
    };
  }

  if (isAcknowledgement(input)) {
    return { reply: '👍 Koi aur kaam ho to batao.', traces: [] };
  }

  if (
    /^(?:what(?:'s| is)\s+pending|pending(?: tasks?)?|list (?:my )?tasks?|show (?:my )?tasks?|mere tasks?|kya pending hai|tasks? (?:batao|dikhao|dikha do))\s*[?.!]*$/i.test(
      input
    )
  ) {
    const tasks = await listLocalTasks(db, userId, execute);

    if (tasks.length === 0) {
      return { reply: 'Koi open task nahi hai. Naya task add karna ho to bas likho.', traces: [] };
    }

    const lines = tasks.map((task, index) => {
      const when = task.remindAt ?? task.dueAt;
      return `${index + 1}. ${task.title}${when ? ` · ${formatDue(when)}` : ''}  (#${task.id})`;
    });

    return {
      reply: `${tasks.length} open task${tasks.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
      traces: [],
    };
  }

  const completeMatch =
    input.match(/^(?:mark|complete|finish|done)\s+(?:task\s+)?#?(\d+)(?:\s+(?:as\s+)?done)?\s*[?.!]*$/i) ??
    input.match(/^#?(\d+)\s+(?:done|complete|completed)\s*[?.!]*$/i);

  if (completeMatch) {
    const requested = Number(completeMatch[1]);

    try {
      const openTasks = await listLocalTasks(db, userId, execute);
      const target =
        openTasks.find((task) => task.id === requested) ?? openTasks[requested - 1];

      if (!target) {
        return {
          reply: `Task #${requested} nahi mila. "What's pending?" se list dekh lo.`,
          traces: [],
        };
      }

      let completedTitle = target.title;
      if (execute) {
        const result = await execute('complete_task', { task_id: target.id });
        if (!result.success) {
          return {
            reply: result.error || `Task #${requested} complete nahi ho paya.`,
            traces: [],
          };
        }
        completedTitle = titleFromTool(result.content) || target.title;
      } else {
        const task = await completeTask(db, userId, target.id);
        completedTitle = task.title;
      }

      return {
        reply: `Ho gaya — “${completedTitle}” complete mark kar diya. ✅`,
        traces: [`Completed “${completedTitle}”`],
      };
    } catch {
      return {
        reply: `Task #${requested} nahi mila. "What's pending?" se list dekh lo.`,
        traces: [],
      };
    }
  }

  const createIntent = extractCreateText(input);

  if (createIntent) {
    return createFromText(db, userId, createIntent.text, createIntent.reminder, execute);
  }

  // Never auto-save arbitrary text as a task. Only explicit task or reminder
  // phrasing above creates something; otherwise explain the local commands.
  return {
    reply: `Main is message se apne aap task nahi banata. Task save karne ke liye "add task ..." ya "remind me ..." likho.\n\nNatural chat ke liye phone pe Ollama model chalao (Settings → AI), ya cloud key optional rakho.`,
    traces: [],
  };
}

async function createFromText(
  db: SQLiteDatabase,
  userId: number,
  raw: string,
  reminder: boolean,
  execute?: LocalToolExecutor
): Promise<LocalAgentResult> {
  const parsed = parseTaskText(raw);
  const title = parsed.title || raw.trim();

  if (!title) {
    return { reply: HELP_TEXT, traces: [] };
  }

  const when = parsed.dueAt;

  if (execute) {
    const result = await execute('create_task', {
      title,
      ...(reminder ? {} : when ? { due_at: new Date(when).toISOString() } : {}),
      ...(reminder ? (when ? { remind_at: new Date(when).toISOString() } : {}) : {}),
    });

    if (!result.success) {
      return { reply: result.error || 'Task save nahi ho paya.', traces: [] };
    }
  } else {
    await createTask(db, userId, {
      title,
      dueAt: reminder ? null : when,
      remindAt: reminder ? when : null,
    });
  }

  const scheduleNote = reminder && !when
    ? ''
    : '';
  const whenNote = when ? ` · ${formatDue(when)}` : '';
  const reply = reminder && !when
    ? `Task “${title}” save ho gaya. Reminder ke liye time bhi batao, jaise: "remind me to call mom at 7pm".`
    : `Done — “${title}”${whenNote}${scheduleNote}.`;

  return {
    reply,
    traces: [`Created “${title}”${whenNote}`],
  };
}
