import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

// Render only the decorative artwork from the supplied UI reference.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const REFERENCE = require('../assets/profile-style-reference.png') as number;
export const STYLE_ART = {
  minimal: [76, 129, 126, 82],
  street: [76, 258, 126, 82],
  classic: [361, 129, 126, 82],
  sport: [219, 258, 126, 82],
  summary: [1235, 617, 228, 144],
} as const;

export default function StyleReferenceArt({
  crop,
}: {
  crop: readonly [number, number, number, number];
}) {
  const [width, setWidth] = useState(0);
  const [x, y, cropWidth, cropHeight] = crop;
  const scale = width / cropWidth;
  return (
    <View
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{
        width: '100%',
        aspectRatio: cropWidth / cropHeight,
        overflow: 'hidden',
      }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={REFERENCE}
        contentFit="fill"
        style={{
          position: 'absolute',
          width: 1536 * scale,
          height: 1024 * scale,
          left: -x * scale,
          top: -y * scale,
        }}
      />
    </View>
  );
}
