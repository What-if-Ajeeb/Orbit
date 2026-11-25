/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AgentActionCard } from './AgentActionCard';
import * as actionService from '@/lib/agent-actions/service';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const mockPush = jest.fn();

jest.mock('@/lib/agent-actions/service', () => ({
  getAgentAction: jest.fn(),
  requestActionApproval: jest.fn(),
  approveAction: jest.fn(),
  executeAction: jest.fn(),
  cancelAction: jest.fn(),
  rejectAction: jest.fn(),
  editAction: jest.fn(),
}));

jest.mock('expo-router', () => {
  const ReactModule = require('react');

  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(callback, []);
    },
    useRouter: () => ({ push: mockPush, back: jest.fn() }),
  };
});

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
}));

jest.mock('@/context/auth', () => ({
  useSession: () => ({ user: { id: 7, name: 'Test User' } }),
}));

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');
  const Icon = () => ReactModule.createElement(require('react-native').View, null, null);

  return {
    __esModule: true,
    default: Object.assign(Icon, {
      glyphMap: new Proxy({}, { get: () => true }),
    }),
  };
});

jest.mock('@/context/theme', () => {
  const colors = {
    surface: '#111',
    surfaceAlt: '#222',
    border: '#333',
    text: '#fff',
    textMuted: '#aaa',
    textFaint: '#777',
    accent: '#f80',
    accentSoft: '#420',
    danger: '#f00',
    dangerSoft: '#400',
    success: '#0f0',
    successSoft: '#040',
    warning: '#fa0',
    warningSoft: '#440',
    inverse: '#fff',
    onInverse: '#000',
    blue: '#08f',
  };

  return {
    useAppTheme: () => ({ colors }),
    useStyles: (factory: (theme: { colors: typeof colors }) => unknown) => factory({ colors }),
  };
});

const BASE_ACTION = {
  id: 'action_email',
  userId: 7,
  conversationId: 42,
  agentId: 'agent-1',
  agentName: 'Test Agent',
  kind: 'email',
  toolName: 'google_gmail_send',
  status: 'draft' as const,
  title: 'Send email to person@example.com',
  target: 'person@example.com',
  lines: ['Subject: Status update', 'Body: 20 characters'],
  payload: {
    to: 'person@example.com',
    subject: 'Status update',
    body: 'The build is complete.',
  },
  toolArgs: {
    to: 'person@example.com',
    subject: 'Status update',
    body: 'The build is complete.',
  },
  fingerprint: 'fp-1',
  permissionRequestId: null,
  risk: 'high' as const,
  category: 'external_api' as const,
  approvalFingerprint: null,
  approvedAt: null,
  result: null,
  error: null,
  trace: null,
  createdAt: 1,
  updatedAt: 1,
};

describe('AgentActionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    actionService.getAgentAction.mockResolvedValue(BASE_ACTION);
  });

  it('shows the exact target and payload before any approval', async () => {
    const view = await render(<AgentActionCard actionId="action_email" />);

    await waitFor(() => expect(actionService.getAgentAction).toHaveBeenCalled());
    expect(view.getByText('person@example.com')).toBeTruthy();
    expect(view.getByText('Subject: Status update')).toBeTruthy();
    expect(view.getByLabelText('Request approval for this exact action')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByLabelText('Expand action details'));
    });
    expect(view.getByText(/The build is complete/)).toBeTruthy();
    expect(view.getByText('Exact payload')).toBeTruthy();
  });

  it('requests approval only after an explicit tap', async () => {
    const view = await render(<AgentActionCard actionId="action_email" />);

    await waitFor(() => expect(actionService.getAgentAction).toHaveBeenCalled());
    await act(async () => {
      fireEvent.press(view.getByLabelText('Request approval for this exact action'));
    });

    await waitFor(() =>
      expect(actionService.requestActionApproval).toHaveBeenCalledWith({}, 'action_email', 7)
    );
  });

  it('requires a second explicit tap to execute an approved action', async () => {
    actionService.getAgentAction.mockResolvedValue({
      ...BASE_ACTION,
      status: 'approved',
      approvalFingerprint: 'fp-1',
      approvedAt: 2,
    });
    const view = await render(<AgentActionCard actionId="action_email" />);

    await waitFor(() => expect(actionService.getAgentAction).toHaveBeenCalled());
    expect(view.getByText('Approved — not executed')).toBeTruthy();
    expect(view.getByLabelText('Execute the approved action')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByLabelText('Execute the approved action'));
    });

    await waitFor(() => expect(actionService.executeAction).toHaveBeenCalledWith({}, 'action_email', 7));
  });

  it('opens the payload editor and routes to full details', async () => {
    const view = await render(<AgentActionCard actionId="action_email" />);

    await waitFor(() => expect(actionService.getAgentAction).toHaveBeenCalled());
    await act(async () => {
      fireEvent.press(view.getByLabelText('Expand action details'));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('Edit payload'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Open full action details'));
    });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/agent-action', params: { id: 'action_email' } });
  });
});
