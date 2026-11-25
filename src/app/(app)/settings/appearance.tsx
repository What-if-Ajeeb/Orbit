import { Check, Moon, Smartphone, Sun, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { useAppTheme, useStyles, type AppTheme, type ThemeMode } from '@/context/theme';

type ThemeOption = {
  id: ThemeMode;
  title: string;
  description: string;
  icon: LucideIcon;
};

const OPTIONS: ThemeOption[] = [
  {
    id: 'light',
    title: 'Light',
    description: 'Warm ivory surfaces with dark text.',
    icon: Sun,
  },
  {
    id: 'dark',
    title: 'Dark',
    description: 'Near-black surfaces with warm text.',
    icon: Moon,
  },
  {
    id: 'system',
    title: 'System',
    description: 'Follow the device appearance setting.',
    icon: Smartphone,
  },
];

export default function AppearanceSettingsScreen() {
  const { colors, mode, resolvedMode, setMode } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <SettingsScreen
      title="Appearance"
      subtitle="Choose how ORBIT looks on this device. The change applies immediately."
    >
      <SettingsGroup
        title="Theme"
        footer={`Currently showing the ${resolvedMode} theme${
          mode === 'system' ? ', following your device setting' : ''
        }.`}
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = mode === option.id;

          return (
            <SettingsRow
              key={option.id}
              icon={Icon}
              title={option.title}
              description={option.description}
              showChevron={false}
              onPress={() => setMode(option.id)}
              right={
                selected ? (
                  <View style={styles.check}>
                    <Check size={16} color={colors.accent} strokeWidth={2.6} />
                  </View>
                ) : undefined
              }
            />
          );
        })}
      </SettingsGroup>
    </SettingsScreen>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
  });
