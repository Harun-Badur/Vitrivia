import { getSupabaseClient } from '../lib/supabase';
import type { SavedOutfit } from '../types/wardrobe';

export interface OutfitCoverPart {
  key: string;
  source: 'wardrobe' | 'catalog';
  sourceId: string;
  imageUrl?: string;
}
type ImageRelation = { image_url?: string } | { image_url?: string }[] | null;
interface OutfitItemRow {
  id: string;
  source_type: 'wardrobe' | 'catalog';
  wardrobe_item_id: string | null;
  product_id: string | null;
  wardrobe_item: ImageRelation;
  product: ImageRelation;
}
const relationImage = (value: ImageRelation): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.image_url;

// Read-only resolution for cover rendering; the existing save flow is unchanged.
export async function fetchOutfitCoverParts(
  outfit: SavedOutfit,
  local: OutfitCoverPart[],
): Promise<OutfitCoverPart[]> {
  const client = getSupabaseClient();
  if (!client) return local;
  if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(outfit.id)) {
    const result = await client
      .from('outfit_items')
      .select(
        'id,source_type,wardrobe_item_id,product_id,position,wardrobe_item:wardrobe_items(image_url),product:products(image_url)',
      )
      .eq('outfit_id', outfit.id)
      .order('position', { ascending: true });
    if (result.error) throw result.error;
    if (result.data?.length)
      return (result.data as unknown as OutfitItemRow[]).map((row) => ({
        key: row.id,
        source: row.source_type,
        sourceId:
          (row.source_type === 'wardrobe'
            ? row.wardrobe_item_id
            : row.product_id) ?? row.id,
        imageUrl: relationImage(
          row.source_type === 'wardrobe' ? row.wardrobe_item : row.product,
        ),
      }));
  }
  const unresolved = local.filter((part) => !part.imageUrl);
  const images = new Map<string, string>();
  await Promise.all(
    (['catalog', 'wardrobe'] as const).map(async (source) => {
      const ids = unresolved
        .filter((part) => part.source === source)
        .map((part) => part.sourceId);
      // Local photo IDs are not UUIDs and must never be sent to the remote wardrobe table.
      const remoteIds =
        source === 'wardrobe'
          ? ids.filter((id) =>
              /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id),
            )
          : ids;
      if (!remoteIds.length) return;
      const result = await client
        .from(source === 'catalog' ? 'products' : 'wardrobe_items')
        .select('id,image_url')
        .in('id', remoteIds);
      if (result.error) throw result.error;
      for (const row of result.data ?? [])
        if (typeof row.image_url === 'string')
          images.set(`${source}:${row.id}`, row.image_url);
    }),
  );
  return local.map((part) => ({
    ...part,
    imageUrl: part.imageUrl ?? images.get(`${part.source}:${part.sourceId}`),
  }));
}
