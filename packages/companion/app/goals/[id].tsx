import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useCompanion } from '../../components/CompanionProvider';
import { Card, PrimaryButton, Screen, SectionTitle, StatusPill, colors } from '../../components/ui';

export default function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, executeCommand } = useCompanion();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const snapshot = state.snapshot;
  const goal = snapshot?.goals.find(item => item.id === id);
  if (!goal) {
    return <Screen><Card><Text style={styles.title}>Goal not in the current snapshot</Text><Text style={styles.body}>It may be outside this device's project scope or the snapshot may be stale.</Text></Card></Screen>;
  }
  const project = snapshot?.projects.find(item => item.id === goal.projectId);
  const sessions = snapshot?.sessions.filter(session => session.projectId === goal.projectId) ?? [];
  const canCommand = state.status === 'online' && !busy;

  const run = async (type: string, payload: unknown) => {
    setBusy(true);
    setError(undefined);
    try {
      const receipt = await executeCommand(type, payload);
      if (receipt.status !== 'succeeded') setError(receipt.errorCode ?? receipt.status);
      setAnswer('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'COMPANION_COMMAND_UNKNOWN');
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <SectionTitle title={goal.title} detail={project?.name ?? goal.projectId} />
      <Card>
        <StatusPill label={goal.status.toUpperCase()} tone={goal.status === 'completed' ? 'success' : goal.status === 'blocked' ? 'warning' : 'muted'} />
        <Text style={styles.progress}>{goal.taskPasses}/{goal.taskTotal} tasks verified</Text>
        <Text style={styles.body}>Last updated {new Date(goal.updatedAt).toLocaleString()}</Text>
      </Card>
      {goal.pendingQuestion ? (
        <Card>
          <Text style={styles.title}>Answer needed</Text>
          <Text style={styles.question}>{goal.pendingQuestion}</Text>
          <TextInput
            value={answer}
            onChangeText={setAnswer}
            multiline
            maxLength={4000}
            placeholder="Answer the exact question"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <PrimaryButton title={busy ? 'Submitting…' : 'Submit answer'} disabled={!canCommand || !answer.trim()} onPress={() => void run('goal.answer', { goalId: goal.id, answer })} />
        </Card>
      ) : null}
      {goal.blockedReason ? <Card><Text style={styles.title}>Blocked reason</Text><Text style={styles.body}>{goal.blockedReason}</Text></Card> : null}
      {goal.status === 'active' || goal.status === 'paused' || goal.status === 'blocked' ? (
        <Card>
          <Text style={styles.title}>Goal controls</Text>
          <View style={styles.controlRow}>
            {goal.status === 'active' ? <View style={styles.control}><PrimaryButton title="Pause" disabled={!canCommand} onPress={() => void run('goal.pause', { goalId: goal.id })} /></View> : null}
            {goal.status === 'paused' ? <View style={styles.control}><PrimaryButton title="Resume" disabled={!canCommand} onPress={() => void run('goal.resume', { goalId: goal.id })} /></View> : null}
            <View style={styles.control}><PrimaryButton title="Cancel goal" danger disabled={!canCommand} onPress={() => {
              Alert.alert('Cancel goal', 'Cancellation does not undo changes already made.', [
                { text: 'Keep goal', style: 'cancel' },
                { text: 'Cancel goal', style: 'destructive', onPress: () => void run('goal.cancel', { goalId: goal.id }) }
              ]);
            }} /></View>
          </View>
        </Card>
      ) : null}
      {error ? <Card><Text style={styles.error}>{error}</Text></Card> : null}
      {state.lastReceipt ? <Card><Text style={styles.body}>Last command: {state.lastReceipt.status} · effect {state.lastReceipt.effectStatus}</Text></Card> : null}
      <SectionTitle title="Sessions" detail={String(sessions.length)} />
      {sessions.map(session => (
        <Card key={session.id}>
          <Text style={styles.title}>{session.name}</Text>
          <Text style={styles.body}>{session.aiTool} · {session.status}</Text>
        </Card>
      ))}
      <Card><Text style={styles.body}>Cancellation does not roll back writes. Verification and owner acceptance remain separate states.</Text></Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  body: { color: colors.muted, lineHeight: 20 },
  progress: { color: colors.accent, fontSize: 22, fontWeight: '700' },
  question: { color: colors.text, fontSize: 17, lineHeight: 25 },
  input: { color: colors.text, backgroundColor: colors.nested, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 100, textAlignVertical: 'top' },
  controlRow: { flexDirection: 'row', gap: 10 },
  control: { flex: 1 },
  error: { color: colors.danger }
});
