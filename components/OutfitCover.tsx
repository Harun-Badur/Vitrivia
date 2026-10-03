import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Shirt } from 'lucide-react-native';
import { colors } from '../lib/theme';
import { logger } from '../lib/logger';
import { useAppStore } from '../store/useAppStore';
import { wardrobeImage, type SavedOutfit } from '../types/wardrobe';
import {
  fetchOutfitCoverParts,
  type OutfitCoverPart,
} from '../services/outfitCoverService';

function PartImage({ part }: { part: OutfitCoverPart }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [part.imageUrl]);
  return (
    <View style={styles.cell}>
      {part.imageUrl && !failed ? (
        <Image
          source={{ uri: part.imageUrl }}
          style={styles.image}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={part.key}
          accessibilityLabel={`Kombin parçası ${part.sourceId}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Shirt size={18} color={colors.textSecondary} />
      )}
    </View>
  );
}

export default function OutfitCover({
  outfit,
  style,
}: {
  outfit: SavedOutfit;
  style?: StyleProp<ViewStyle>;
}) {
  const clothes = useAppStore((state) => state.wardrobeItems);
  const favorites = useAppStore((state) => state.likedProducts);
  const currentProducts = useAppStore((state) => state.currentProducts);
  const local = useMemo(() => {
    const wardrobe = new Map(
      clothes.map((item) => [item.id, wardrobeImage(item)]),
    );
    const catalog = new Map(
      [
        ...(currentProducts ?? []),
        ...favorites.map(({ product }) => product),
      ].map((product) => [product.id, product.imageUrl]),
    );
    return [
      ...outfit.wardrobeItemIds.map((id): OutfitCoverPart => ({
        key: `wardrobe:${id}`,
        source: 'wardrobe',
        sourceId: id,
        imageUrl: wardrobe.get(id),
      })),
      ...outfit.catalogProductIds.map((id): OutfitCoverPart => ({
        key: `catalog:${id}`,
        source: 'catalog',
        sourceId: id,
        imageUrl: catalog.get(id),
      })),
    ];
  }, [
    clothes,
    favorites,
    currentProducts,
    outfit.wardrobeItemIds,
    outfit.catalogProductIds,
  ]);
  const [remote, setRemote] = useState<{
    id: string;
    parts: OutfitCoverPart[];
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchOutfitCoverParts(outfit, local)
      .then((parts) => {
        if (!cancelled) setRemote({ id: outfit.id, parts });
      })
      .catch((error: unknown) =>
        logger.warn('Kombin cover görselleri yüklenemedi', {
          outfitId: outfit.id,
          error,
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [outfit, local]);
  const resolved = remote?.id === outfit.id ? remote.parts : local;
  const parts = resolved.length
    ? resolved
    : outfit.imageUrl
      ? [
          {
            key: outfit.id,
            source: 'catalog' as const,
            sourceId: outfit.id,
            imageUrl: outfit.imageUrl,
          },
        ]
      : [];
  return (
    <View
      style={[styles.cover, style]}
      accessibilityLabel={`${outfit.title} kombin cover`}
    >
      {parts.length === 0 ? (
        <View style={styles.cell}>
          <Shirt size={24} color={colors.accent} />
        </View>
      ) : parts.length <= 2 ? (
        <View style={styles.row}>
          {parts.map((part) => (
            <PartImage key={part.key} part={part} />
          ))}
        </View>
      ) : parts.length === 3 ? (
        <View style={styles.row}>
          <PartImage part={parts[0]} />
          <View style={styles.column}>
            {parts.slice(1).map((part) => (
              <PartImage key={part.key} part={part} />
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.column}>
          {Array.from({ length: Math.ceil(parts.length / 2) }, (_, index) => (
            <View key={index} style={styles.row}>
              {parts.slice(index * 2, index * 2 + 2).map((part) => (
                <PartImage key={part.key} part={part} />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  cover: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  row: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 2 },
  column: { flex: 1, minHeight: 0, gap: 2 },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  image: { height: '100%', width: '100%' },
});
