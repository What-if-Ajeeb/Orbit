import {
  canEvolveTo,
  getEvolutionBranches,
  getForm,
  getInventory,
  getUserBuddy,
  listBuddyActivities,
  listUserBuddies,
  setActiveBuddy,
  tryEvolve,
  type UserBuddy,
} from '@/lib/buddy';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeOutputSchema,
  nativeTool,
  objectSchema,
  readNumber,
  readString,
} from './helpers';

export const BUDDY_PLUGIN_ID = 'orbit.builtin.buddy';

export const buddyManifest: PluginManifest = seedPluginManifest({
  pluginId: BUDDY_PLUGIN_ID,
  name: 'ORBIT Buddy',
  version: '1.0.0',
  description:
    'Reads buddy state and evolution options and performs approved activation or evolution through the existing buddy store. Reward policy remains owned by the app.',
  category: 'ai',
  icon: 'paw-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-buddy' },
  permissions: ['ai.invoke', 'storage.read', 'storage.write'],
  capabilities: ['tools.ai', 'storage.namespaced'],
  dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const BUDDY_FIELDS = {
  id: { type: 'string' },
  speciesId: { type: 'string' },
  nickname: { type: ['string', 'null'] },
  currentFormId: { type: 'string' },
  level: { type: 'integer' },
  xp: { type: 'integer' },
  bond: { type: 'integer' },
  isActive: { type: 'boolean' },
  mood: { type: 'string' },
  unlockedForms: { type: 'array', items: { type: 'string' } },
} as const;

const LIST_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  buddies: {
    type: 'array',
    items: {
      type: 'object',
      properties: BUDDY_FIELDS,
      required: [
        'id',
        'speciesId',
        'nickname',
        'currentFormId',
        'level',
        'xp',
        'bond',
        'isActive',
        'mood',
        'unlockedForms',
      ],
      additionalProperties: false,
    },
  },
});

const ACTIVITY_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  activities: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        activity: { type: 'string' },
        xpGained: { type: 'integer' },
        bondGained: { type: 'integer' },
        createdAt: { type: 'integer' },
      },
      required: ['id', 'activity', 'xpGained', 'bondGained', 'createdAt'],
      additionalProperties: false,
    },
  },
});

const INVENTORY_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  items: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        quantity: { type: 'integer' },
      },
      required: ['itemId', 'quantity'],
      additionalProperties: false,
    },
  },
});

const EVOLUTION_OUTPUT_SCHEMA = nativeOutputSchema({
  buddyId: { type: 'string' },
  currentFormId: { type: 'string' },
  total: { type: 'integer' },
  options: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        stage: { type: 'integer' },
        allowed: { type: 'boolean' },
        missing: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'name', 'stage', 'allowed', 'missing'],
      additionalProperties: false,
    },
  },
});

const EVOLVE_OUTPUT_SCHEMA = nativeOutputSchema({
  evolved: { type: 'boolean' },
  reason: { type: 'string' },
  fromFormId: { type: 'string' },
  toFormId: { type: 'string' },
  buddy: {
    type: 'object',
    properties: BUDDY_FIELDS,
    required: [
      'id',
      'speciesId',
      'nickname',
      'currentFormId',
      'level',
      'xp',
      'bond',
      'isActive',
      'mood',
      'unlockedForms',
    ],
    additionalProperties: false,
  },
});

function mapBuddy(buddy: UserBuddy): Record<string, unknown> {
  return {
    id: buddy.id,
    speciesId: buddy.speciesId,
    nickname: buddy.nickname,
    currentFormId: buddy.currentFormId,
    level: buddy.level,
    xp: buddy.xp,
    bond: buddy.bond,
    isActive: buddy.isActive,
    mood: buddy.mood,
    unlockedForms: [...buddy.unlockedForms],
  };
}

async function requireBuddy(
  db: Parameters<typeof getUserBuddy>[0],
  userId: number,
  buddyId: string
): Promise<UserBuddy> {
  const buddy = await getUserBuddy(db, userId, buddyId);

  if (!buddy) {
    throw new Error('Buddy not found for this user.');
  }

  return buddy;
}

const listBuddiesTool = nativeTool('buddy_list', {
  name: 'buddy_list',
  description: 'List the current user’s buddies and their level, bond and mood.',
  parameters: objectSchema({}, []),
  outputSchema: LIST_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(_args, context) {
    const buddies = await listUserBuddies(context.db, context.userId);
    return { total: buddies.length, buddies: buddies.map(mapBuddy) };
  },
});

