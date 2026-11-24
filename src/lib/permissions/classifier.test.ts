import { describe, expect, it } from 'vitest';

import { classifyToolAction } from './classifier';
import type { AgentIdentity } from './types';

const AGENT: AgentIdentity = {
  id: 'research',
  name: 'Research Agent',
  role: 'specialist',
  description: 'Reads connected sources.',
  icon: 'search',
};

function classify(toolName: string) {
  return classifyToolAction({
    toolName,
    args: { query: 'release notes' },
    agent: AGENT,
    projectId: 'project-1',
    projectLabel: 'Orbit',
  });
}

describe('Google permission classification', () => {
  it('requires explicit approval for content reads', () => {
    const action = classify('google_gmail_read');

    expect(action.risk).toBe('medium');
    expect(action.autoApprove).toBe(false);
    expect(action.metadata).toMatchObject({ connection: 'google', sensitive: true });
  });

  it('requires explicit approval for writes', () => {
    const action = classify('google_drive_trash');

    expect(action.risk).toBe('high');
    expect(action.autoApprove).toBe(false);
  });
});
