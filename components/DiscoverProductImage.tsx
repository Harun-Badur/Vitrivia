import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Image, type ImageProps, type ImageLoadEventData } from 'expo-image';
import {
  getDiscoverImageFit,
  hasImageDimensions,
  type DiscoverImageSlot,
  type ImageDimensions,
} from '../lib/discoverImageFit';

interface DiscoverProductImageProps extends Omit<
  ImageProps,
  'source' | 'contentFit' | 'contentPosition'
> {
  uri: string;
  slot: DiscoverImageSlot;
}

interface LoadedDimensions {
  uri: string;
  size: ImageDimensions;
}

/** The clipping surface stays fixed; only the bitmap is fitted inside it. */
export default function DiscoverProductImage({
  uri,
  slot,
  style,
  onLoad,
  ...imageProps
}: DiscoverProductImageProps) {
  const [viewport, setViewport] = useState<ImageDimensions>({
    width: 0,
    height: 0,
  });
  const [loaded, setLoaded] = useState<LoadedDimensions | null>(null);
  const currentUri = useRef(uri);
  useLayoutEffect(() => {
    currentUri.current = uri;
  }, [uri]);
  const fit =
    loaded?.uri === uri
      ? getDiscoverImageFit(loaded.size, viewport, slot)
      : null;

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((previous) =>
      previous.width === width && previous.height === height
        ? previous
        : { width, height },
    );
  }, []);

  const handleLoad = useCallback(
    (event: ImageLoadEventData): void => {
      if (currentUri.current !== uri) return;
      const size = { width: event.source.width, height: event.source.height };
      if (hasImageDimensions(size)) {
        setLoaded((previous) =>
          previous?.uri === uri &&
          previous.size.width === size.width &&
          previous.size.height === size.height
            ? previous
            : { uri, size },
        );
      }
      onLoad?.(event);
    },
    [uri, onLoad],
  );

  return (
    <View style={[style, styles.frame]} onLayout={handleLayout}>
      <Image
        {...imageProps}
        key={uri}
        source={{ uri }}
        style={
          fit
            ? {
                position: 'absolute',
                width: fit.width,
                height: fit.height,
                left: fit.left,
                top: fit.top,
              }
            : StyleSheet.absoluteFill
        }
        contentFit="cover"
        contentPosition="center"
        onLoad={handleLoad}
      />
    </View>
  );
}

const styles = StyleSheet.create({ frame: { overflow: 'hidden' } });
