import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const colors = {
  background: '#0b0d12',
  panel: '#141821',
  nested: '#1b2130',
  border: '#2b3345',
  text: '#edf2ff',
  muted: '#98a4ba',
  accent: '#79a7ff',
  success: '#58c895',
  warning: '#e5b567',
  danger: '#ef7f87'
};

export function Screen({ children }: { children: ReactNode }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>{children}</ScrollView>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PrimaryButton({ title, onPress, disabled, danger }: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, danger && styles.dangerButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function StatusPill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'success' | 'warning' | 'danger' }) {
  return <View style={[styles.pill, { borderColor: colors[tone] }]}><Text style={[styles.pillText, { color: colors[tone] }]}>{label}</Text></View>;
}

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionText}>{title}</Text>{detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  button: { backgroundColor: colors.accent, borderRadius: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  dangerButton: { backgroundColor: '#6c3039' },
  buttonText: { color: '#07101f', fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '600' },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 },
  sectionText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sectionDetail: { color: colors.muted, fontSize: 12 }
});
