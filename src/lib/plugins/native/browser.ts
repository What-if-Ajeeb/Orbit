import * as Linking from 'expo-linking';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeHostTool,
  nativeOutputSchema,
  objectSchema,
  readString,
} from './helpers';

export const BROWSER_PLUGIN_ID = 'orbit.builtin.browser';

const MAX_URL_LENGTH = 2_048;
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;

export const browserManifest: PluginManifest = seedPluginManifest({
  pluginId: BROWSER_PLUGIN_ID,
  name: 'ORBIT Browser',
  version: '1.0.0',
  description:
    'Hands approved http(s) and mailto links to the operating system. It does not fetch pages, simulate browsing, or expose an arbitrary-URL WebView.',
  category: 'integration',
  icon: 'open-in-new-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-browser' },
  permissions: ['ai.invoke', 'network.access'],
  capabilities: ['tools.ai'],
  dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const OUTPUT_SCHEMA = nativeOutputSchema({
  url: { type: 'string' },
  scheme: { type: 'string' },
  opened: { type: 'boolean' },
});

function normalizeExternalUrl(raw: string): { url: string; scheme: string } {
  if (raw.length > MAX_URL_LENGTH) {
    throw new Error(`URL must be at most ${MAX_URL_LENGTH} characters.`);
  }

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL must be absolute and well formed.');
  }

  if (!(ALLOWED_PROTOCOLS as readonly string[]).includes(parsed.protocol)) {
    throw new Error('Only http, https and mailto links can be opened.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed.');
  }

  if (parsed.protocol !== 'mailto:' && parsed.hostname.length === 0) {
    throw new Error('URL must include a host.');
  }

  return {
    url: parsed.toString(),
    scheme: parsed.protocol.replace(':', ''),
  };
}

const openLinkTool = nativeHostTool('browser_open_link', {
  name: 'browser_open_link',
  description:
    'Ask the user to confirm, then hand a safe http(s) or mailto link to the operating system. This does not read or render the page.',
  parameters: objectSchema(
    {
      url: { type: 'string', minLength: 1, maxLength: MAX_URL_LENGTH },
    },
    ['url']
  ),
  outputSchema: OUTPUT_SCHEMA,
  permissions: ['network.access'],
  requiresApproval: true,
  async execute(args) {
    const raw = readString(args, 'url', { required: true })!;
    const { url, scheme } = normalizeExternalUrl(raw);

    if (typeof Linking.openURL !== 'function') {
      throw new Error('External link handoff is unavailable in this runtime.');
    }

    await Linking.openURL(url);
    return { url, scheme, opened: true };
  },
});

export const browserImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.browser] browser plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.browser] browser plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.browser] browser plugin reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(openLinkTool);
  },
};
