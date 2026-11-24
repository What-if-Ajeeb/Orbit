import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginApprovalService } from '../approvals';

describe('plugin approval queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows one request at a time and resolves each decision independently', async () => {
    const service = new PluginApprovalService();
    const notify = vi.fn();
    service.subscribe(notify);

    const first = service.requestPermissions(
      {
        pluginId: 'test.plugin',
        pluginName: 'Test Plugin',
        trustLevel: 'local',
        permissions: ['network.access'],
        reason: 'Need network',
      },
      1_000
    );
    const second = service.requestTool(
      {
        pluginId: 'test.plugin',
        pluginName: 'Test Plugin',
        trustLevel: 'local',
        toolName: 'search',
        permissions: ['ai.invoke'],
        reason: 'Run search',
      },
      1_000
    );

    expect(service.getPending()).toMatchObject({
      id: 1,
      kind: 'permissions',
      pluginId: 'test.plugin',
      reason: 'Need network',
      createdAt: Date.now(),
      expiresAt: Date.now() + 1_000,
    });
    expect(service.getQueuedCount()).toBe(1);

    service.approve(1);
    await expect(first).resolves.toBe(true);
    expect(service.getPending()).toMatchObject({ id: 2, kind: 'tool', toolName: 'search' });

    service.deny(2);
    await expect(second).resolves.toBe(false);

    expect(service.getPending()).toBeNull();
    expect(service.getQueuedCount()).toBe(0);
    expect(notify).toHaveBeenCalledTimes(4);
  });

  it('defaults to denial when a request times out', async () => {
    const service = new PluginApprovalService();
    const result = service.requestTool(
      {
        pluginId: 'test.plugin',
        pluginName: 'Test Plugin',
        trustLevel: 'community',
        toolName: 'dangerous',
        permissions: ['camera.access'],
        reason: 'Take a photo',
      },
      250
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(service.getPending()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(service.getPending()).toBeNull();
  });

  it('denies pending and queued requests when the host unmounts', async () => {
    const service = new PluginApprovalService();
    const first = service.requestPermissions(
      {
        pluginId: 'test.plugin',
        pluginName: 'Test Plugin',
        trustLevel: 'local',
        permissions: ['storage.read'],
        reason: 'Read settings',
      },
      1_000
    );
    const second = service.requestPermissions(
      {
        pluginId: 'other.plugin',
        pluginName: 'Other Plugin',
        trustLevel: 'local',
        permissions: ['storage.write'],
        reason: 'Write settings',
      },
      1_000
    );

    service.denyAll();

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(service.getPending()).toBeNull();
    expect(service.getQueuedCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getPending()).toBeNull();
  });

  it('reports the request id and denies when the caller aborts', async () => {
    const service = new PluginApprovalService();
    const controller = new AbortController();
    const onRequest = vi.fn();
    const result = service.requestInstall(
      {
        pluginId: 'test.plugin',
        pluginName: 'Test Plugin',
        pluginVersion: '1.0.0',
        trustLevel: 'verified',
        capability: 'agent_github',
        capabilityLabel: 'GitHub and repository work',
        reason: 'Review a pull request',
        permissions: [],
        sensitivePermissions: [],
        dependencies: [],
        requiresSandbox: false,
        requiresUpdate: false,
        steps: ['Install Test Plugin 1.0.0.'],
      },
      { signal: controller.signal, onRequest }
    );

    expect(onRequest).toHaveBeenCalledWith(1);
    expect(service.getPending()?.id).toBe(1);
    controller.abort();
    await expect(result).resolves.toBe(false);
    expect(service.getPending()).toBeNull();
  });

  it('does not let a broken listener block the queue', async () => {
    const service = new PluginApprovalService();
    const healthy = vi.fn();
    service.subscribe(() => {
      throw new Error('broken listener');
    });
    service.subscribe(healthy);

    const result = service.requestPermissions(
      {
        pluginId: 'test.plugin',
        pluginName: 'Test Plugin',
        trustLevel: 'local',
        permissions: [],
        reason: 'No permissions needed',
      },
      1_000
    );

    expect(service.getPending()?.id).toBe(1);
    service.approve(1);
    await expect(result).resolves.toBe(true);
    expect(healthy).toHaveBeenCalledTimes(2);
  });
});
