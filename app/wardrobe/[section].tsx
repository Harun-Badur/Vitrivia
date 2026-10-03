import { useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import PressableScale from '../../components/PressableScale';
import VirtualTryOnModal from '../../components/VirtualTryOnModal';
import OutfitCover from '../../components/OutfitCover';
import {
  DolapProductCard,
  DolapAddCard,
  dolapCardStyles,
} from '../(tabs)/liked';
import { useAppStore } from '../../store/useAppStore';
import type { LikedProduct, Product } from '../../types/product';
import { wardrobeProduct, type SavedOutfit } from '../../types/wardrobe';
import { colors, radius, spacing } from '../../lib/theme';
import {
  openOutfitCreator,
  openWardrobeEditor,
} from '../../lib/dolapNavigation';
import { openProductPage } from '../../services/deeplinkService';

type GridEntry =
  | { id: string; kind: 'product'; item: LikedProduct; wardrobe: boolean }
  | { id: string; kind: 'outfit'; outfit: SavedOutfit }
  | { id: string; kind: 'add' };
const GRID_GAP = 6;

export default function WardrobeListScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const { width, height } = useWindowDimensions();
  const cardWidth = Math.max(0, (width - spacing.xl * 2 - GRID_GAP * 2) / 3);
  const cardHeight = Math.min(
    height < 740 ? 190 : 232,
    cardWidth * (148 / 112) + 66,
  );
  const clothes = useAppStore((state) => state.wardrobeItems);
  const favorites = useAppStore((state) => state.likedProducts);
  const outfits = useAppStore((state) => state.savedOutfits);
  const status = useAppStore((state) => state.wardrobeStatus);
  const remove = useAppStore((state) => state.removeWardrobeItem);
  const unlike = useAppStore((state) => state.unlikeProduct);
  const hydrate = useAppStore((state) => state.hydrateWardrobe);
  const userId = useAppStore((state) => state.sessionUserId);
  const [tryOnProduct, setTryOnProduct] = useState<Product | null>(null);
  const isClothes = section === 'clothes';
  const isFavorites = section === 'favorites';
  const title = isClothes
    ? 'Kıyafetlerim'
    : isFavorites
      ? 'Favorilerim'
      : 'Kombinlerim';
  const action = isClothes
    ? () => openWardrobeEditor()
    : isFavorites
      ? () => router.navigate('/(tabs)')
      : () => openOutfitCreator();
  const actionTitle = isClothes
    ? 'Kıyafet Ekle'
    : isFavorites
      ? 'Keşfet’ten Favorile'
      : 'Yeni Kombin Oluştur';
  const confirmRemove = (product: Product): void => {
    Alert.alert(product.title, 'Bu kaydı kaldırmak istiyor musun?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          void (isClothes ? remove(product.id) : unlike(product.id)).catch(() =>
            Alert.alert('Silinemedi', 'Lütfen tekrar dene.'),
          );
        },
      },
    ]);
  };
  const entries: GridEntry[] = isClothes
    ? clothes.map((item) => ({
        id: `clothes:${item.id}`,
        kind: 'product',
        wardrobe: true,
        item: {
          product: wardrobeProduct(item),
          likedAt: item.createdAt,
          notifyOnPriceDrop: false,
        },
      }))
    : isFavorites
      ? favorites.map((item) => ({
          id: `favorites:${item.product.id}`,
          kind: 'product',
          wardrobe: false,
          item,
        }))
      : outfits.map((outfit) => ({
          id: `outfits:${outfit.id}`,
          kind: 'outfit',
          outfit,
        }));
  if (entries.length > 0 && !isFavorites)
    entries.push({ id: 'add', kind: 'add' });
  if (
    section !== 'clothes' &&
    section !== 'favorites' &&
    section !== 'outfits'
  ) {
    return (
      <View style={styles.empty}>
        <Text style={styles.title}>Dolap bölümü bulunamadı.</Text>
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title }} />
      {!isFavorites && status === 'loading' ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !isFavorites && status === 'error' ? (
        <View style={styles.empty}>
          <Text style={styles.title}>Dolabın yüklenemedi</Text>
          <PressableScale
            style={styles.button}
            onPress={() => {
              if (userId) void hydrate(userId);
            }}
          >
            <Text style={styles.buttonText}>Tekrar Dene</Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          key={section}
          numColumns={3}
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={entries.length ? styles.list : styles.empty}
          columnWrapperStyle={entries.length ? styles.row : undefined}
          ListEmptyComponent={
            <View style={styles.emptyContent}>
              <Text style={styles.title}>
                {isClothes
                  ? 'Kıyafetlerini eklemeye başla'
                  : isFavorites
                    ? 'Henüz favorin yok'
                    : 'Henüz kombin oluşturmadın'}
              </Text>
              <PressableScale
                style={styles.button}
                onPress={action}
                accessibilityRole="button"
                accessibilityLabel={actionTitle}
              >
                <Text style={styles.buttonText}>{actionTitle}</Text>
              </PressableScale>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ width: cardWidth, height: cardHeight }}>
              {item.kind === 'add' ? (
                <DolapAddCard width={cardWidth} outfit={!isClothes} />
              ) : item.kind === 'product' ? (
                <DolapProductCard
                  item={item.item}
                  width={cardWidth}
                  favorite={!item.wardrobe}
                  wardrobe={item.wardrobe}
                  imageHeight={cardHeight - 66}
                  swipeEnabled={false}
                  onTryOn={
                    item.wardrobe
                      ? (product) => openWardrobeEditor(product.id)
                      : setTryOnProduct
                  }
                  onOpenStore={(product) => {
                    void openProductPage(product);
                  }}
                  onSwipeDelete={confirmRemove}
                  onCombine={openOutfitCreator}
                />
              ) : (
                <View style={dolapCardStyles.card}>
                  <OutfitCover
                    outfit={item.outfit}
                    style={dolapCardStyles.image}
                  />
                  <View style={dolapCardStyles.metaCopy}>
                    <Text style={dolapCardStyles.title} numberOfLines={1}>
                      {item.outfit.title}
                    </Text>
                    <Text style={dolapCardStyles.category}>
                      {item.outfit.wardrobeItemIds.length +
                        item.outfit.catalogProductIds.length}{' '}
                      parça
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}
        />
      )}
      <VirtualTryOnModal
        visible={tryOnProduct !== null}
        product={tryOnProduct}
        onClose={() => setTryOnProduct(null)}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.xl, gap: GRID_GAP },
  row: { gap: GRID_GAP },
  empty: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyContent: { alignItems: 'center', gap: spacing.lg },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  button: {
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: radius.button,
    alignItems: 'center',
  },
  buttonText: { color: colors.inverseText, fontWeight: '700' },
});
