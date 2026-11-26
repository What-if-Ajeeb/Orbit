import type { SQLiteDatabase } from 'expo-sqlite';

import { loadAiSettings, saveAiSettings, type AiSettings } from './ai/settings';
import { loadAgentConfig, saveAgentConfig } from './agent-settings';
import {
  getDefaultSkill,
  SkillStore,
  WEB_SEARCH_SKILL_ID,
  WEB_SEARCH_TOOL_NAME,
} from './skills';

/**
 * Chat-facing preference write. Web Search is a built-in skill plus one agent
 * tool pattern, so the toggle reuses those stores instead of adding a second
 * capability system.
 */
export async function setWebSearchPreference(
  db: SQLiteDatabase,
  userId: number,
  agentId: string,
  enabled: boolean
): Promise<AiSettings> {
  const settings = await loadAiSettings();
  const saved = await saveAiSettings({ ...settings, webSearch: enabled });

  const skill = getDefaultSkill(WEB_SEARCH_SKILL_ID);
  if (!skill) {
    throw new Error('Web Search is not available on this device.');
  }

  const skills = new SkillStore(db);
  await skills.ensureSkill(skill);
  await skills.setSkillEnabled(skill.id, enabled);

  const config = await loadAgentConfig(db, userId, agentId);
  const allowedTools = config.allowedTools.filter((name) => name !== WEB_SEARCH_TOOL_NAME);

  if (enabled) {
    allowedTools.push(WEB_SEARCH_TOOL_NAME);
  }

  await saveAgentConfig(db, userId, agentId, { allowedTools });
  return saved;
}
