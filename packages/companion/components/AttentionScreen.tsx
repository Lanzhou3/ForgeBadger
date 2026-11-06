import { Alert, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useCompanion } from './CompanionProvider';
import { isSnapshotStale } from '../src/client/protocol';
import { Card, PrimaryButton, Screen, SectionTitle, StatusPill, colors } from './ui';

export function AttentionScreen() {
  const { state, refreshing, refresh, logout } = useCompanion();
  const snapshot = state.snapshot;
  const stale = !snapshot || state.status !== 'online' || isSnapshotStale(snapshot.generatedAt, Date.now());
  const goalsNeedingAttention = snapshot?.goals.filter(goal => goal.pendingQuestion || goal.status === 'blocked') ?? [];
  const attentionCount = goalsNeedingAttention.length + (snapshot?.attention.length ?? 0) + (snapshot?.approvals.length ?? 0);

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Attention</Text>
          <Text style={styles.subtitle}>{snapshot ? `Synced ${new Date(snapshot.generatedAt).toLocaleString()}` : 'No snapshot yet'}</Text>
        </View>
        <StatusPill
          label={state.status === 'revoked' ? 'REVOKED' : stale ? 'STALE' : 'LIVE'}
          tone={state.status === 'revoked' ? 'danger' : stale ? 'warning' : 'success'}
        />
      </View>
      {state.error ? <Card><Text style={styles.error}>{state.error}</Text></Card> : null}
      <View style={styles.actions}>
        <View style={styles.action}><PrimaryButton title={refreshing ? 'Refreshing…' : 'Refresh'} disabled={refreshing || state.status === 'revoked'} onPress={() => void refresh().catch(() => undefined)} /></View>
        <View style={styles.action}><PrimaryButton title="Clear pairing" danger onPress={() => {
          Alert.alert('Clear pairing', 'Remove this device identity and encrypted local cache?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear', style: 'destructive', onPress: () => void logout() }
          ]);
        }} /></View>
      </View>

      <SectionTitle title="Needs you" detail={String(attentionCount)} />
      {goalsNeedingAttention.map(goal => (
        <Link key={goal.id} href={{ pathname: '/goals/[id]', params: { id: goal.id } }}>
          <Card>
            <Text style={styles.cardTitle}>{goal.title}</Text>
            <StatusPill label={goal.pendingQuestion ? 'ANSWER NEEDED' : 'BLOCKED'} tone="warning" />
            {goal.pendingQuestion ? <Text style={styles.body}>{goal.pendingQuestion}</Text> : <Text style={styles.body}>{goal.blockedReason ?? 'Goal is blocked'}</Text>}
          </Card>
        </Link>
      ))}
      {snapshot?.approvals.map(approval => (
        <Link key={approval.id} href={{ pathname: '/approvals/[id]', params: { id: approval.id } }}>
          <Card>
            <Text style={styles.cardTitle}>{approval.tool}</Text>
            <StatusPill label="APPROVAL NEEDED" tone="warning" />
            <Text style={styles.body}>Review exact parameters and input digest.</Text>
          </Card>
        </Link>
      ))}
      {snapshot?.attention.map(item => (
        <Card key={item.id}>
          <Text style={styles.cardTitle}>{item.category}</Text>
          <Text style={styles.body}>{item.type} · {new Date(item.createdAt).toLocaleString()}</Text>
        </Card>
      ))}
      {attentionCount === 0 ? (
        <Card><Text style={styles.cardTitle}>No action needed</Text><Text style={styles.body}>Your authorized projects have no pending attention items.</Text></Card>
      ) : null}

      <SectionTitle title="Goals" detail={String(snapshot?.goals.length ?? 0)} />
      {snapshot?.goals.map(goal => (
        <Link key={goal.id} href={{ pathname: '/goals/[id]', params: { id: goal.id } }}>
          <Card>
            <View style={styles.goalRow}>
              <Text style={styles.cardTitle}>{goal.title}</Text>
              <StatusPill label={goal.status.toUpperCase()} tone={goal.status === 'completed' ? 'success' : goal.status === 'blocked' ? 'warning' : 'muted'} />
            </View>
            <Text style={styles.body}>{goal.taskPasses}/{goal.taskTotal} tasks verified</Text>
          </Card>
        </Link>
      ))}

      <SectionTitle title="Projects" detail={String(snapshot?.projects.length ?? 0)} />
      {snapshot?.projects.map(project => (
        <Card key={project.id}>
          <Text style={styles.cardTitle}>{project.name}</Text>
          <Text style={styles.body}>{project.status} · {snapshot.sessions.filter(session => session.projectId === project.id).length} sessions</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.muted, lineHeight: 20 },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  error: { color: colors.danger }
});
