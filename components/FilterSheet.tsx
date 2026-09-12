import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import PressableScale from './PressableScale';
import {
  COLOR_CHIP_LABELS,
  type FeedQueryFilters,
} from '../lib/feedQuery';
import { colors, radius, spacing } from '../lib/theme';
import type { GarmentCategory } from '../types/product';

const CATEGORY_CHIPS: { value: GarmentCategory; label: string }[] = [
  { value: 'upper_body', label: 'Üst' },
  { value: 'lower_body', label: 'Alt' },
  { value: 'dresses', label: 'Elbise' },
];

const COLOR_CHIPS: { value: string; label: string }[] = [
  'siyah',
  'beyaz',
  'kirmizi',
  'mavi',
  'navy',
  'yesil',
  'pembe',
  'gri',
  'bej',
  'kahverengi',
].map((value) => ({
  value,
  label: COLOR_CHIP_LABELS[value] ?? value,
}));

const STYLE_CHIPS = ['midi', 'maxi', 'mini', 'abiye', 'triko', 'saten'] as const;

const PRICE_PRESETS: {
  label: string;
  priceMin?: number;
  priceMax?: number;
}[] = [
  { label: '<500₺', priceMax: 500 },
  { label: '500-1000₺', priceMin: 500, priceMax: 1000 },
  { label: '1000+₺', priceMin: 1000 },
];

interface FilterSheetProps {
  visible: boolean;
  filters: FeedQueryFilters;
  onClose: () => void;
  onApply: (filters: FeedQueryFilters) => void;
}

interface ChipGroupProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T | null) => void;
}

function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: ChipGroupProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const isActive = selected === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onSelect(isActive ? null : option.value)}
              style={[styles.chip, isActive ? styles.chipActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={option.label}
            >
              <Text
                style={[styles.chipText, isActive ? styles.chipTextActive : null]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function FilterSheet({
  visible,
  filters,
  onClose,
  onApply,
}: FilterSheetProps) {
  const [draft, setDraft] = useState<FeedQueryFilters>(filters);

  useEffect(() => {
    if (visible) {
      setDraft(filters);
    }
  }, [filters, visible]);

  const handleClear = (): void => {
    setDraft({});
  };

  const handleApply = (): void => {
    onApply(draft);
    onClose();
  };

  const activePriceKey = (() => {
    for (const preset of PRICE_PRESETS) {
      if (
        draft.priceMin === preset.priceMin &&
        draft.priceMax === preset.priceMax
      ) {
        return preset.label;
      }
      if (
        preset.priceMin === undefined &&
        draft.priceMin === undefined &&
        draft.priceMax === preset.priceMax
      ) {
        return preset.label;
      }
      if (
        preset.priceMax === undefined &&
        draft.priceMax === undefined &&
        draft.priceMin === preset.priceMin
      ) {
        return preset.label;
      }
    }
    return null;
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Filtreleri kapat"
        />
        <View style={styles.sheet}>
          <Text style={styles.title}>Filtrele</Text>
          <ChipGroup
            label="Kategori"
            options={CATEGORY_CHIPS}
            selected={draft.category ?? null}
            onSelect={(category) =>
              setDraft((current) => {
                const next = { ...current };
                if (category === null) delete next.category;
                else next.category = category;
                return next;
              })
            }
          />
          <ChipGroup
            label="Renk"
            options={COLOR_CHIPS}
            selected={draft.color ?? null}
            onSelect={(color) =>
              setDraft((current) => {
                const next = { ...current };
                if (color === null) delete next.color;
                else next.color = color;
                return next;
              })
            }
          />
          <ChipGroup
            label="Stil"
            options={STYLE_CHIPS.map((style) => ({
              value: style,
              label: style,
            }))}
            selected={draft.style ?? null}
            onSelect={(style) =>
              setDraft((current) => {
                const next = { ...current };
                if (style === null) delete next.style;
                else next.style = style;
                return next;
              })
            }
          />
          <View style={styles.group}>
            <Text style={styles.groupLabel}>Fiyat</Text>
            <View style={styles.chipRow}>
              {PRICE_PRESETS.map((preset) => {
                const isActive = activePriceKey === preset.label;
                return (
                  <Pressable
                    key={preset.label}
                    onPress={() =>
                      setDraft((current) => {
                        const next = { ...current };
                        if (isActive) {
                          delete next.priceMin;
                          delete next.priceMax;
                          return next;
                        }
                        if (preset.priceMin !== undefined) {
                          next.priceMin = preset.priceMin;
                        } else {
                          delete next.priceMin;
                        }
                        if (preset.priceMax !== undefined) {
                          next.priceMax = preset.priceMax;
                        } else {
                          delete next.priceMax;
                        }
                        return next;
                      })
                    }
                    style={[styles.chip, isActive ? styles.chipActive : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={preset.label}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isActive ? styles.chipTextActive : null,
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.actions}>
            <PressableScale
              onPress={handleClear}
              style={styles.clearButton}
              accessibilityRole="button"
              accessibilityLabel="Temizle"
            >
              <Text style={styles.clearText}>Temizle</Text>
            </PressableScale>
            <PressableScale
              onPress={handleApply}
              style={styles.applyButton}
              accessibilityRole="button"
              accessibilityLabel="Uygula"
            >
              <Text style={styles.applyText}>Uygula</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
    opacity: 0.4,
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.lg,
  },
  group: {
    marginBottom: spacing.lg,
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  chipTextActive: {
    color: colors.inverseText,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  clearButton: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  clearText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  applyButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  applyText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
});
