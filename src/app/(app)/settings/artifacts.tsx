import { useFocusEffect } from 'expo-router';
import { Database } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';

import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { useAppTheme } from '@/context/theme';
import { loadAiSettings, setArtifactCdnjsAllowed } from '@/lib/ai/settings';

/** Artifact preview options. Network access stays blocked unless explicitly enabled here. */
export default function ArtifactSettingsScreen() {
  const { colors } = useAppTheme();
  const [cdnjsAllowed, setCdnjsAllowed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void loadAiSettings()
        .then((settings) => {
          if (active) {
            setCdnjsAllowed(settings.artifactCdnjsAllowed === true);
          }
        })
        .catch(() => {
          if (active) {
            setError('Could not load artifact settings. The safe default is off.');
          }
        });

      return () => {
        active = false;
      };
    }, [])
  );

  const toggleCdnjs = useCallback(() => {
    if (saving) {
      return;
    }

    const next = !cdnjsAllowed;
    setCdnjsAllowed(next);
    setSaving(true);
    setError(null);
    setNotice(null);

    void (async () => {
      try {
        await setArtifactCdnjsAllowed(next);
        setNotice(
          next
            ? 'cdnjs.cloudflare.com scripts are now allowed in HTML artifact previews.'
            : 'External scripts are blocked again in artifact previews.'
        );
      } catch {
        setCdnjsAllowed(!next);
        setError('Could not save this setting. Please try again.');
      } finally {
        setSaving(false);
      }
    })();
  }, [cdnjsAllowed, saving]);

  return (
    <SettingsScreen
      title="Artifacts"
      subtitle="Choose how HTML artifact previews behave on this device."
    >
      <SettingsFeedback
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
      />

      <SettingsGroup title="Interactive state" footer="Artifact state is stored on this device, scoped to your account and the artifact. It does not use localStorage and is deleted with the artifact.">
        <SettingsRow
          icon={Database}
          title="Persistent storage"
          description="HTML artifacts can call window.orbit.storage.get, set, delete and list so state survives a preview reload."
          showChevron={false}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Preview security"
        footer="Only this exact host is added to script-src. Fetch, API calls and every other network destination stay blocked. Off by default."
      >
        <SettingsRow
          icon={Database}
          title="Allow libraries from cdnjs.cloudflare.com"
          description="Lets HTML artifacts load <script src> from this one host. Leave off for dependency-free vanilla JS, SVG and canvas."
          value={cdnjsAllowed ? 'On' : 'Off'}
          role="switch"
          checked={cdnjsAllowed}
          disabled={saving}
          showChevron={false}
          onPress={toggleCdnjs}
          right={
            <View pointerEvents="none">
              <Switch
                value={cdnjsAllowed}
                trackColor={{ false: colors.surfaceAlt, true: colors.accentSoft }}
                thumbColor={cdnjsAllowed ? colors.accent : colors.textFaint}
                ios_backgroundColor={colors.surfaceAlt}
                accessibilityLabel="Allow libraries from cdnjs.cloudflare.com"
              />
            </View>
          }
        />
      </SettingsGroup>
    </SettingsScreen>
  );
}
