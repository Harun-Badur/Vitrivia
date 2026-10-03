import { router, Stack } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import PressableScale from '../../components/PressableScale';
import { colors } from '../../lib/theme';

export default function WardrobeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.bg },
        contentStyle: { backgroundColor: colors.bg },
        headerLeft: () => (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Geri"
            hitSlop={12}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/liked');
            }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </PressableScale>
        ),
      }}
    />
  );
}
