import { Stack } from 'expo-router';
import { CompanionProvider } from '../components/CompanionProvider';
import { colors } from '../components/ui';

export default function RootLayout() {
  return (
    <CompanionProvider>
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.panel },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background }
      }}>
        <Stack.Screen name="index" options={{ title: 'ForgeBadger' }} />
        <Stack.Screen name="goals/[id]" options={{ title: 'Goal detail' }} />
        <Stack.Screen name="approvals/[id]" options={{ title: 'Approval detail' }} />
      </Stack>
    </CompanionProvider>
  );
}
