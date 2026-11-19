import { Link, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { TextField } from '@/components/TextField';
import { useSession } from '@/context/auth';
import { colors, spacing } from '@/theme';

export default function SignInScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await signIn(email, password);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your private Orbit account. Everything stays on this device."
    >
      <TextField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        editable={!isSubmitting}
      />

      <TextField
        label="Password"
        placeholder="Your password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        editable={!isSubmitting}
      />

      <FormError message={error} />

      <Button label="Sign in" onPress={handleSubmit} loading={isSubmitting} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>New here?</Text>
        <Link href="/sign-up" style={styles.footerLink}>
          Create an account
        </Link>
      </View>

      <Text style={styles.note}>
        Local-first · account and sessions are stored in SQLite on your phone
      </Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 15,
  },
  footerLink: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  note: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
