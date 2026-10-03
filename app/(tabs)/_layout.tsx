import { useEffect } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Compass, Heart, Shirt, User } from 'lucide-react-native';
import { TAB_TRANSITION_MS } from '../../lib/motion';
import { colors, layout, spacing } from '../../lib/theme';

const ACTIVE_COLOR = colors.accent;
const INACTIVE_COLOR = colors.tabInactive;
const ICON_SIZE = 25;
const TAB_CONTENT_HEIGHT = 46;

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomInset =
    insets.bottom > 0 ? insets.bottom : layout.tabBarFallbackPadding;

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        // Gidilecek bir geçmiş varsa navigator kendi davranışını uygulasın.
        // Kök sekmedeyken geri tuşu uygulamadan çıkmasın.
        return !router.canGoBack();
      },
    );

    return () => {
      subscription.remove();
    };
  }, [router]);

  return (
    <Tabs
      backBehavior="history"
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarStyle: [
          styles.bar,
          {
            height: TAB_CONTENT_HEIGHT + bottomInset,
            paddingBottom: bottomInset,
          },
        ],
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        sceneStyle: styles.scene,
        animation: 'shift',
        transitionSpec: {
          animation: 'timing',
          config: { duration: TAB_TRANSITION_MS },
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Keşfet',
          tabBarIcon: ({ color }) => <Compass color={color} size={ICON_SIZE} />,
        }}
      />
      <Tabs.Screen
        name="style"
        options={{
          title: 'Favoriler',
          tabBarIcon: ({ color }) => <Heart color={color} size={ICON_SIZE} />,
        }}
      />
      <Tabs.Screen
        name="liked"
        options={{
          title: 'Dolap',
          tabBarIcon: ({ color }) => <Shirt color={color} size={ICON_SIZE} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color }) => <User color={color} size={ICON_SIZE} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.input,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 4,
    paddingHorizontal: spacing.sm,
  },
  item: {
    paddingVertical: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  scene: {
    backgroundColor: colors.bgSoft,
  },
});
