import {
  DEFAULT_FEED_MODE,
  type FeedMode,
} from '../types/recommendation';

/** Ranking modes plus search for impression telemetry only. */
export type TelemetryFeedMode = FeedMode | 'search';

let lastRecommendationId: string | null = null;
let lastFeedMode: TelemetryFeedMode = DEFAULT_FEED_MODE;

export const setLastRecommendationId = (id: string | null): void => {
  lastRecommendationId = id;
};

export const getLastRecommendationId = (): string | null => lastRecommendationId;

export const setLastFeedMode = (mode: TelemetryFeedMode): void => {
  lastFeedMode = mode;
};

export const getLastFeedMode = (): TelemetryFeedMode => lastFeedMode;
