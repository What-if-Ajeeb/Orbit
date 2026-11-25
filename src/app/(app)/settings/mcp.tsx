import { useState } from 'react';

import { McpServersCard } from '@/components/McpServersCard';
import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

export default function McpSettingsScreen() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsScreen
      title="MCP Servers"
      subtitle="Connect external tool servers. Their output is treated as untrusted data and is limited by your agent permissions."
    >
      <SettingsFeedback
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
      />
      <McpServersCard onNotice={setNotice} onError={setError} />
    </SettingsScreen>
  );
}
