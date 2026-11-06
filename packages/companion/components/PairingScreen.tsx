import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCompanion } from './CompanionProvider';
import { Card, PrimaryButton, Screen, SectionTitle, colors } from './ui';

export function PairingScreen() {
  const { state, pair } = useCompanion();
  const [permission, requestPermission] = useCameraPermissions();
  const [deviceName, setDeviceName] = useState('My phone');
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (value: string) => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError(undefined);
    try { await pair(value.trim(), deviceName); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'COMPANION_PAIRING_REJECTED'); }
    finally { setBusy(false); }
  };

  if (state.sas) {
    return (
      <Screen>
        <SectionTitle title="Confirm on your computer" detail="Pairing is not active yet" />
        <Card>
          <Text style={styles.title}>Compare this six-digit code</Text>
          <Text style={styles.sas}>{state.sas}</Text>
          <Text style={styles.body}>Only confirm if the code matches the ForgeBadger Web console, along with the device name and project permissions.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionTitle title="Pair this device" detail="No account password required" />
      <Card>
        <Text style={styles.label}>Device name</Text>
        <TextInput value={deviceName} onChangeText={setDeviceName} maxLength={80} style={styles.input} placeholderTextColor={colors.muted} />
      </Card>
      <Card>
        <Text style={styles.title}>Scan the computer QR code</Text>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              setQr(data);
              void submit(data);
            }}
          />
        ) : (
          <PrimaryButton title="Allow camera access" onPress={() => void requestPermission()} />
        )}
      </Card>
      <Card>
        <Text style={styles.label}>Or paste the QR payload</Text>
        <TextInput
          value={qr}
          onChangeText={setQr}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Development and simulator fallback"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.qrInput]}
        />
        <PrimaryButton title={busy ? 'Pairing…' : 'Pair with computer'} disabled={busy || !qr.trim() || !deviceName.trim()} onPress={() => void submit(qr)} />
      </Card>
      {state.error || error ? <View style={styles.errorBox}><Text style={styles.error}>{state.error ?? error}</Text></View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  body: { color: colors.muted, lineHeight: 21 },
  label: { color: colors.muted, fontSize: 13 },
  input: { color: colors.text, backgroundColor: colors.nested, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 44 },
  qrInput: { minHeight: 90, textAlignVertical: 'top' },
  camera: { height: 300, borderRadius: 10, overflow: 'hidden' },
  sas: { color: colors.accent, fontSize: 48, fontWeight: '800', letterSpacing: 10, textAlign: 'center', paddingVertical: 20 },
  errorBox: { backgroundColor: '#3c2028', borderRadius: 8, padding: 12 },
  error: { color: colors.danger }
});
