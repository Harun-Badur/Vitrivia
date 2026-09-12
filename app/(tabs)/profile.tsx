import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as StoreReview from 'expo-store-review';
import {
  ChevronRight,
  Gift,
  Lock,
  LogOut,
  Sparkles,
  Star,
  User,
} from 'lucide-react-native';
import InviteCodeModal from '../../components/InviteCodeModal';
import PressableScale from '../../components/PressableScale';
import SizeStudioSheet from '../../components/SizeStudioSheet';
import TryOnHistorySheet from '../../components/TryOnHistorySheet';
import { useAuthContext } from '../../hooks/useAuthContext';
import { buildInviteShareMessage } from '../../lib/inviteShare';
import { logger } from '../../lib/logger';
import { checkLowResolutionPersonPhoto } from '../../lib/personPhotoPrepare';
import { PRIVACY_URL, SUPPORT_EMAIL } from '../../lib/privacy';
import { colors, radius, spacing } from '../../lib/theme';
import { LOW_RES_MODEL_PHOTO_HINT } from '../../lib/vtonPersonImage';
import { deleteAccount } from '../../services/accountService';
import {
  createModelPhotoSignedUrl,
  fetchStudioProfile,
  removeModelPhoto,
  uploadModelPhoto,
  upsertStudioProfile,
} from '../../services/profileService';
import {
  type GarmentSize,
  type StyleTag,
  type StudioProfilePatch,
  type UserStudioProfile,
} from '../../types/profile';

const AVATAR_SIZE = 56;
const AVATAR_RADIUS = 16;
const ICON_SM = 18;
const ICON_AVATAR = 26;
const TOAST_DURATION_MS = 1600;
const INVITE_SAVED_TOAST = 'Kod alındı — yakında aktifleşecek';

const emptyStudio = (userId: string): UserStudioProfile => ({
  userId,
  heightCm: null,
  weightKg: null,
  topSize: null,
  bottomSize: null,
  styleTags: [],
  modelPhotoPath: null,
});

interface MenuRowProps {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  accessibilityRole?: 'button' | 'link';
  accessibilityLabel: string;
  disabled?: boolean;
  isLast?: boolean;
  trailing?: ReactNode;
}

