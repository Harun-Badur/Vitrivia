import { memo, useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import DiscoverProductImage from './DiscoverProductImage';
import { Check, Heart } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';
import {
  formatTryPrice,
  getDisplayPrice,
  getProductImages,
  type Product,
} from '../types/product';
import type { DiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';

interface DiscoverRecommendationsProps {
  currentProductId: string | null;
  recommendations?: readonly DiscoverRecommendation[];
  selectedProductIds?: readonly string[];
  onSelectProduct?: (product: Product) => void;
}

// UI container measurements from the approved reference, independent of bitmap fitting.
const REFERENCE_CARD_IMAGE_WIDTH = 253;
const REFERENCE_CARD_IMAGE_HEIGHT = 180;
const REFERENCE_SCREEN_HEIGHT = 1844;
const CARD_INFO_HEIGHT = 38;

export { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';

function DiscoverRecommendations({
  currentProductId,
  recommendations = [],
  selectedProductIds = [],
  onSelectProduct,
}: DiscoverRecommendationsProps) {
  const { width, height } = useWindowDimensions();
  const columnWidth = (width - spacing.lg * 2 - spacing.sm * 2) / 3;
  const imageHeight = Math.round(
    Math.min(
      ((columnWidth - 2) * REFERENCE_CARD_IMAGE_HEIGHT) /
        REFERENCE_CARD_IMAGE_WIDTH,
      (height * REFERENCE_CARD_IMAGE_HEIGHT) / REFERENCE_SCREEN_HEIGHT,
    ),
  );
  const products = useMemo(() => complementaryProductsForDisplay(
    recommendations, currentProductId,
  ), [recommendations, currentProductId]);

  return (
    <View style={styles.section}>
      <View style={styles.divider} />
      <View style={styles.headingRow}>
        <Text style={styles.heading} numberOfLines={1}>
          Tarzını tamamlayan parçalar
        </Text>
      </View>
      {products.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            Bu ürün için henüz tamamlayıcı parça önerisi yok.
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          {[0, 1, 2].map((index) => {
            const product = products[index];
            if (!product)
              return <View key={`space-${index}`} style={styles.column} />;
            const selected = selectedProductIds.includes(product.id);
            const imageUrl = getProductImages(product)[0];
            return (
              <View key={product.id} style={styles.column}>
                <View
                  style={styles.card}
                  testID={`discover-recommendation-card-${product.id}`}
                >
                  <View
                    style={[styles.imageWrap, { height: imageHeight }]}
                    testID={`discover-recommendation-image-${product.id}`}
                  >
                    {imageUrl ? (
                      <DiscoverProductImage
                        uri={imageUrl}
                        slot="recommendation"
                        style={StyleSheet.absoluteFill}
                        cachePolicy="memory-disk"
                        accessibilityLabel={product.title}
                      />
                    ) : null}
                    {onSelectProduct ? (
                      <PressableScale
                        onPress={() => onSelectProduct(product)}
                        style={styles.selectionHit}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={`${product.title} seç`}
                      >
                        <View
                          style={[
                            styles.selection,
                            selected && styles.selectionActive,
                          ]}
                        >
                          {selected ? (
                            <Check size={16} color={colors.inverseText} />
                          ) : (
                            <Heart size={16} color={colors.text} />
                          )}
                        </View>
                      </PressableScale>
                    ) : null}
                  </View>
                  <View
                    style={styles.info}
                    testID={`discover-recommendation-info-${product.id}`}
                  >
                    <View style={styles.brandPriceRow}>
                      <Text
                        style={styles.brand}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {product.brand}
                      </Text>
                      <Text
                        style={styles.price}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                      >
                        {formatTryPrice(getDisplayPrice(product))}
                      </Text>
                    </View>
                    <Text
                      style={styles.title}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {product.subcategory ?? product.title}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export default memo(DiscoverRecommendations);

const styles = StyleSheet.create({
  section: {
    flexShrink: 0,
    backgroundColor: colors.input,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  divider: {
    position: 'absolute',
    top: 0,
    left: spacing.lg,
    right: spacing.lg,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 4,
  },
  heading: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  column: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    backgroundColor: colors.input,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    overflow: 'hidden',
  },
  imageWrap: {
    width: '100%',
    backgroundColor: colors.surface,
  },
  info: {
    height: CARD_INFO_HEIGHT,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: colors.input,
  },
  brandPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 3,
  },
  brand: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: colors.text,
  },
  title: { fontSize: 10, lineHeight: 14, color: colors.textSecondary },
  price: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: colors.text,
    maxWidth: '57%',
  },
  swatches: { flexDirection: 'row', gap: spacing.xs, marginTop: 2 },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectionHit: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selection: {
    width: 24,
    height: 24,
    borderRadius: radius.chip,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionActive: {
    backgroundColor: colors.accent,
    borderColor: colors.input,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
