import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { describeNet, formatINR } from '@/core';
import { MIN_TOUCH, radius, space, useColors } from '@/lib/theme';

export const MAX_W = 480;

export function T({ children, style, v = 'body', color, numberOfLines, selectable }: {
  children: ReactNode; style?: StyleProp<TextStyle>; v?: 'title' | 'h2' | 'body' | 'small' | 'label' | 'money' | 'big';
  color?: string; numberOfLines?: number; selectable?: boolean;
}) {
  const c = useColors();
  const base = ({
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
    h2: { fontSize: 18, fontWeight: '700' },
    body: { fontSize: 16, lineHeight: 22 },
    small: { fontSize: 14, lineHeight: 19 },
    label: { fontSize: 14, fontWeight: '600' },
    money: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
    big: { fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  } as Record<string, TextStyle>)[v];
  return (
    <Text selectable={selectable} numberOfLines={numberOfLines} style={[{ color: color ?? (v === 'small' || v === 'label' ? c.muted : c.text) }, base, style]}>
      {children}
    </Text>
  );
}

export function Screen({ children, title, back = true, right, scroll = true, footer }: {
  children: ReactNode; title?: string; back?: boolean; right?: ReactNode; scroll?: boolean; footer?: ReactNode;
}) {
  const c = useColors();
  const body = (
    <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', padding: space(4), gap: space(3), flexGrow: 1 }}>{children}</View>
  );
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {title !== undefined && (
          <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(2), minHeight: 56, gap: space(1) }}>
            {back ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
                <T v="h2" color={c.primary}>‹</T>
              </Pressable>
            ) : <View style={{ width: space(2) }} />}
            <T v="h2" style={{ flex: 1 }} numberOfLines={1}>{title}</T>
            {right}
          </View>
        )}
        <OfflineBanner />
        {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: space(8) }} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
        {footer && <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center', padding: space(4), paddingTop: space(2), borderTopWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  const c = useColors();
  const st = [{ backgroundColor: c.surface, borderRadius: radius.m, borderWidth: 1, borderColor: c.border, padding: space(4), gap: space(2) }, style];
  if (!onPress) return <View style={st}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [st, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, style, small, label }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal'; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean; label?: string;
}) {
  const c = useColors();
  const bg = { primary: c.accent, teal: c.primary, secondary: 'transparent', ghost: 'transparent', danger: c.dangerBg }[variant];
  const fg = { primary: c.onAccent, teal: c.onPrimary, secondary: c.primary, ghost: c.primary, danger: c.danger }[variant];
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress}
      style={({ pressed }) => [{
        minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, borderRadius: radius.s, paddingHorizontal: small ? space(3) : space(5), alignItems: 'center', justifyContent: 'center',
        backgroundColor: bg, borderWidth: variant === 'secondary' ? 1.5 : 0, borderColor: c.primary, opacity: off ? 0.5 : pressed ? 0.8 : 1, flexDirection: 'row', gap: space(2),
      }, style]}>
      {loading && <ActivityIndicator color={fg} />}
      <Text style={{ color: fg, fontSize: small ? 15 : 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, right, style, ...p }: TextInputProps & { label: string; error?: string | null; hint?: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ gap: space(1) }, style]}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: radius.s, borderWidth: 1.5, borderColor: error ? c.danger : c.border }}>
        <TextInput accessibilityLabel={label} placeholderTextColor={c.muted}
          style={{ flex: 1, minHeight: MIN_TOUCH, paddingHorizontal: space(3), fontSize: 16, color: c.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : null) }} {...p} />
        {right}
      </View>
      {error ? <T v="small" color={c.danger}>{error}</T> : hint ? <T v="small">{hint}</T> : null}
    </View>
  );
}

export function PasswordField(p: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const [show, setShow] = useState(false);
  const c = useColors();
  return (
    <Field {...p} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
      right={<Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow(!show)}
        style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(3), justifyContent: 'center' }}><T v="label" color={c.primary}>{show ? 'Hide' : 'Show'}</T></Pressable>} />
  );
}

export function Segmented<K extends string>({ options, value, onChange, label }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label?: string }) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.s, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)}
            style={{ flex: 1, minHeight: 44, borderRadius: radius.s - 2, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: c.border }}>
            <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '700' : '500', fontSize: 15 }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!selected }} accessibilityLabel={label} onPress={onPress}
      style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(4), borderRadius: 999, justifyContent: 'center', borderWidth: 1.5, borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.owedBg : c.surface }}>
      <Text style={{ color: selected ? c.primary : c.text, fontWeight: selected ? '700' : '500', fontSize: 15 }}>{selected ? '✓ ' : ''}{label}</Text>
    </Pressable>
  );
}

/** Money direction in words, with colour and an arrow only as extra signals. */
export function NetText({ net, style, big, who }: { net: number; style?: StyleProp<TextStyle>; big?: boolean; who?: string }) {
  const c = useColors();
  const d = describeNet(net);
  const color = d.direction === 'owe' ? c.owe : d.direction === 'owed' ? c.owed : c.muted;
  const arrow = d.direction === 'owe' ? '↑ ' : d.direction === 'owed' ? '↓ ' : '✓ ';
  const words = who ? d.words.replace(/^you are/, `${who} is`).replace(/^you owe/, `${who} owes`).replace(/^you are settled/, `${who} is settled`) : d.words;
  return <T v={big ? 'h2' : 'money'} color={color} style={style}>{arrow}{words}</T>;
}

export function Money({ p, style, color }: { p: number; style?: StyleProp<TextStyle>; color?: string }) {
  return <T v="money" style={style} color={color}>{formatINR(p)}</T>;
}

export function Avatar({ name, url, size = 40 }: { name?: string | null; url?: string | null; size?: number }) {
  const c = useColors();
  const initials = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface2 }} accessibilityLabel={name ?? 'photo'} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.owedBg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.primary, fontWeight: '800', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  const c = useColors();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.dangerBg, borderRadius: radius.s, padding: space(3), gap: space(2) }}>
      <T color={c.danger}>{message}</T>
      {onRetry && <Button title="Try again" variant="ghost" small onPress={onRetry} style={{ alignSelf: 'flex-start' }} />}
    </View>
  );
}

export function InfoBox({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok' }) {
  const c = useColors();
  const bg = tone === 'warn' ? c.oweBg : tone === 'ok' ? c.owedBg : c.surface2;
  return <View style={{ backgroundColor: bg, borderRadius: radius.s, padding: space(3), gap: space(2) }}>{children}</View>;
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: space(8), gap: space(3) }}>
      <T v="h2" style={{ textAlign: 'center' }}>{title}</T>
      {text && <T style={{ textAlign: 'center' }} color={undefined}>{text}</T>}
      {action}
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return <View style={{ padding: space(8), alignItems: 'center' }}><ActivityIndicator color={c.primary} size="large" accessibilityLabel="Loading" /></View>;
}

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: MAX_W, backgroundColor: c.bg, borderTopLeftRadius: radius.l, borderTopRightRadius: radius.l, padding: space(4), gap: space(3), maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T v="h2" style={{ flex: 1 }}>{title}</T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
              <T v="h2" color={c.muted}>✕</T>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space(3), paddingBottom: space(4) }}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

// Imported lazily to avoid a cycle with lib modules that import ui.
import { OfflineBanner } from './OfflineBanner';
