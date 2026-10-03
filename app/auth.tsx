import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuthContext } from '../hooks/useAuthContext';
import { logger } from '../lib/logger';
import { colors, radius, shadows, spacing } from '../lib/theme';
import type { AuthStatus } from '../types/auth';

type AuthMode = 'login' | 'signup';

const MIN_PASSWORD_LENGTH = 6;

const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function AuthScreen() {
  const { signIn, signUp } = useAuthContext();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isInfoMessage, setIsInfoMessage] = useState(false);

  const title = mode === 'login' ? 'Vitirify\'a hoş geldin' : 'Vitirify hesabı oluştur';
  const submitLabel = mode === 'login' ? 'Giriş yap' : 'Kayıt ol';
  const toggleLabel =
    mode === 'login'
      ? 'Hesabın yok mu? Kayıt ol'
      : 'Zaten hesabın var mı? Giriş yap';

  const handleSubmit = async (): Promise<void> => {
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setIsInfoMessage(false);
      setMessage('Geçerli bir e-posta adresi gir.');
      setStatus('error');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setIsInfoMessage(false);
      setMessage(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`);
      setStatus('error');
      return;
    }

    setStatus('loading');
    setMessage(null);
    try {
      if (mode === 'login') {
        await signIn({ email: trimmedEmail, password });
        setStatus('success');
        return;
      }
      const result = await signUp({ email: trimmedEmail, password });
      if (result.needsEmailConfirmation) {
        setIsInfoMessage(true);
        setMessage(
          'Kayıt alındı. E-posta doğrulaması açıksa gelen bağlantıyı onayla, sonra giriş yap.',
        );
        setStatus('success');
        return;
      }
      setStatus('success');
    } catch (error) {
      if (__DEV__) {
        const supabaseMessage =
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : error instanceof Error
              ? error.message
              : 'Bilinmeyen hata';
        logger.error('Auth işlemi başarısız', { detail: supabaseMessage });
      }
      const text =
        error instanceof Error ? error.message : 'İşlem tamamlanamadı.';
      const isConfirmation = text.includes('Kayıt alındı');
      setIsInfoMessage(isConfirmation);
      setMessage(text);
      setStatus(isConfirmation ? 'success' : 'error');
    }
  };

  const isLoading = status === 'loading';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>Vitirify</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          Beğenilerin dolabında kalsın. Sanal denemeye devam etmek için giriş
          yap.
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="E-posta"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          keyboardAppearance="light"
          textContentType="emailAddress"
          style={styles.input}
          editable={!isLoading}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Şifre"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          keyboardAppearance="light"
          textContentType={mode === 'login' ? 'password' : 'newPassword'}
          style={styles.input}
          editable={!isLoading}
        />

        {message ? (
          <Text style={isInfoMessage ? styles.info : styles.error}>
            {message}
          </Text>
        ) : null}

        <Pressable
          onPress={() => {
            void handleSubmit();
          }}
          disabled={isLoading}
          style={({ pressed }) => [
            styles.submit,
            pressed || isLoading ? styles.submitPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.inverseText} />
          ) : (
            <Text style={styles.submitText}>{submitLabel}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setMessage(null);
            setStatus('idle');
          }}
          disabled={isLoading}
          accessibilityRole="button"
        >
          <Text style={styles.toggle}>{toggleLabel}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgSoft,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.xl,
    ...shadows.card,
  },
  brand: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.accent,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
    backgroundColor: colors.bgSoft,
  },
  error: {
    color: colors.destructive,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  info: {
    color: colors.accentDark,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  submit: {
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  submitPressed: {
    opacity: 0.82,
  },
  submitText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
  toggle: {
    marginTop: 18,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
});
