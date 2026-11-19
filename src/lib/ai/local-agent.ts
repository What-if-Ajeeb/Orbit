import type { SQLiteDatabase } from 'expo-sqlite';

import { formatDue, parseTaskText } from '../dates';
import { completeTask, createTask, listTasks } from '../tasks';

export type LocalAgentResult = {
  reply: string;
  traces: string[];
};

const HELP_TEXT = `Abhi AI key set nahi hai, isliye main local mode me hoon.

Ye commands chalte hain:
• "Add task pay electricity bill tomorrow 5pm"
• "Remind me to call mom at 7pm"
• "What's pending?"
• "Complete 3"

AI chat ke liye Settings → AI me apni API key daalo.`;

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

function looksLikeQuestion(text: string): boolean {
  return (
    /[?]$/.test(text) ||
    /^(?:what|why|how|who|when|where|which|kya|kaise|kyu|kab|kaun)\b/i.test(text)
  );
}

function isGreeting(text: string): boolean {
  return /^(?:hi|hello|hey|namaste|namaskar|hola|yo)\b[!. ]*$/i.test(text.trim());
}

function isAcknowledgement(text: string): boolean {
  return /^(?:thanks|thank you|ok|okay|cool|great|nice|perfect|sounds good|haan|theek hai|shukriya|dhanyavad)[!. ]*$/i.test(
    text.trim()
  );
}

function looksLikeTask(text: string): boolean {
  if (looksLikeQuestion(text) || text.length < 2 || text.length > 120) {
    return false;
  }

  if (text.split(/\s+/).length > 8) {
    return false;
  }

  return !/^(?:tell|explain|write|suggest|can you|could you|help me|please tell)\b/i.test(text);
}

export async function runLocalAgent(
  db: SQLiteDatabase,
  userId: number,
  text: string
): Promise<LocalAgentResult> {
  const input = text.trim();

  if (!input) {
    return { reply: HELP_TEXT, traces: [] };
  }

  if (isGreeting(input)) {
    return {
      reply: `Namaste! Main Orbit hoon. Local mode me tasks aur reminders manage kar sakta hoon.\n\n${HELP_TEXT}`,
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
    const tasks = await listTasks(db, userId, { status: 'open', limit: 20 });

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
      const openTasks = await listTasks(db, userId, { status: 'open', limit: 50 });
      const target =
        openTasks.find((task) => task.id === requested) ?? openTasks[requested - 1];

      if (!target) {
        return {
          reply: `Task #${requested} nahi mila. "What's pending?" se list dekh lo.`,
          traces: [],
        };
      }

      const task = await completeTask(db, userId, target.id);
      return {
        reply: `Ho gaya — “${task.title}” complete mark kar diya. ✅`,
        traces: [`Completed “${task.title}”`],
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
    return createFromText(db, userId, createIntent.text, createIntent.reminder);
  }

  if (looksLikeTask(input)) {
    // In local mode a short free-form line is most useful as a task.
    return createFromText(db, userId, input, false);
  }

  return { reply: HELP_TEXT, traces: [] };
}

async function createFromText(
  db: SQLiteDatabase,
  userId: number,
  raw: string,
  reminder: boolean
): Promise<LocalAgentResult> {
  const parsed = parseTaskText(raw);
  const title = parsed.title || raw.trim();

  if (!title) {
    return { reply: HELP_TEXT, traces: [] };
  }

  const when = parsed.dueAt;
  const task = await createTask(db, userId, {
    title,
    dueAt: reminder ? null : when,
    remindAt: reminder ? when : null,
  });

  const scheduledAt = task.remindAt ?? task.dueAt;
  const scheduleNote =
    scheduledAt && !task.notificationId
      ? ' (notifications off — Settings me allow karo)'
      : '';
  const whenNote = scheduledAt ? ` · ${formatDue(scheduledAt)}` : '';

  const reply = reminder && !when
    ? `Task “${task.title}” save ho gaya. Reminder ke liye time bhi batao, jaise: "remind me to call mom at 7pm".`
    : `Done — “${task.title}”${whenNote}${scheduleNote}.`;

  return {
    reply,
    traces: [`Created “${task.title}”${whenNote}`],
  };
}
