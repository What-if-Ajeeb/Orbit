import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { TextField } from '@/components/TextField';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { pairCompanion, type PairedDeviceRecord } from '@/lib/permissions';
import { radius, spacing } from '@/theme';

type CompanionPairingModalProps = {
  visible: boolean;
  userId: number;
  onClose: () => void;
  onPaired: (device: PairedDeviceRecord) => void;
};

export function CompanionPairingModal({
  visible,
  userId,
  onClose,
  onPaired,
}: CompanionPairingModalProps) {
  const { colors, glass } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const progress = useState(() => new Animated.Value(0))[0];
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }

    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 230,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  async function pair() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const device = await pairCompanion({
        db,
        userId,
        name,
        endpoint,
        code,
      });

      setName('');
      setEndpoint('');
      setCode('');
      onPaired(device);
    } catch (pairError) {
      setError(
        pairError instanceof Error
          ? pairError.message
          : 'The computer could not be paired. Check the code and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (!busy) {
      setError(null);
      onClose();
    }
  }

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [320, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}
        >
          <BlurView
            intensity={34}
            tint={glass.tint}
            blurMethod={glass.blurMethod}
            blurReductionFactor={glass.blurReductionFactor}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close pairing"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <Animated.View
            style={[
              styles.sheet,
              {
                marginBottom: insets.bottom,
                opacity: progress,
                transform: [{ translateY }],
              },
            ]}
          >
            <BlurView
              intensity={90}
              tint={glass.tint}
              blurMethod={glass.blurMethod}
              blurReductionFactor={glass.blurReductionFactor}
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.glow} />
            <View pointerEvents="none" style={styles.highlight} />

            <View style={styles.handle} />

            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons name="desktop-outline" size={20} color={colors.accent} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Pair a computer</Text>
                <Text style={styles.subtitle}>
                  Connect ORBIT Desktop Companion over an authenticated, encrypted channel.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close pairing"
                disabled={busy}
                hitSlop={10}
                onPress={close}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.form}
            >
              <View style={styles.securityNote}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.success} />
                <Text style={styles.securityText}>
                  Pairing exchanges a short-lived code for a device session token. The token is
                  stored only in SecureStore and is never shown in chat or audit history.
                </Text>
              </View>

              {error ? <FormError message={error} /> : null}

              <TextField
                label="Computer name"
                value={name}
                onChangeText={setName}
                placeholder="Studio Mac"
                autoCapitalize="words"
                autoCorrect={false}
                editable={!busy}
              />

              <TextField
                label="Companion URL"
                value={endpoint}
                onChangeText={setEndpoint}
                placeholder="https://studio.local:8787"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!busy}
                hint="HTTPS is required. Loopback HTTP is allowed only for local development."
              />

              <TextField
                label="Pairing code"
                value={code}
                onChangeText={setCode}
                placeholder="ABCD-1234"
                autoCapitalize="characters"
                autoCorrect={false}
                secureTextEntry
                editable={!busy}
                hint="Find this code in ORBIT Desktop Companion → Pair device."
              />

              <Button
                label="Pair computer"
                onPress={() => {
                  void pair();
                }}
                loading={busy}
                disabled={busy || !name.trim() || !endpoint.trim() || !code.trim()}
              />

              <Text style={styles.footnote}>
                A paired computer still requires a separate approval for every high-risk command.
                Revoke it any time from Agent Permissions.
              </Text>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      backgroundColor: 'rgba(3, 6, 12, 0.58)',
    },
    keyboard: {
      width: '100%',
      alignItems: 'center',
    },
    sheet: {
      width: '100%',
      maxWidth: 520,
      maxHeight: '92%',
      overflow: 'hidden',
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: glass.border,
      borderTopColor: glass.borderBright,
      backgroundColor: glass.fillStrong,
      shadowColor: '#000000',
      shadowOpacity: 0.5,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: -14 },
      elevation: 28,
    },
    glow: {
      position: 'absolute',
      top: -130,
      right: -90,
      width: 250,
      height: 250,
      borderRadius: 125,
      backgroundColor: colors.accentSoft,
    },
    highlight: {
      position: 'absolute',
      top: 0,
      left: '10%',
      right: '10%',
      height: 1,
      backgroundColor: glass.highlight,
    },
    handle: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginTop: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    headerIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      flex: 1,
      gap: 3,
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
      letterSpacing: -0.3,
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: 11,
      backgroundColor: glass.fillSoft,
      borderWidth: 1,
      borderColor: glass.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    form: {
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
    },
    securityNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: 'rgba(62, 224, 161, 0.22)',
      backgroundColor: colors.successSoft,
      padding: spacing.sm,
    },
    securityText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    footnote: {
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 14,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.5,
    },
  });