function MenuRow({
  label,
  icon,
  onPress,
  accessibilityRole = 'button',
  accessibilityLabel,
  disabled = false,
  isLast = false,
  trailing,
}: MenuRowProps) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[styles.menuRow, isLast ? null : styles.menuRowBorder]}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.menuLeading}>
        {icon}
        <Text style={styles.menuLabel}>{label}</Text>
      </View>
      <View style={styles.menuTrailing}>
        {trailing}
        <ChevronRight color={colors.tabInactive} size={ICON_SM} />
      </View>
    </PressableScale>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuthContext();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [studio, setStudio] = useState<UserStudioProfile | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isModelPhotoLowRes, setIsModelPhotoLowRes] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = user?.id ?? null;
  const isBusy = isSigningOut || isDeleting || isSaving || uploadProgress !== null;
  const hasPhoto = photoUri !== null;
  const currentStudio = studio ?? (userId ? emptyStudio(userId) : null);

  const showToast = useCallback((message: string): void => {
    if (toastTimeoutRef.current !== null) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const loadStudio = useCallback(async (id: string): Promise<void> => {
    try {
      const profile = await fetchStudioProfile(id);
      setStudio(profile);
      if (profile.modelPhotoPath) {
        const signed = await createModelPhotoSignedUrl(profile.modelPhotoPath);
        setPhotoUri(signed);
        if (signed) {
          const lowRes = await checkLowResolutionPersonPhoto(signed);
          setIsModelPhotoLowRes(lowRes);
        } else {
          setIsModelPhotoLowRes(false);
        }
      } else {
        setPhotoUri(null);
        setIsModelPhotoLowRes(false);
      }
    } catch (error) {
      logger.error('Stüdyo profili yüklenemedi', { error });
      setErrorMessage('Profil bilgileri yüklenemedi. Lütfen tekrar dene.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        return;
      }
      void loadStudio(userId);
    }, [loadStudio, userId]),
  );

  useEffect(() => {
    if (!userId) {
      setStudio(null);
      setPhotoUri(null);
      setIsModelPhotoLowRes(false);
    }
  }, [userId]);

  const persistPatch = async (patch: StudioProfilePatch): Promise<void> => {
    if (!userId) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const next = await upsertStudioProfile(userId, patch);
      setStudio(next);
    } catch (error) {
      logger.error('Stüdyo kaydı başarısız', { error });
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Değişiklik kaydedilemedi. Lütfen tekrar dene.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handlePickModelPhoto = async (): Promise<void> => {
    if (!userId) {
      return;
    }
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrorMessage(
          'Galerine erişim izni verilmedi. Ayarlardan izin verip tekrar dene.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
      });
      if (result.canceled || !result.assets[0]) {
        return;
      }

      setErrorMessage(null);
      setUploadProgress(0);
      const next = await uploadModelPhoto(userId, result.assets[0].uri, {
        onProgress: setUploadProgress,
      });
      setStudio(next);
      setPhotoUri(result.assets[0].uri);
      const lowRes = await checkLowResolutionPersonPhoto(result.assets[0].uri);
      setIsModelPhotoLowRes(lowRes);
    } catch (error) {
      logger.error('Model fotoğrafı yüklenemedi', { error });
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Fotoğraf yüklenemedi. Lütfen tekrar dene.',
      );
    } finally {
      setUploadProgress(null);
    }
  };

  const runRemovePhoto = async (): Promise<void> => {
    if (!userId) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const next = await removeModelPhoto(userId);
      setStudio(next);
      setPhotoUri(null);
      setIsModelPhotoLowRes(false);
    } catch (error) {
      logger.error('Model fotoğrafı kaldırılamadı', { error });
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Fotoğraf kaldırılamadı. Lütfen tekrar dene.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemovePhoto = (): void => {
    if (!hasPhoto) {
      return;
    }
    Alert.alert(
      'Fotoğrafı kaldır',
      'Kayıtlı model fotoğrafın silinecek. Sanal denemede yeniden seçmen gerekir.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: () => {
            void runRemovePhoto();
          },
        },
      ],
    );
  };

  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true);
    setErrorMessage(null);
    try {
      await signOut();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Çıkış yapılamadı.',
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const runDeleteAccount = async (): Promise<void> => {
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deleteAccount();
      await signOut();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Hesap silinemedi.';
      setErrorMessage(message);
      Alert.alert('Hesap silinemedi', message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAccount = (): void => {
    Alert.alert(
      'Hesabımı sil',
      'Hesabın ve tüm verilerin (beğeniler, geçilen ürünler, bildirim kayıtları) kalıcı olarak silinecek. Bu işlem geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kalıcı olarak sil',
          style: 'destructive',
          onPress: () => {
            void runDeleteAccount();
          },
        },
      ],
    );
  };

  const handleOpenPrivacy = (): void => {
    void Linking.openURL(PRIVACY_URL).catch((error: unknown) => {
      logger.error('Gizlilik politikası açılamadı', { error });
      Alert.alert(
        'Bağlantı açılamadı',
        'Gizlilik politikası bu cihazda açılamadı.',
      );
    });
  };

  const handleInvite = async (): Promise<void> => {
    try {
      await Share.share({ message: buildInviteShareMessage(PRIVACY_URL) });
    } catch (error) {
      logger.error('Davet paylaşımı açılamadı', { error });
    }
  };

  const handleInviteCodeSave = (_code: string): void => {
    setInviteOpen(false);
    showToast(INVITE_SAVED_TOAST);
  };

  const handleFeedback = async (): Promise<void> => {
    try {
      const available = await StoreReview.isAvailableAsync();
      if (available) {
        await StoreReview.requestReview();
        return;
      }
    } catch (error) {
      logger.warn('Mağaza değerlendirmesi açılamadı', { error });
    }

    const mailUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Kabin geri bildirim')}`;
    void Linking.openURL(mailUrl).catch((error: unknown) => {
      logger.error('Destek e-postası açılamadı', { error });
      Alert.alert(
        'Geri bildirim açılamadı',
        `${SUPPORT_EMAIL} adresine yazabilirsin.`,
      );
    });
  };

  const handleStyleToggle = (tag: StyleTag): void => {
    if (!studio) {
      return;
    }
    const nextTags = studio.styleTags.includes(tag)
      ? studio.styleTags.filter((item) => item !== tag)
      : [...studio.styleTags, tag];
    void persistPatch({ styleTags: nextTags });
  };

  return (
    <View style={styles.root}>
      <Text style={styles.header}>Profil</Text>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {errorMessage ? (
          <Text style={styles.error}>{errorMessage}</Text>
        ) : null}

        <View style={styles.heroRow}>
          <PressableScale
            onLongPress={handleRemovePhoto}
            disabled={!hasPhoto || isBusy}
            style={styles.avatar}
            accessibilityRole="button"
            accessibilityLabel="Model fotoğrafı"
          >
            {hasPhoto ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.avatarImage}
                contentFit="cover"
                cachePolicy="none"
                recyclingKey={photoUri}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User color={colors.textSecondary} size={ICON_AVATAR} />
              </View>
            )}
            {uploadProgress !== null ? (
              <View style={styles.avatarScrim}>
                <ActivityIndicator color={colors.inverseText} />
              </View>
            ) : null}
          </PressableScale>
          <View style={styles.heroCopy}>
            <Text style={styles.email} numberOfLines={1}>
              {user?.email ?? 'E-posta yok'}
            </Text>
            <View
              style={[
                styles.badge,
                hasPhoto ? styles.badgeActive : styles.badgeIdle,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  hasPhoto ? styles.badgeTextActive : styles.badgeTextIdle,
                ]}
              >
                {hasPhoto ? 'AI Manken: Aktif' : 'AI Manken: Kur'}
              </Text>
            </View>
          </View>
          <PressableScale
            onPress={() => {
              void handlePickModelPhoto();
            }}
            disabled={isBusy}
            style={styles.editButton}
            accessibilityRole="button"
            accessibilityLabel="Düzenle"
          >
            <Text style={styles.editButtonText}>Düzenle</Text>
          </PressableScale>
        </View>
        {isModelPhotoLowRes ? (
          <Text style={styles.lowResHint}>{LOW_RES_MODEL_PHOTO_HINT}</Text>
        ) : null}

        <LinearGradient
          colors={[colors.accentSoft, colors.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.viralCard}
        >
          <View style={styles.viralHeader}>
            <View style={styles.giftWrap}>
              <Gift color={colors.accentDark} size={22} />
            </View>
            <View style={styles.viralCopy}>
              <Text style={styles.viralTitle}>Arkadaşını Davet Et</Text>
              <Text style={styles.viralSubtitle}>
                Arkadaşlarını davet et, ekstra sanal deneme hakkı kazan.
              </Text>
            </View>
          </View>
          <PressableScale
            onPress={() => {
              void handleInvite();
            }}
            style={styles.inviteButton}
            accessibilityRole="button"
            accessibilityLabel="Davet et"
          >
            <Text style={styles.inviteButtonText}>Davet Et</Text>
          </PressableScale>
          <PressableScale
            onPress={() => setInviteOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Davet kodu gir"
          >
            <Text style={styles.inviteLink}>Davet Kodu Gir</Text>
          </PressableScale>
        </LinearGradient>

        <View>
          <Text style={styles.groupLabel}>Aktivite</Text>
          <View style={styles.menuCard}>
            <MenuRow
              label="Denemelerim"
              icon={<Sparkles color={colors.icon} size={ICON_SM} />}
              onPress={() => setHistoryOpen(true)}
              accessibilityLabel="Denemelerim"
            />
            <MenuRow
              label="Beden & Stil Tercihlerim"
              icon={<User color={colors.icon} size={ICON_SM} />}
              onPress={() => setSizeOpen(true)}
              accessibilityLabel="Beden ve stil tercihlerim"
              isLast
            />
          </View>
        </View>

        <View>
          <Text style={styles.groupLabel}>Destek & hesap</Text>
          <View style={styles.menuCard}>
            <MenuRow
              label="Geri Bildirim & Değerlendir"
              icon={<Star color={colors.icon} size={ICON_SM} />}
              onPress={() => {
                void handleFeedback();
              }}
              accessibilityLabel="Geri bildirim ve değerlendir"
            />
            <MenuRow
              label="Gizlilik Politikası"
              icon={<Lock color={colors.icon} size={ICON_SM} />}
              onPress={handleOpenPrivacy}
              accessibilityRole="link"
              accessibilityLabel="Gizlilik politikası"
            />
            <MenuRow
              label="Çıkış Yap"
              icon={<LogOut color={colors.icon} size={ICON_SM} />}
              onPress={() => {
                void handleSignOut();
              }}
              accessibilityLabel="Çıkış yap"
              disabled={isBusy}
              isLast
              trailing={
                isSigningOut ? (
                  <ActivityIndicator color={colors.text} />
                ) : null
              }
            />
          </View>
        </View>

        <PressableScale
          onPress={handleDeleteAccount}
          disabled={isBusy}
          style={styles.deleteLink}
          accessibilityRole="button"
          accessibilityLabel="Hesabımı sil"
        >
          {isDeleting ? (
            <ActivityIndicator color={colors.tabInactive} />
          ) : (
            <Text style={styles.deleteLinkText}>Hesabımı Sil</Text>
          )}
        </PressableScale>
      </ScrollView>

      {toastMessage ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      <TryOnHistorySheet
        visible={historyOpen}
        userId={userId}
        onClose={() => setHistoryOpen(false)}
      />
      {currentStudio ? (
        <SizeStudioSheet
          visible={sizeOpen}
          profile={currentStudio}
          disabled={isBusy}
          onClose={() => setSizeOpen(false)}
          onHeightChange={(value) => {
            void persistPatch({ heightCm: value });
          }}
          onWeightChange={(value) => {
            void persistPatch({ weightKg: value });
          }}
          onTopSizeChange={(value: GarmentSize) => {
            void persistPatch({ topSize: value });
          }}
          onBottomSizeChange={(value: GarmentSize) => {
            void persistPatch({ bottomSize: value });
          }}
          onStyleToggle={handleStyleToggle}
        />
      ) : null}
      <InviteCodeModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSave={handleInviteCodeSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgSoft,
    paddingTop: 56,
    paddingHorizontal: spacing.xl,
  },
  header: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.xl,
  },
  scroll: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  error: {
    color: colors.destructive,
    fontWeight: '600',
  },
  lowResHint: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.input,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  email: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeActive: {
    backgroundColor: colors.accentSoft,
  },
  badgeIdle: {
    backgroundColor: colors.hairline,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: colors.accentDark,
  },
  badgeTextIdle: {
    color: colors.textSecondary,
  },
  editButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.input,
  },
  editButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  viralCard: {
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  viralHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  giftWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.button,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viralCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  viralTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  viralSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  inviteButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteButtonText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
  inviteLink: {
    color: colors.accentDark,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  menuCard: {
    backgroundColor: colors.input,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  menuRow: {
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  menuRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  menuLeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  menuTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteLink: {
    alignSelf: 'center',
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
  },
  deleteLinkText: {
    color: colors.tabInactive,
    fontSize: 13,
    fontWeight: '500',
  },
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xxl,
    backgroundColor: colors.inverseSurface,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  toastText: {
    color: colors.inverseText,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
