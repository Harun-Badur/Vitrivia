import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  Database,
  Heart,
  Check,
  Palette,
  Ruler,
  Search,
  Shirt,
  Tag,
  X,
} from 'lucide-react-native';
import SizeStudioCard from './SizeStudioCard';
import PressableScale from './PressableScale';
import StyleReferenceArt, { STYLE_ART } from './StyleReferenceArt';
import StyleBrandLogo from './StyleBrandLogo';
import { colors, radius, spacing } from '../lib/theme';
import { STYLE_TAGS, STUDIO_BRANDS, STUDIO_COLORS } from '../types/profile';
import type {
  GarmentSize,
  StyleTag,
  UserStudioProfile,
  StudioProfilePatch,
} from '../types/profile';

interface SizeStudioSheetProps {
  section?: StyleSheetSection;
  visible: boolean;
  profile: UserStudioProfile;
  disabled: boolean;
  onClose: () => void;
  onHeightChange: (value: number) => void;
  onWeightChange: (value: number) => void;
  onTopSizeChange: (value: GarmentSize) => void;
  onBottomSizeChange: (value: GarmentSize) => void;
  onStyleToggle: (value: StyleTag) => void;
  onSavePreferences?: (patch: StudioProfilePatch) => Promise<boolean>;
}

export type StyleSheetSection =
  'all' | 'style' | 'body' | 'colors' | 'brands' | 'budget' | 'summary';
const SECTIONS = {
  all: {
    title: 'Beden & Stil Tercihlerim',
    description: 'Beden ve stil bilgilerini tamamla.',
    Icon: Ruler,
  },
  style: {
    title: 'Stil Tarzım',
    description: 'Sana en uygun stilleri seç.',
    Icon: Shirt,
  },
  body: {
    title: 'Beden Bilgilerim',
    description: 'Beden bilgilerini ekle.',
    Icon: Ruler,
  },
  colors: {
    title: 'Renk Tercihlerim',
    description: 'Renk tercihlerinin özeti.',
    Icon: Palette,
  },
  brands: {
    title: 'Favori Markalarım',
    description: 'Favorilerindeki ürünlerin markaları.',
    Icon: Tag,
  },
  budget: {
    title: 'Fiyat Aralığım',
    description: 'Fiyat tercihlerinin özeti.',
    Icon: Database,
  },
  summary: {
    title: 'Stil Profilini Gör',
    description: 'Seçimlerine göre hazırlanan stil özetin.',
    Icon: Heart,
  },
};

