import { Link, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { TextField } from '@/components/TextField';
import { useSession } from '@/context/auth';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth';
import { colors, spacing } from '@/theme';

export default function SignUpScreen() {
  const { signUp } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (isSubmitting) {
      return;
    }

    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      await signUp({ name, email, password });
      router.replace('/');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not create your account. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="No cloud, no tracking. Your account is created and encrypted on this phone."
    >
      <TextField
        label="Name"
        placeholder="Your name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        editable={!isSubmitting}
      />

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
        placeholder="Create a password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        editable={!isSubmitting}
      />

      <TextField
        label="Confirm password"
        placeholder="Repeat your password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        editable={!isSubmitting}
      />

      <FormError message={error} />

      <Button label="Create account" onPress={handleSubmit} loading={isSubmitting} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account?</Text>
        <Link href="/sign-in" style={styles.footerLink}>
          Sign in
        </Link>
      </View>
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
});
