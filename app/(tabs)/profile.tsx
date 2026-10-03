import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as StoreReview from 'expo-store-review';
import {
  Bell,
  Camera,
  ChevronRight,
  CircleHelp,
  Database,
  Heart,
  LogOut,
  Palette,
  Pencil,
  Ruler,
  ShieldCheck,
  Shirt,
  Sparkles,
  Tag,
  Trash2,
  User,
} from 'lucide-react-native';
import InviteCodeModal from '../../components/InviteCodeModal';
import PressableScale from '../../components/PressableScale';
import ProfileSheet from '../../components/ProfileSheet';
import SizeStudioSheet, {
  type StyleSheetSection,
} from '../../components/SizeStudioSheet';
import TryOnHistorySheet from '../../components/TryOnHistorySheet';
import { useAuthContext } from '../../hooks/useAuthContext';
import { buildInviteShareMessage } from '../../lib/inviteShare';
import { logger } from '../../lib/logger';
import { checkLowResolutionPersonPhoto } from '../../lib/personPhotoPrepare';
import { PRIVACY_URL, SUPPORT_EMAIL } from '../../lib/privacy';
import { colors, radius, shadows, spacing } from '../../lib/theme';
import { LOW_RES_MODEL_PHOTO_HINT } from '../../lib/vtonPersonImage';
import { deleteAccount } from '../../services/accountService';
import {
  fetchAccountDetails,
  saveAccountDetails,
  type AccountDetails,
} from '../../services/accountDetailsService';
import { useAppStore } from '../../store/useAppStore';
import {
  createModelPhotoSignedUrl,
  fetchStudioProfile,
  removeModelPhoto,
  uploadModelPhoto,
  upsertStudioProfile,
} from '../../services/profileService';
import {
  STYLE_TAGS,
  type GarmentSize,
  type StyleTag,
  type StudioProfilePatch,
  type UserStudioProfile,
} from '../../types/profile';

