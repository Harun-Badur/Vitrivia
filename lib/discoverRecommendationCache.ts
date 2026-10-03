import type { Product } from '../types/product';
import type { WardrobeItemForCandidate } from '../src/intelligence/outfits/outfitCandidate';
import type { OutfitDiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { hydrateFinal } from '../src/recommendationCache/codec';
import { fingerprint, RECOMMENDATION_ENGINE_VERSION } from '../src/recommendationCache/fingerprint';
import { anchorContext, type FeedPacketRequest, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';

interface Entry { product: Product; result: readonly OutfitDiscoverRecommendation[]; exposure: ReadonlyMap<string, number> }
let nextSession = 0;
/** Only packet ingestion hydrates/hashes. Gesture-time reads never compute/fetch. */
export class DiscoverRecommendationCache {
  readonly sessionId = `discover-${++nextSession}`;
  readonly exposure = new Map<string, number>();
  readonly shown = new Set<string>();
  private readonly entries = new Map<string, Entry[]>();
  private readonly pinned = new Map<string, Entry>();
  private generation = 0;
  readonly contextFingerprint: string;
  constructor(readonly catalog: readonly Product[], readonly wardrobe: readonly WardrobeItemForCandidate[], owner: string | null) {
    this.contextFingerprint = fingerprint([owner, RECOMMENDATION_ENGINE_VERSION, catalog, wardrobe]);
  }
  request(anchors: readonly Product[], generation: number): FeedPacketRequest {
    this.generation = generation;
    return { sessionId: this.sessionId, generation, contextFingerprint: this.contextFingerprint,
      candidatePool: this.catalog, wardrobeItems: this.wardrobe, anchors: [...anchors],
      exposure: [...this.exposure], shownAnchorIds: [...this.shown],
      reusableAnchorIds: anchors.filter(product => this.pinned.get(product.id)?.product === product).map(product => product.id) };
  }
  accept(packet: RecommendationFeedPacket, anchors: readonly Product[]): boolean {
    if (!packet || !Array.isArray(packet.entries) || packet.sessionId !== this.sessionId ||
      packet.generation !== this.generation || packet.contextFingerprint !== this.contextFingerprint) return false;
    const products = new Map(anchors.map(product => [product.id, product]));
    let accepted = false;
    for (const item of packet.entries) {
      if (!item || typeof item.anchorProductId !== 'string' || typeof item.serialized !== 'string' ||
        !Array.isArray(item.exposure) || item.exposure.some(entry => !Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== 'string' || typeof entry[1] !== 'number' || !Number.isFinite(entry[1]))) continue;
      const product = products.get(item.anchorProductId);
      if (!product || this.pinned.get(product.id)?.product === product) continue;
      const exposure = new Map(item.exposure);
      const result = hydrateFinal(item.serialized, anchorContext(this.catalog, product, this.wardrobe, exposure, item.catalogVersion));
      if (result.status !== 'hit') continue;
      const entry = { product, result: result.value, exposure };
      const entries = this.entries.get(product.id) ?? [];
      entries.push(entry); this.entries.set(product.id, entries); accepted = true;
    }
    return accepted;
  }
  private find(product: Product): Entry | undefined {
    const pinned = this.pinned.get(product.id);
    if (pinned?.product === product) return pinned;
    return this.entries.get(product.id)?.find(entry => entry.product === product && (this.shown.has(product.id) ||
      (entry.exposure.size === this.exposure.size && [...entry.exposure].every(([id, count]) => this.exposure.get(id) === count))));
  }
  lookup(product: Product): readonly OutfitDiscoverRecommendation[] | undefined { return this.find(product)?.result; }
  activate(product: Product): void {
    const entry = this.find(product);
    if (!entry) return; // A miss is not a displayed valid empty engine result.
    this.pinned.set(product.id, entry);
    if (this.shown.has(product.id)) return;
    this.shown.add(product.id);
    for (const recommended of complementaryProductsForDisplay(entry.result, product.id)) {
      this.exposure.set(recommended.id, (this.exposure.get(recommended.id) ?? 0) + 1);
    }
  }
}
