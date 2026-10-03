import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import PressableScale from '../../components/PressableScale';
import { colors, radius, spacing } from '../../lib/theme';
import { useAppStore } from '../../store/useAppStore';
import type { GarmentCategory } from '../../types/product';

const categories: { key: GarmentCategory; label: string }[] = [
  { key: 'upper_body', label: 'Üst' },
  { key: 'lower_body', label: 'Alt' },
  { key: 'dresses', label: 'Elbise' },
  { key: 'shoes', label: 'Ayakkabı' },
  { key: 'accessories', label: 'Aksesuar' },
  { key: 'bags', label: 'Çanta' },
  { key: 'hats', label: 'Şapka' },
];
export default function AddWardrobeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useAppStore((state) =>
    state.wardrobeItems.find((item) => item.id === id),
  );
  const add = useAppStore((state) => state.addWardrobeItem);
  const update = useAppStore((state) => state.updateWardrobeItem);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [category, setCategory] = useState<GarmentCategory>(
    existing?.category ?? 'upper_body',
  );
  const [uri, setUri] = useState(existing?.imageUrl ?? '');
  const [busy, setBusy] = useState(false);
  const pick = async (camera: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Fotoğraf izni gerekli',
          'Kamera veya galeri erişimini cihaz ayarlarından açabilirsin.',
        );
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) setUri(result.assets[0].uri);
    } catch {
      Alert.alert('Fotoğraf açılamadı', 'Lütfen tekrar dene.');
    } finally {
      setBusy(false);
    }
  };
  const save = async (): Promise<void> => {
    if (busy) return;
    if (!title.trim() || !uri) {
      Alert.alert(
        'Kıyafet bilgileri eksik',
        'Bir fotoğraf seç ve kıyafetine bir ad ver.',
      );
      return;
    }
    setBusy(true);
    try {
      if (id) {
        if (!existing) throw new Error('Kıyafet artık dolabında bulunmuyor.');
        await update(id, {
          title: title.trim(),
          brand: brand.trim(),
          category,
        });
      } else
        await add({
          title: title.trim(),
          brand: brand.trim(),
          category,
          imageUrl: uri,
        });
      router.back();
    } catch (error) {
      Alert.alert(
        'Kaydedilemedi',
        error instanceof Error ? error.message : 'Lütfen tekrar dene.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{ title: id ? 'Kıyafeti Düzenle' : 'Kıyafet Ekle' }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {uri ? (
          <Image source={{ uri }} style={styles.image} contentFit="contain" />
        ) : null}
        {!id ? (
          <>
            <PressableScale
              disabled={busy}
              style={styles.button}
              onPress={() => void pick(true)}
              accessibilityLabel="Fotoğraf çek"
            >
              <Text style={styles.buttonText}>Fotoğraf Çek</Text>
            </PressableScale>
            <PressableScale
              disabled={busy}
              style={styles.button}
              onPress={() => void pick(false)}
              accessibilityLabel="Galeriden seç"
            >
              <Text style={styles.buttonText}>Galeriden Seç</Text>
            </PressableScale>
          </>
        ) : null}
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Kıyafet adı"
          accessibilityLabel="Kıyafet adı"
          maxLength={120}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          value={brand}
          onChangeText={setBrand}
          placeholder="Marka (isteğe bağlı)"
          accessibilityLabel="Kıyafet markası"
          maxLength={80}
          editable={!busy}
        />
        <PressableScale
          disabled={busy}
          style={styles.input}
          accessibilityLabel="Kıyafet kategorisi"
          onPress={() =>
            Alert.alert('Kategori', undefined, [
              ...categories.map((value) => ({
                text: value.label,
                onPress: () => setCategory(value.key),
              })),
              { text: 'İptal', style: 'cancel' },
            ])
          }
        >
          <Text style={styles.text}>
            {categories.find((value) => value.key === category)?.label}
          </Text>
        </PressableScale>
        <PressableScale
          disabled={busy}
          style={styles.button}
          onPress={() => void save()}
          accessibilityLabel="Kıyafeti kaydet"
        >
          <Text style={styles.buttonText}>Kaydet</Text>
        </PressableScale>
        {busy ? <ActivityIndicator color={colors.accent} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.md },
  image: {
    height: 200,
    width: '100%',
    borderRadius: radius.button,
    backgroundColor: colors.surface,
  },
  input: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    backgroundColor: colors.input,
    color: colors.text,
  },
  text: { color: colors.text },
  button: {
    padding: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    alignItems: 'center',
  },
  buttonText: { color: colors.inverseText, fontWeight: '700' },
});
