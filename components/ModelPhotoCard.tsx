import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';

const PREVIEW_HEIGHT = 220;

interface ModelPhotoCardProps {
  photoUri: string | null;
  uploadProgress: number | null;
  isBusy: boolean;
  onPick: () => void;
  onRemove: () => void;
}

export default function ModelPhotoCard({
  photoUri,
  uploadProgress,
  isBusy,
  onPick,
  onRemove,
}: ModelPhotoCardProps) {
  const hasPhoto = photoUri !== null;
  const progressLabel =
    uploadProgress !== null
      ? `%${Math.round(uploadProgress * 100)}`
      : null;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Modelim</Text>
      <Text style={styles.hint}>
        Tam boy, net bir fotoğraf sanal denemede varsayılan olarak kullanılır.
      </Text>
      <View style={styles.preview}>
        {hasPhoto ? (
          <Image
            source={{ uri: photoUri }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="none"
            recyclingKey={photoUri}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>Tam boy fotoğraf yok</Text>
            <Text style={styles.placeholderHint}>
              Galeriden dikey bir kare seç. En iyi sonuç için ayakta, 3:4 oran.
            </Text>
          </View>
        )}
        {uploadProgress !== null ? (
          <View style={styles.progressScrim}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.round(uploadProgress * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>{progressLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <PressableScale
          onPress={onPick}
          disabled={isBusy}
          style={styles.primary}
          accessibilityRole="button"
          accessibilityLabel={hasPhoto ? 'Değiştir' : 'Fotoğraf yükle'}
        >
          {isBusy && uploadProgress !== null ? (
            <ActivityIndicator color={colors.inverseText} />
          ) : (
            <Text style={styles.primaryText}>
              {hasPhoto ? 'Değiştir' : 'Fotoğraf yükle'}
            </Text>
          )}
        </PressableScale>
        {hasPhoto ? (
          <PressableScale
            onPress={onRemove}
            disabled={isBusy}
            style={styles.secondary}
            accessibilityRole="button"
            accessibilityLabel="Kaldır"
          >
            <Text style={styles.secondaryText}>Kaldır</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.xl,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  preview: {
    height: PREVIEW_HEIGHT,
    borderRadius: radius.button,
    overflow: 'hidden',
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  placeholderTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  placeholderHint: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  progressScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.glass,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  progressLabel: {
    color: colors.inverseText,
    fontSize: 13,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primary: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.inverseText,
    fontSize: 15,
    fontWeight: '800',
  },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.input,
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
