import type { PermissionCategory, RiskLevel } from './types';

export type CategoryMeta = {
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  defaultRisk: RiskLevel;
  sensitive: boolean;
};

export const CATEGORY_META: Record<PermissionCategory, CategoryMeta> = {
  computer_access: {
    label: 'Computer access',
    shortLabel: 'Computer',
    icon: 'desktop-outline',
    description: 'Run work on a computer paired with this phone through ORBIT Desktop Companion.',
    defaultRisk: 'high',
    sensitive: true,
  },
  terminal_commands: {
    label: 'Terminal & command execution',
    shortLabel: 'Terminal',
    icon: 'terminal-outline',
    description: 'Execute a shell command or script.',
    defaultRisk: 'high',
    sensitive: true,
  },
  file_read: {
    label: 'File read access',
    shortLabel: 'Read files',
    icon: 'folder-open-outline',
    description: 'Read files from an approved project or folder.',
    defaultRisk: 'low',
    sensitive: false,
  },
  file_write: {
    label: 'File write access',
    shortLabel: 'Write files',
    icon: 'document-text-outline',
    description: 'Create or modify files in an approved project or folder.',
    defaultRisk: 'medium',
    sensitive: false,
  },
  file_delete: {
    label: 'File deletion',
    shortLabel: 'Delete files',
    icon: 'trash-outline',
    description: 'Permanently remove files or folders.',
    defaultRisk: 'high',
    sensitive: true,
  },
  browser_automation: {
    label: 'Browser automation',
    shortLabel: 'Browser',
    icon: 'browsers-outline',
    description: 'Control a browser, click, fill forms, or navigate pages.',
    defaultRisk: 'medium',
    sensitive: false,
  },
  website_access: {
    label: 'Website access',
    shortLabel: 'Websites',
    icon: 'globe-outline',
    description: 'Open, read, or search approved websites.',
    defaultRisk: 'low',
    sensitive: false,
  },
  app_installation: {
    label: 'App installation',
    shortLabel: 'Install apps',
    icon: 'cloud-download-outline',
    description: 'Install software, packages, or dependencies.',
    defaultRisk: 'high',
    sensitive: true,
  },
  camera_microphone: {
    label: 'Camera & microphone',
    shortLabel: 'Camera / mic',
    icon: 'camera-outline',
    description: 'Use the Android camera or microphone.',
    defaultRisk: 'high',
    sensitive: true,
  },
  location: {
    label: 'Location access',
    shortLabel: 'Location',
    icon: 'location-outline',
    description: 'Read this device’s approximate or precise location.',
    defaultRisk: 'high',
    sensitive: true,
  },
  contacts: {
    label: 'Contacts access',
    shortLabel: 'Contacts',
    icon: 'people-outline',
    description: 'Read contact names, phone numbers, or addresses.',
    defaultRisk: 'high',
    sensitive: true,
  },
  external_api: {
    label: 'External API access',
    shortLabel: 'External API',
    icon: 'cloud-outline',
    description: 'Send data to, or receive data from, an external service.',
    defaultRisk: 'medium',
    sensitive: false,
  },
  database_operations: {
    label: 'Database operations',
    shortLabel: 'Database',
    icon: 'server-outline',
    description: 'Read, create, modify, or delete records in a database.',
    defaultRisk: 'medium',
    sensitive: false,
  },
  network_access: {
    label: 'Network access',
    shortLabel: 'Network',
    icon: 'wifi-outline',
    description: 'Make outbound network requests.',
    defaultRisk: 'low',
    sensitive: false,
  },
  background_automation: {
    label: 'Background automation',
    shortLabel: 'Automation',
    icon: 'time-outline',
    description: 'Run an automation in the background or on a schedule.',
    defaultRisk: 'medium',
    sensitive: false,
  },
};

export type RiskMeta = {
  label: string;
  shortLabel: string;
  description: string;
  colorToken: 'success' | 'warning' | 'danger';
  softToken: 'successSoft' | 'warningSoft' | 'dangerSoft';
};

export const RISK_META: Record<RiskLevel, RiskMeta> = {
  low: {
    label: 'Low risk',
    shortLabel: 'LOW',
    description: 'Read-only or limited action with little chance of damage.',
    colorToken: 'success',
    softToken: 'successSoft',
  },
  medium: {
    label: 'Medium risk',
    shortLabel: 'MEDIUM',
    description: 'Can change files or run sandboxed work. Review the action before allowing.',
    colorToken: 'warning',
    softToken: 'warningSoft',
  },
  high: {
    label: 'High risk',
    shortLabel: 'HIGH',
    description:
      'Destructive or unrestricted action. Approval is required every single time.',
    colorToken: 'danger',
    softToken: 'dangerSoft',
  },
};

export function categoryLabel(category: PermissionCategory): string {
  return CATEGORY_META[category]?.label ?? category;
}
