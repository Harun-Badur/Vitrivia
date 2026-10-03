import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';

// Public logo assets published by each brand's official website.
const BRANDS: Record<string, { domain: string; logo?: string }> = {
  mavi: {
    domain: 'mavi.com',
    logo: 'https://eu.mavi.com/cdn/shop/files/Mavi_Logo_Onlineshop.png?v=1694590003',
  },
  koton: {
    domain: 'koton.com',
    logo: 'https://054308f5.cdn.akinoncloud.com/static_omnishop/2026-09-30.1-prod/img/logo.svg',
  },
  defacto: {
    domain: 'defacto.com.tr',
    logo: 'https://dfcdn.defacto.com.tr/AssetsV2/dist/img/defacto-logo-black.svg',
  },
  derimod: {
    domain: 'derimod.com.tr',
    logo: 'https://derimod.com.tr/cdn/shop/files/Derimod_Logo_Siyah-01.png?v=1681276419',
  },
  boyner: {
    domain: 'boyner.com.tr',
    logo: 'https://boyner-stook-frontend.mncdn.com/web-ui/logo.svg',
  },
  'jack & jones': {
    domain: 'jackjones.com',
    logo: 'https://www.jackjones.com/apple-touch-icon.png',
  },
  nike: {
    domain: 'nike.com',
    logo: 'https://www.nike.com/apple-touch-icon.png',
  },
  puma: {
    domain: 'puma.com',
    logo: 'https://tr.puma.com/static/version1790252721/frontend/Oggetto/Puma/tr_TR/images/logo.svg',
  },
  zara: { domain: 'zara.com', logo: 'https://www.zara.com/favicon.ico' },
  adidas: { domain: 'adidas.com' },
};

export function getStyleBrandLogo(brand: string): string | undefined {
  const entry = BRANDS[brand.trim().toLowerCase()];
  return entry?.logo;
}

function RemoteLogo({ brand, uri }: { brand: string; uri?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.frame}>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
          accessibilityLabel={`${brand} logosu`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={styles.fallback} numberOfLines={2}>
          {brand}
        </Text>
      )}
    </View>
  );
}

export default function StyleBrandLogo({ brand }: { brand: string }) {
  const uri = getStyleBrandLogo(brand);
  return <RemoteLogo key={`${brand}:${uri ?? ''}`} brand={brand} uri={uri} />;
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '90%', height: 30 },
  fallback: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
});
