import { ActivityIndicator, Text } from 'react-native';
import { useCompanion } from '../components/CompanionProvider';
import { PairingScreen } from '../components/PairingScreen';
import { AttentionScreen } from '../components/AttentionScreen';
import { Screen, Card, colors } from '../components/ui';

export default function HomeScreen() {
  const { state } = useCompanion();
  if (state.status === 'idle' && !state.snapshot) {
    return <PairingScreen />;
  }
  if (state.status === 'pairing' && !state.sas) {
    return <Screen><Card><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.text }}>Connecting to your computer…</Text></Card></Screen>;
  }
  if ((state.status === 'awaiting_owner' || state.status === 'error') && !state.snapshot) {
    return <PairingScreen />;
  }
  return <AttentionScreen />;
}
