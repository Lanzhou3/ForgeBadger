import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCompanion } from '../../components/CompanionProvider';
import { Card, PrimaryButton, Screen, SectionTitle, StatusPill, colors } from '../../components/ui';

export default function ApprovalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, executeCommand } = useCompanion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const approval = state.snapshot?.approvals.find(item => item.id === id);
  if (!approval) {
    return <Screen><Card><Text style={styles.title}>Approval is no longer pending</Text><Text style={styles.body}>Refresh to see the canonical result. Old decisions cannot be replayed.</Text></Card></Screen>;
  }
  const exactInput = JSON.stringify(approval.input, null, 2) ?? 'null';
  const canDecide = approval.decisionAllowed && state.status === 'online' && !busy;

  const decide = async (approved: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      if (approved) {
        const [hardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync()
        ]);
        if (!hardware || !enrolled) throw new Error('DEVICE_AUTHENTICATION_UNAVAILABLE');
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Approve this exact ForgeBadger action',
          cancelLabel: 'Cancel',
          disableDeviceFallback: false
        });
        if (!result.success) throw new Error('DEVICE_AUTHENTICATION_REQUIRED');
      }
      const receipt = await executeCommand('approval.decide', {
        runId: approval.runId,
        actionId: approval.id,
        approved,
        inputDigest: approval.inputDigest
      });
      if (receipt.status !== 'succeeded') setError(receipt.errorCode ?? receipt.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'COMPANION_COMMAND_UNKNOWN');
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <SectionTitle title={approval.tool} detail="Exact approval" />
      <Card>
        <StatusPill label={approval.decisionAllowed ? 'FULL INPUT' : 'READ ONLY'} tone={approval.decisionAllowed ? 'warning' : 'danger'} />
        <Text style={styles.body}>Review every parameter. Approval binds this input digest and the current device/project authority.</Text>
        <Text style={styles.digest}>{approval.inputDigest}</Text>
      </Card>
      <Card>
        <Text style={styles.title}>Parameters</Text>
        <Text style={styles.input}>{exactInput}</Text>
      </Card>
      {!approval.decisionAllowed ? <Card><Text style={styles.error}>This input is incomplete or too large for mobile approval. Use the Web console.</Text></Card> : null}
      {error ? <Card><Text style={styles.error}>{error}</Text></Card> : null}
      <View style={styles.actions}>
        <View style={styles.action}><PrimaryButton title={busy ? 'Working…' : 'Reject'} danger disabled={!canDecide} onPress={() => void decide(false)} /></View>
        <View style={styles.action}><PrimaryButton title={busy ? 'Working…' : 'Authenticate & approve'} disabled={!canDecide} onPress={() => void decide(true)} /></View>
      </View>
      {state.lastReceipt ? <Card><Text style={styles.body}>Last command: {state.lastReceipt.status} · effect {state.lastReceipt.effectStatus}</Text></Card> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  body: { color: colors.muted, lineHeight: 20 },
  digest: { color: colors.accent, fontSize: 11, lineHeight: 17 },
  input: { color: colors.text, backgroundColor: colors.nested, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 10, fontFamily: 'monospace', fontSize: 12, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  error: { color: colors.danger }
});
