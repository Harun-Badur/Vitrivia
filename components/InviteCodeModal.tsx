import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';

interface InviteCodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (code: string) => void;
}

export default function InviteCodeModal({
  visible,
  onClose,
  onSave,
}: InviteCodeModalProps) {
  const [code, setCode] = useState('');

  const handleSave = (): void => {
    onSave(code.trim());
    setCode('');
  };

  const handleClose = (): void => {
    setCode('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
        />
        <View style={styles.card}>
          <Text style={styles.title}>Davet kodu</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Kodu gir"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Davet kodu"
          />
          <PressableScale
            onPress={handleSave}
            style={styles.saveButton}
            accessibilityRole="button"
            accessibilityLabel="Kaydet"
          >
            <Text style={styles.saveText}>Kaydet</Text>
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.backdrop,
    opacity: 0.45,
  },
  card: {
    backgroundColor: colors.input,
    borderRadius: radius.card,
    padding: spacing.xl,
    gap: spacing.md,
    zIndex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.bgSoft,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
});