const activitiesTool = nativeTool('buddy_activities', {
  name: 'buddy_activities',
  description: 'List recent activity log entries for one of the user’s buddies.',
  parameters: objectSchema(
    {
      buddyId: { type: 'string', minLength: 1, maxLength: 80 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    ['buddyId']
  ),
  outputSchema: ACTIVITY_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(args, context) {
    const buddyId = readString(args, 'buddyId', {
      required: true,
      maxLength: 80,
    })!;
    const limit = readNumber(args, 'limit', { min: 1, max: 50 }) ?? 20;
    await requireBuddy(context.db, context.userId, buddyId);
    const activities = await listBuddyActivities(
      context.db,
      context.userId,
      buddyId,
      limit
    );

    return {
      total: activities.length,
      activities: activities.map((entry) => ({
        id: entry.id,
        activity: entry.activity,
        xpGained: entry.xpGained,
        bondGained: entry.bondGained,
        createdAt: entry.createdAt,
      })),
    };
  },
});

const inventoryTool = nativeTool('buddy_inventory', {
  name: 'buddy_inventory',
  description: 'List the current user’s buddy evolution items.',
  parameters: objectSchema({}, []),
  outputSchema: INVENTORY_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(_args, context) {
    const items = await getInventory(context.db, context.userId);
    return { total: items.length, items };
  },
});

const evolutionOptionsTool = nativeTool('buddy_evolution_options', {
  name: 'buddy_evolution_options',
  description:
    'List evolution branches for a buddy using the existing species and inventory rules. Read-only.',
  parameters: objectSchema(
    { buddyId: { type: 'string', minLength: 1, maxLength: 80 } },
    ['buddyId']
  ),
  outputSchema: EVOLUTION_OUTPUT_SCHEMA,
  permissions: ['storage.read'],
  async execute(args, context) {
    const buddyId = readString(args, 'buddyId', {
      required: true,
      maxLength: 80,
    })!;
    const buddy = await requireBuddy(context.db, context.userId, buddyId);
    const inventory = await getInventory(context.db, context.userId);
    const branches = getEvolutionBranches(buddy.currentFormId);
    const options = branches.map((form) => {
      const check = canEvolveTo(buddy, form, inventory);
      return {
        id: form.id,
        name: form.name,
        stage: form.stage,
        allowed: check.ok,
        missing: [...check.missing],
      };
    });

    return {
      buddyId: buddy.id,
      currentFormId: buddy.currentFormId,
      total: options.length,
      options,
    };
  },
});

const setActiveTool = nativeTool('buddy_set_active', {
  name: 'buddy_set_active',
  description: 'Set one of the user’s buddies as active. Requires explicit approval.',
  parameters: objectSchema(
    { buddyId: { type: 'string', minLength: 1, maxLength: 80 } },
    ['buddyId']
  ),
  outputSchema: nativeOutputSchema({ buddy: { type: 'object' } }),
  permissions: ['storage.write'],
  requiresApproval: true,
  async execute(args, context) {
    const buddyId = readString(args, 'buddyId', {
      required: true,
      maxLength: 80,
    })!;
    await requireBuddy(context.db, context.userId, buddyId);
    await setActiveBuddy(context.db, context.userId, buddyId);
    return { buddy: mapBuddy(await requireBuddy(context.db, context.userId, buddyId)) };
  },
});

const evolveTool = nativeTool('buddy_evolve', {
  name: 'buddy_evolve',
  description:
    'Evolve a buddy through the existing evolution rules, consuming the required items. Requires explicit approval.',
  parameters: objectSchema(
    {
      buddyId: { type: 'string', minLength: 1, maxLength: 80 },
      targetFormId: { type: 'string', minLength: 1, maxLength: 80 },
    },
    ['buddyId', 'targetFormId']
  ),
  outputSchema: EVOLVE_OUTPUT_SCHEMA,
  permissions: ['storage.write'],
  requiresApproval: true,
  async execute(args, context) {
    const buddyId = readString(args, 'buddyId', {
      required: true,
      maxLength: 80,
    })!;
    const targetFormId = readString(args, 'targetFormId', {
      required: true,
      maxLength: 80,
    })!;
    await requireBuddy(context.db, context.userId, buddyId);
    const result = await tryEvolve(context.db, context.userId, buddyId, targetFormId);

    if (!result.ok) {
      throw new Error(result.error);
    }

    if (!result.evolved) {
      return { evolved: false, reason: result.reason };
    }

    return {
      evolved: true,
      fromFormId: result.from.id,
      toFormId: result.to.id,
      buddy: mapBuddy(result.buddy),
    };
  },
});

const BUDDY_TOOLS = [
  listBuddiesTool,
  activitiesTool,
  inventoryTool,
  evolutionOptionsTool,
  setActiveTool,
  evolveTool,
];

export const buddyImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.buddy] buddy plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.buddy] buddy plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.buddy] buddy plugin reported an error');
    },
  },
  activate(sdk) {
    for (const tool of BUDDY_TOOLS) {
      void sdk.tools.register(tool);
    }

    sdk.logger.info(
      `Loaded ${getForm('spark')?.name ?? 'ORBIT'} buddy capabilities.`
    );
  },
};