export default function SizeStudioSheet({
  section = 'all',
  visible,
  profile,
  disabled,
  onClose,
  onHeightChange,
  onWeightChange,
  onTopSizeChange,
  onBottomSizeChange,
  onStyleToggle,
  onSavePreferences,
}: SizeStudioSheetProps) {
  const insets = useSafeAreaInsets();
  const [brandQuery, setBrandQuery] = useState('');
  const [draftStyles, setDraftStyles] = useState(profile.styleTags);
  const [draftBrands, setDraftBrands] = useState(profile.favoriteBrands ?? []);
  const [draftColors, setDraftColors] = useState(profile.preferredColors ?? []);
  const [priceMin, setPriceMin] = useState(
    profile.priceRange?.min.toString() ?? '',
  );
  const [priceMax, setPriceMax] = useState(
    profile.priceRange?.max.toString() ?? '',
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setDraftStyles(profile.styleTags);
    setDraftBrands(profile.favoriteBrands ?? []);
    setDraftColors(profile.preferredColors ?? []);
    setPriceMin(profile.priceRange?.min.toString() ?? '');
    setPriceMax(profile.priceRange?.max.toString() ?? '');
    setSaveError(null);
  }, [visible, section, profile]);
  const brands = [
    ...new Set([...STUDIO_BRANDS, ...(profile.favoriteBrands ?? [])]),
  ];
  const filteredBrands = brands.filter((brand) =>
    brand
      .toLocaleLowerCase('tr')
      .includes(brandQuery.trim().toLocaleLowerCase('tr')),
  );
  const { title, Icon } = SECTIONS[section];
  const editable =
    section === 'all' || section === 'body' || section === 'style';
  const styleSummary =
    STYLE_TAGS.filter((tag) => profile.styleTags.includes(tag.value))
      .map((tag) => tag.label)
      .join(', ') || 'Seçilmedi';
  const bodySummary =
    [
      profile.heightCm != null && `${profile.heightCm} cm`,
      profile.weightKg != null && `${profile.weightKg} kg`,
      profile.topSize && `Üst: ${profile.topSize}`,
      profile.bottomSize && `Alt: ${profile.bottomSize}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Belirlenmedi';
  const close = (): void => {
    if (savingRef.current) return;
    setBrandQuery('');
    onClose();
  };
  const validRange =
    priceMin.trim() !== '' &&
    priceMax.trim() !== '' &&
    Number.isFinite(Number(priceMin.replace(',', '.'))) &&
    Number.isFinite(Number(priceMax.replace(',', '.'))) &&
    Number(priceMin.replace(',', '.')) >= 0 &&
    Number(priceMax.replace(',', '.')) >= Number(priceMin.replace(',', '.'));
  const hasSelection =
    section === 'style'
      ? draftStyles.length > 0
      : section === 'brands'
        ? draftBrands.length > 0
        : section === 'colors'
          ? draftColors.length > 0
          : section === 'budget'
            ? validRange
            : true;
  const saveDisabled = disabled || saving || !hasSelection;
  const save = async (): Promise<void> => {
    if (saveDisabled || savingRef.current) return;
    if (section === 'body' || section === 'all') {
      close();
      return;
    }
    if (!onSavePreferences) return;
    const patch: StudioProfilePatch =
      section === 'style'
        ? { styleTags: draftStyles }
        : section === 'brands'
          ? { favoriteBrands: draftBrands }
          : section === 'colors'
            ? { preferredColors: draftColors }
            : {
                priceRange: {
                  min: Number(priceMin.replace(',', '.')),
                  max: Number(priceMax.replace(',', '.')),
                },
              };
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (await onSavePreferences(patch)) {
        setBrandQuery('');
        onClose();
      } else setSaveError('Değişiklik kaydedilemedi. Lütfen tekrar dene.');
    } catch {
      setSaveError('Değişiklik kaydedilemedi. Lütfen tekrar dene.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
        >
          <View style={styles.grabber} />
          <View style={styles.heading}>
            <View style={styles.headingIcon}>
              <Icon color={colors.accent} size={27} />
            </View>
            <View style={styles.headingCopy}>
              <Text style={styles.title}>{title}</Text>
            </View>
            <PressableScale
              onPress={close}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <X size={21} color={colors.text} />
            </PressableScale>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {editable ? (
              <SizeStudioCard
                section={section as 'all' | 'body' | 'style'}
                profile={
                  section === 'style'
                    ? { ...profile, styleTags: draftStyles }
                    : profile
                }
                disabled={disabled || saving}
                onHeightChange={onHeightChange}
                onWeightChange={onWeightChange}
                onTopSizeChange={onTopSizeChange}
                onBottomSizeChange={onBottomSizeChange}
                onStyleToggle={
                  section === 'style'
                    ? (tag) =>
                        setDraftStyles((current) =>
                          current.includes(tag)
                            ? current.filter((value) => value !== tag)
                            : [...current, tag],
                        )
                    : onStyleToggle
                }
              />
            ) : null}
            {section === 'colors' ? (
              <View style={styles.colorGrid}>
                {STUDIO_COLORS.map((color) => {
                  const selected = draftColors.includes(color.label);
                  return (
                    <Pressable
                      key={color.label}
                      disabled={disabled || saving}
                      accessibilityRole="checkbox"
                      accessibilityLabel={color.label}
                      accessibilityState={{
                        checked: selected,
                        disabled: disabled || saving,
                      }}
                      onPress={() =>
                        setDraftColors((current) =>
                          selected
                            ? current.filter((value) => value !== color.label)
                            : [...current, color.label],
                        )
                      }
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: color.hex },
                        selected && {
                          borderColor: colors.accent,
                          borderWidth: 2,
                        },
                      ]}
                    >
                      {selected ? (
                        <Check
                          size={22}
                          color={
                            [
                              'Beyaz',
                              'Bej',
                              'Sarı',
                              'Açık gri',
                              'Açık mavi',
                            ].includes(color.label)
                              ? colors.text
                              : colors.inverseText
                          }
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {section === 'brands' ? (
              <>
                <View style={styles.search}>
                  <Search size={17} color={colors.textSecondary} />
                  <TextInput
                    style={styles.searchInput}
                    value={brandQuery}
                    onChangeText={setBrandQuery}
                    placeholder="Marka ara..."
                    placeholderTextColor={colors.placeholder}
                    accessibilityLabel="Favori marka ara"
                  />
                </View>
                <View style={styles.brandGrid}>
                  {filteredBrands.map((brand) => (
                    <Pressable
                      key={brand}
                      disabled={disabled || saving}
                      accessibilityRole="checkbox"
                      accessibilityLabel={brand}
                      accessibilityState={{
                        checked: draftBrands.includes(brand),
                        disabled: disabled || saving,
                      }}
                      onPress={() =>
                        setDraftBrands((current) =>
                          current.includes(brand)
                            ? current.filter((value) => value !== brand)
                            : [...current, brand],
                        )
                      }
                      style={[
                        styles.brandCard,
                        draftBrands.includes(brand) && {
                          borderColor: colors.accent,
                        },
                      ]}
                    >
                      <StyleBrandLogo brand={brand} />
                      <Text style={styles.brandName} numberOfLines={2}>
                        {brand}
                      </Text>
                      {draftBrands.includes(brand) ? (
                        <View style={styles.brandCheck}>
                          <Check size={12} color={colors.inverseText} />
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
                {filteredBrands.length === 0 ? (
                  <Text style={styles.emptyText}>Eşleşen marka yok.</Text>
                ) : null}
              </>
            ) : null}
            {section === 'budget' ? (
              <View style={styles.budgetPanel}>
                <Text style={styles.rangeLabel}>Fiyat Aralığı</Text>
                <View style={styles.rangeTrack} />
                <View style={styles.rangeValues}>
                  <View style={styles.rangeBound}>
                    <TextInput
                      style={styles.rangeValue}
                      value={priceMin}
                      onChangeText={setPriceMin}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      accessibilityLabel="Minimum fiyat"
                      editable={!disabled && !saving}
                    />
                  </View>
                  <Text style={styles.rangeValue}>–</Text>
                  <View style={styles.rangeBound}>
                    <TextInput
                      style={styles.rangeValue}
                      value={priceMax}
                      onChangeText={setPriceMax}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      accessibilityLabel="Maksimum fiyat"
                      editable={!disabled && !saving}
                    />
                  </View>
                </View>
              </View>
            ) : null}
            {section === 'summary' ? (
              <>
                <View style={styles.summaryHero}>
                  <View style={styles.summaryCopy}>
                    <Text style={styles.summaryTitle}>
                      Senin{'\n'}Stil Profilin
                    </Text>
                    <Text style={styles.summaryDescription}>
                      {profile.styleTags.length
                        ? styleSummary
                        : 'Stilini ve beden bilgilerini ekleyerek profilini tamamlayabilirsin.'}
                    </Text>
                  </View>
                  <View style={styles.summaryArt}>
                    <StyleReferenceArt crop={STYLE_ART.summary} />
                  </View>
                </View>
                <View style={styles.summaryGrid}>
                  {[
                    { label: 'Stil Tarzım', value: styleSummary, Icon: Shirt },
                    {
                      label: 'Beden Bilgilerim',
                      value: bodySummary,
                      Icon: Ruler,
                    },
                    {
                      label: 'Renk Tercihlerim',
                      value: profile.preferredColors?.join(', ') || 'Seçilmedi',
                      Icon: Palette,
                    },
                    {
                      label: 'Favori Markalarım',
                      value: profile.favoriteBrands?.join(', ') || 'Seçilmedi',
                      Icon: Tag,
                    },
                    {
                      label: 'Fiyat Aralığım',
                      value: profile.priceRange
                        ? `₺${profile.priceRange.min.toLocaleString('tr-TR')} – ₺${profile.priceRange.max.toLocaleString('tr-TR')}`
                        : 'Belirlenmedi',
                      Icon: Database,
                    },
                  ].map(({ label, value, Icon: SummaryIcon }, index) => (
                    <View
                      key={label}
                      style={[
                        styles.summaryTile,
                        index === 4 && styles.summaryTileFull,
                      ]}
                    >
                      <View style={styles.summaryIcon}>
                        <SummaryIcon size={21} color={colors.text} />
                      </View>
                      <View style={styles.summaryTileCopy}>
                        <Text style={styles.summaryLabel}>{label}</Text>
                        <Text style={styles.summaryValue}>{value}</Text>
                      </View>
                      <ChevronRight size={15} color={colors.textSecondary} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            {saveError ? (
              <Text accessibilityRole="alert" style={styles.emptyText}>
                {saveError}
              </Text>
            ) : null}
          </ScrollView>
          {section !== 'summary' ? (
            <PressableScale
              onPress={() => {
                void save();
              }}
              disabled={saveDisabled}
              style={[styles.saveButton, saveDisabled && styles.saveDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Kaydet"
              accessibilityState={{ disabled: saveDisabled }}
            >
              <Text style={styles.saveText}>Kaydet</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: spacing.lg,
  },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.backdrop,
    opacity: 0.4,
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.input,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: 20,
    paddingTop: spacing.md,
  },
  grabber: {
    width: 42,
    height: 4,
    borderRadius: radius.chip,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headingIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
  },
  description: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  close: { alignSelf: 'flex-start', padding: 4 },
  content: { gap: spacing.md, paddingBottom: spacing.sm },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.accentSoft,
    padding: spacing.md,
    borderRadius: 12,
  },
  noticeText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 17 },
  saveButton: {
    height: 48,
    marginTop: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.inverseText, fontSize: 15, fontWeight: '700' },
  emptyPanel: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  emptyText: { color: colors.textSecondary, textAlign: 'center', fontSize: 13 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.chip,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, height: 38, color: colors.text, fontSize: 13 },
  brandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  brandCard: {
    width: '31%',
    minHeight: 74,
    backgroundColor: colors.input,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  brandName: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  budgetPanel: { paddingVertical: spacing.xl, gap: spacing.lg },
  rangeLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rangeTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  rangeValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rangeBound: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  rangeValue: { color: colors.textSecondary, fontSize: 14 },
  summaryHero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    overflow: 'hidden',
    paddingLeft: spacing.lg,
  },
  summaryCopy: { width: '46%', paddingVertical: spacing.md, gap: spacing.sm },
  summaryTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 27,
  },
  summaryDescription: { color: colors.text, fontSize: 11, lineHeight: 16 },
  summaryArt: { width: '54%' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryTile: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.input,
    borderRadius: 12,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    minHeight: 64,
  },
  summaryTileFull: { width: '100%' },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryTileCopy: { flex: 1, gap: 3 },
  summaryLabel: { color: colors.text, fontSize: 11, fontWeight: '700' },
  summaryValue: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
});