const AVATAR_SIZE = 82;
const AVATAR_RADIUS = AVATAR_SIZE / 2;
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
  const insets = useSafeAreaInsets();
  const wardrobeCount = useAppStore((state) => state.wardrobeItems.length);
  const favoriteCount = useAppStore((state) => state.likedProducts.length);
  const outfitCount = useAppStore((state) => state.savedOutfits.length);
  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountEmailInput, setAccountEmailInput] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const currentAccount = account?.id === user?.id ? account : null;
  const displayName =
    currentAccount?.username || user?.email?.split('@')[0] || 'Kullanıcı';
  const accountEmail = currentAccount?.email || user?.email || 'E-posta yok';
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
  const [styleSheetSection, setStyleSheetSection] =
    useState<StyleSheetSection>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = user?.id ?? null;
  const isBusy =
    isSigningOut || isDeleting || isSaving || uploadProgress !== null;
  const hasPhoto = photoUri !== null;
  const currentStudio = studio ?? (userId ? emptyStudio(userId) : null);
  const styleSummary =
    STYLE_TAGS.filter((tag) => currentStudio?.styleTags.includes(tag.value))
      .map((tag) => tag.label)
      .join(', ') || 'Belirlenmedi';
  const bodySummary =
    [
      currentStudio?.topSize,
      currentStudio?.bottomSize && `Alt: ${currentStudio.bottomSize}`,
      currentStudio?.heightCm != null && `${currentStudio.heightCm} cm`,
      currentStudio?.weightKg != null && `${currentStudio.weightKg} kg`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Belirlenmedi';
  const favoriteBrands =
    currentStudio?.favoriteBrands?.join(', ') || 'Seçilmedi';
  const profileFields = [
    Boolean(currentStudio?.styleTags.length),
    currentStudio?.heightCm != null,
    currentStudio?.weightKg != null,
    Boolean(currentStudio?.topSize),
    Boolean(currentStudio?.bottomSize),
  ];
  const profileCompletion = Math.round(
    (profileFields.filter(Boolean).length / profileFields.length) * 100,
  );

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

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      void fetchAccountDetails(userId)
        .then((details) => {
          if (active) setAccount(details);
        })
        .catch(() => {
          // Keep the last confirmed account details when offline.
        });
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const handleOpenAccount = async (): Promise<void> => {
    if (!userId) return;
    setAccountOpen(true);
    setAccountLoading(true);
    setAccountError(null);
    setAccountNotice(null);
    try {
      const details = await fetchAccountDetails(userId);
      setAccount(details);
      setAccountName(details.username);
      setAccountEmailInput(details.pendingEmail ?? details.email);
      if (details.pendingEmail)
        setAccountNotice(
          'E-posta değişikliği onay bekliyor. Gelen doğrulama bağlantılarını tamamla.',
        );
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : 'Hesap bilgileri yüklenemedi.',
      );
    } finally {
      setAccountLoading(false);
    }
  };

  const handleSaveAccount = async (): Promise<void> => {
    if (!userId || accountSaving || accountLoading || !currentAccount) return;
    setAccountSaving(true);
    setAccountError(null);
    setAccountNotice(null);
    try {
      const details = await saveAccountDetails(userId, {
        username: accountName,
        email: accountEmailInput,
      });
      setAccount(details);
      setAccountName(details.username);
      setAccountEmailInput(details.pendingEmail ?? details.email);
      setAccountNotice(
        details.pendingEmail
          ? 'Kullanıcı adı kaydedildi. E-posta değişikliği için gelen doğrulama bağlantılarını tamamla.'
          : 'Hesap bilgileri kaydedildi.',
      );
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : 'Hesap bilgileri kaydedilemedi.',
      );
    } finally {
      setAccountSaving(false);
    }
  };

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
      setStudio((previous) => ({ ...previous, ...next }));
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
      setStudio((previous) => ({ ...previous, ...next }));
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
      setStudio((previous) => ({ ...previous, ...next }));
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

    const mailUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Vitirify geri bildirim')}`;
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

  const handleSavePreferences = async (
    patch: StudioProfilePatch,
  ): Promise<boolean> => {
    if (!userId || isBusy) return false;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const next = await upsertStudioProfile(userId, patch);
      setStudio((previous) => ({ ...previous, ...next }));
      return true;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Değişiklik kaydedilemedi.',
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.header}>Profil</Text>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <View style={styles.profileCard}>
          <View style={styles.heroRow}>
            <View style={styles.avatarWrap}>
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
              <PressableScale
                onPress={() => {
                  void handlePickModelPhoto();
                }}
                disabled={isBusy}
                style={styles.cameraButton}
                accessibilityRole="button"
                accessibilityLabel="Profil fotoğrafını değiştir"
              >
                <Camera size={18} color={colors.accent} />
              </PressableScale>
            </View>
            <View style={styles.heroCopy}>
              <View style={styles.identityRow}>
                <View style={styles.identityCopy}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={styles.email} numberOfLines={1}>
                    {accountEmail}
                  </Text>
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
                  <Pencil size={14} color={colors.text} />
                  <Text style={styles.editButtonText}>Düzenle</Text>
                </PressableScale>
              </View>
              <View style={styles.statsRow}>
                {[
                  { label: 'Dolabım', value: wardrobeCount },
                  { label: 'Favoriler', value: favoriteCount },
                  { label: 'Kombinlerim', value: outfitCount },
                ].map((stat, index) => (
                  <View
                    key={stat.label}
                    style={[styles.stat, index > 0 && styles.statDivider]}
                  >
                    <Text style={styles.statValue}>{stat.value}</Text>
                    <Text style={styles.statLabel} numberOfLines={2}>
                      {stat.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
        {isModelPhotoLowRes ? (
          <Text style={styles.lowResHint}>{LOW_RES_MODEL_PHOTO_HINT}</Text>
        ) : null}

        <View style={styles.styleProgressCard}>
          <Sparkles color={colors.accent} size={32} />
          <View style={styles.progressCopy}>
            <Text style={styles.progressTitle}>Stilin oluşuyor.</Text>
            <Text style={styles.progressDescription}>
              Profil bilgilerinle stilini tamamlıyoruz.
            </Text>
          </View>
          <View
            style={styles.progressCircle}
            accessibilityRole="progressbar"
            accessibilityLabel="Beden ve stil bilgilerinin tamamlanma oranı"
            accessibilityValue={{ min: 0, max: 100, now: profileCompletion }}
          >
            <Svg width={64} height={64} viewBox="0 0 72 72">
              <Circle
                cx={36}
                cy={36}
                r={30}
                fill="none"
                stroke={colors.accentSoft}
                strokeWidth={5}
              />
              <Circle
                cx={36}
                cy={36}
                r={30}
                fill="none"
                stroke={colors.accent}
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 30}`}
                strokeDashoffset={
                  2 * Math.PI * 30 * (1 - profileCompletion / 100)
                }
                rotation={-90}
                origin="36, 36"
              />
            </Svg>
            <Text style={styles.progressPercent}>{profileCompletion}%</Text>
          </View>
        </View>

        <View>
          <View style={styles.styleHeading}>
            <Text style={styles.sectionTitle}>Stil Bilgilerim</Text>
            <PressableScale
              onPress={() => {
                setStyleSheetSection('all');
                setSizeOpen(true);
              }}
              disabled={isBusy}
              style={styles.sectionEdit}
              accessibilityRole="button"
              accessibilityLabel="Stil bilgilerini düzenle"
            >
              <Pencil color={colors.text} size={18} />
              <Text style={styles.sectionEditText}>Düzenle</Text>
            </PressableScale>
          </View>
          <View style={styles.styleGrid}>
            {[
              {
                title: 'Stil Tarzım',
                value: styleSummary,
                Icon: Shirt,
                onPress: () => {
                  setStyleSheetSection('style');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Beden Bilgilerim',
                value: bodySummary,
                Icon: Ruler,
                onPress: () => {
                  setStyleSheetSection('body');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Renk Tercihlerim',
                value:
                  currentStudio?.preferredColors?.join(', ') || 'Seçilmedi',
                Icon: Palette,
                onPress: () => {
                  setStyleSheetSection('colors');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Favori Markalarım',
                value: favoriteBrands,
                Icon: Tag,
                onPress: () => {
                  setStyleSheetSection('brands');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Fiyat Aralığım',
                value: currentStudio?.priceRange
                  ? `₺${currentStudio.priceRange.min.toLocaleString('tr-TR')} – ₺${currentStudio.priceRange.max.toLocaleString('tr-TR')}`
                  : 'Belirlenmedi',
                Icon: Database,
                onPress: () => {
                  setStyleSheetSection('budget');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Stil Profilini Gör',
                value: 'Senin stil özetin',
                Icon: Heart,
                onPress: () => {
                  setStyleSheetSection('summary');
                  setSizeOpen(true);
                },
              },
            ].map(({ title, value, Icon, onPress }) => (
              <PressableScale
                key={title}
                style={styles.styleTile}
                onPress={onPress}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                <View style={styles.styleIcon}>
                  <Icon size={22} color={colors.text} />
                </View>
                <View style={styles.tileCopy}>
                  <Text style={styles.tileTitle} numberOfLines={2}>
                    {title}
                  </Text>
                  <Text style={styles.tileValue} numberOfLines={2}>
                    {value}
                  </Text>
                </View>
                <ChevronRight size={15} color={colors.tabInactive} />
              </PressableScale>
            ))}
          </View>
        </View>

        <View style={styles.menuCard}>
          <MenuRow
            label="Denemelerim"
            icon={<Sparkles color={colors.text} size={22} />}
            onPress={() => setHistoryOpen(true)}
            accessibilityLabel="Denemelerim"
          />
          <MenuRow
            label="Hesap Bilgilerim"
            icon={<User color={colors.text} size={22} />}
            onPress={() => {
              void handleOpenAccount();
            }}
            disabled={isBusy}
            accessibilityLabel="Hesap Bilgilerim"
          />
          <MenuRow
            label="Bildirim Ayarları"
            icon={<Bell color={colors.text} size={22} />}
            onPress={() => {
              void Linking.openSettings().catch(() =>
                Alert.alert(
                  'Ayarlar açılamadı',
                  'Cihaz ayarlarından bildirim izinlerini düzenleyebilirsin.',
                ),
              );
            }}
            accessibilityLabel="Bildirim Ayarları"
          />
          <MenuRow
            label="Gizlilik ve Güvenlik"
            icon={<ShieldCheck color={colors.text} size={22} />}
            onPress={handleOpenPrivacy}
            accessibilityRole="link"
            accessibilityLabel="Gizlilik ve Güvenlik"
          />
          <MenuRow
            label="Yardım ve Destek"
            icon={<CircleHelp color={colors.text} size={22} />}
            onPress={() =>
              Alert.alert('Yardım ve Destek', SUPPORT_EMAIL, [
                { text: 'Kapat', style: 'cancel' },
                {
                  text: 'Geri bildirim ve değerlendir',
                  onPress: () => {
                    void handleFeedback();
                  },
                },
                {
                  text: 'Davet seçenekleri',
                  onPress: () =>
                    Alert.alert('Davet seçenekleri', undefined, [
                      { text: 'Kapat', style: 'cancel' },
                      {
                        text: 'Davet Et',
                        onPress: () => {
                          void handleInvite();
                        },
                      },
                      {
                        text: 'Davet Kodu Gir',
                        onPress: () => setInviteOpen(true),
                      },
                    ]),
                },
              ])
            }
            accessibilityLabel="Yardım ve Destek"
            isLast
          />
        </View>

        <PressableScale
          onPress={handleDeleteAccount}
          disabled={isBusy}
          style={[styles.accountButton, styles.deleteButton]}
          accessibilityRole="button"
          accessibilityLabel="Hesabımı sil"
        >
          {isDeleting ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Trash2 size={22} color={colors.accent} />
              <Text style={styles.deleteButtonText}>Hesabımı Sil</Text>
            </>
          )}
        </PressableScale>
        <PressableScale
          onPress={() => {
            void handleSignOut();
          }}
          disabled={isBusy}
          style={[styles.accountButton, styles.signOutButton]}
          accessibilityRole="button"
          accessibilityLabel="Çıkış yap"
        >
          {isSigningOut ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <LogOut size={22} color={colors.tabInactive} />
              <Text style={styles.signOutText}>Çıkış Yap</Text>
            </>
          )}
        </PressableScale>
      </ScrollView>

      {toastMessage ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      <ProfileSheet
        visible={accountOpen}
        title="Hesap Bilgilerim"
        onClose={() => {
          if (!accountSaving) setAccountOpen(false);
        }}
      >
        <View style={styles.accountForm}>
          {accountLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Text style={styles.accountFieldLabel}>Kullanıcı adı</Text>
              <TextInput
                value={accountName}
                onChangeText={setAccountName}
                editable={!accountSaving && !!currentAccount}
                maxLength={80}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.accountInput}
                accessibilityLabel="Hesap kullanıcı adı"
              />
              <Text style={styles.accountFieldLabel}>E-posta</Text>
              <TextInput
                value={accountEmailInput}
                onChangeText={setAccountEmailInput}
                editable={!accountSaving && !!currentAccount}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.accountInput}
                accessibilityLabel="Hesap e-posta adresi"
              />
            </>
          )}
          {accountError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {accountError}
            </Text>
          ) : null}
          {accountNotice ? (
            <Text style={styles.accountNotice} accessibilityRole="alert">
              {accountNotice}
            </Text>
          ) : null}
          <PressableScale
            onPress={() => {
              void handleSaveAccount();
            }}
            disabled={accountSaving || accountLoading || !currentAccount}
            style={styles.accountSaveButton}
            accessibilityRole="button"
            accessibilityLabel="Hesap bilgilerini kaydet"
          >
            {accountSaving ? (
              <ActivityIndicator color={colors.inverseText} />
            ) : (
              <Text style={styles.accountSaveText}>Kaydet</Text>
            )}
          </PressableScale>
        </View>
      </ProfileSheet>
      <TryOnHistorySheet
        visible={historyOpen}
        userId={userId}
        onClose={() => setHistoryOpen(false)}
      />
      {currentStudio ? (
        <SizeStudioSheet
          visible={sizeOpen}
          section={styleSheetSection}
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
          onSavePreferences={handleSavePreferences}
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
  accountForm: { gap: spacing.sm },
  accountFieldLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  accountInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.input,
  },
  accountNotice: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  accountSaveButton: {
    minHeight: 48,
    borderRadius: radius.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  accountSaveText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '700',
  },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
  },
  header: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  scroll: {
    gap: spacing.md,
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
  profileCard: {
    backgroundColor: colors.input,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.md,
    ...shadows.segment,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE, marginTop: 4 },
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
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButton: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.lg,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  identityCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  userName: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  email: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 3 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.hairline },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.input,
  },
  editButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  styleProgressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.accentSoft,
  },
  progressCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  progressTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  progressDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  progressCircle: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressPercent: {
    position: 'absolute',
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  styleHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  sectionEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  sectionEditText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  styleTile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.segment,
  },
  styleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.segment,
  },
  tileCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  tileTitle: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  tileValue: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
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
  accountButton: {
    minHeight: 48,
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  deleteButton: { backgroundColor: colors.accentSoft },
  deleteButtonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  signOutButton: { backgroundColor: colors.hairline, marginTop: -4 },
  signOutText: { color: colors.text, fontSize: 15, fontWeight: '500' },
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
