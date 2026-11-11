import { router } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput,
  View, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatINR } from '@/core';
import { dismissNotice, useSync } from '@/lib/offline';
import { radius, space, type, useColors, type Colors } from '@/theme';

type Variant = keyof typeof type;

export function T({ v = 'body', color, style, children, lines, center, selectable, ...rest }: {
  v?: Variant; color?: keyof Colors; style?: StyleProp<TextStyle>; children: ReactNode; lines?: number; center?: boolean; selectable?: boolean;
} & Pick<TextProps, 'accessibilityRole' | 'accessibilityLiveRegion' | 'testID'>) {
  const c = useColors();
  return (
    <Text numberOfLines={lines} selectable={selectable} {...rest}
      style={[type[v], { color: c[color ?? 'ink'] }, center && { textAlign: 'center' }, v === 'overline' && { textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}

/** Money never wraps or truncates. */
export function Money({ paise, v = 'amount', color, style, abs }: { paise: number; v?: Variant; color?: keyof Colors; style?: StyleProp<TextStyle>; abs?: boolean }) {
  return (
    <T v={v} color={color} style={[{ flexShrink: 0, fontVariant: ['tabular-nums'] }, style]} lines={1}>
      {formatINR(abs ? Math.abs(paise) : paise)}
    </T>
  );
}

export function Screen({ title, subtitle, back, right, children, footer, scroll = true, padded = true }: {
  title?: string; subtitle?: string; back?: boolean | 'close'; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean; padded?: boolean;
}) {
  const c = useColors();
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top', 'left', 'right']}>
      {(title || back) && (
        <View style={s.header}>
          {back ? (
            <IconButton label={back === 'close' ? 'Close' : 'Back'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
              {back === 'close' ? <X color={c.ink} size={24} strokeWidth={1.75} /> : <ChevronLeft color={c.ink} size={24} strokeWidth={1.75} />}
            </IconButton>
          ) : <View style={{ width: space[2] }} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            {title ? <T v="title" lines={1}>{title}</T> : null}
            {subtitle ? <T v="caption" color="muted" lines={1}>{subtitle}</T> : null}
          </View>
          {right}
        </View>
      )}
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Body style={{ flex: 1 }} contentContainerStyle={scroll ? [padded && s.content] : undefined} keyboardShouldPersistTaps="handled">
          {scroll ? children : <View style={[{ flex: 1 }, padded && s.content]}>{children}</View>}
        </Body>
        {footer ? <SafeAreaView edges={['bottom']} style={[s.footer, { borderTopColor: c.line, backgroundColor: c.ground }]}>{footer}</SafeAreaView> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}>
      {children}
    </Pressable>
  );
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, small, icon, style }: {
  label: string; onPress?: () => void; variant?: 'primary' | 'upi' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean; loading?: boolean; small?: boolean; icon?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const palette = {
    primary: { bg: c.brand, fg: c.onBrand, border: c.brand },
    upi: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.brand, border: c.lineStrong },
    quiet: { bg: 'transparent', fg: c.brand, border: 'transparent' },
    danger: { bg: c.surface, fg: c.danger, border: c.danger },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress}
      style={({ pressed }) => [
        s.btn, small && s.btnSmall,
        { backgroundColor: disabled ? c.sunken : palette.bg, borderColor: disabled ? 'transparent' : palette.border },
        pressed && { opacity: 0.85 }, style,
      ]}>
      {loading ? <ActivityIndicator color={palette.fg} /> : icon}
      <T v={small ? 'label' : 'bodyStrong'} color={undefined} style={{ color: disabled ? c.muted : palette.fg }} lines={1}>{label}</T>
    </Pressable>
  );
}

export function Field({ label, error, help, amount, style, ...props }: TextInputProps & { label: string; error?: string | null; help?: string; amount?: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: space[1] }}>
      <T v="label">{label}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[
          amount ? type.amountLg : type.body,
          s.input, { color: c.ink, backgroundColor: c.surface, borderColor: error ? c.danger : c.lineStrong },
          style,
        ]}
        {...props}
      />
      {error ? <T v="caption" color="danger">{error}</T> : help ? <T v="caption" color="muted">{help}</T> : null}
    </View>
  );
}

export function Segmented<V extends string>({ label, options, value, onChange }: {
  label?: string; options: { value: V; label: string }[]; value: V; onChange: (v: V) => void;
}) {
  const c = useColors();
  return (
    <View style={{ gap: space[1] }}>
      {label ? <T v="label">{label}</T> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[s.seg, { backgroundColor: c.sunken }]}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
              style={[s.segItem, on && { backgroundColor: c.surface, borderColor: c.line, borderWidth: 1 }]}>
              <T v="label" color={on ? 'ink' : 'muted'} lines={1}>{o.label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type Tone = 'owed' | 'owe' | 'pending' | 'done' | 'declined' | 'settled' | 'brand';
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c = useColors();
  const m = {
    owed: [c.positiveSoft, c.positive], owe: [c.negativeSoft, c.negative], pending: [c.accentSoft, c.pending],
    done: [c.positiveSoft, c.positive], declined: [c.sunken, c.danger], settled: [c.sunken, c.muted], brand: [c.brandSoft, c.brand],
  }[tone];
  return (
    <View style={[s.pill, { backgroundColor: m[0] }]}>
      <Text style={[type.label, { color: m[1] }]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

export function Avatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const c = useColors();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[type.label, { color: c.brand, fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

export function SplitDisc({ size = 40 }: { size?: number }) {
  const c = useColors();
  const half = { width: (size - 4) / 2, height: size };
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[half, { backgroundColor: c.brand, borderTopLeftRadius: size / 2, borderBottomLeftRadius: size / 2 }]} />
      <View style={[half, { backgroundColor: c.accent, borderTopRightRadius: size / 2, borderBottomRightRadius: size / 2 }]} />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[s.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

export function Row({ children, onPress, first, label }: { children: ReactNode; onPress?: () => void; first?: boolean; label?: string }) {
  const c = useColors();
  const style = [s.row, !first && { borderTopWidth: 1, borderTopColor: c.line }];
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: c.sunken }]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T v="overline" color="muted">{title}</T>
        {right}
      </View>
      {children}
    </View>
  );
}

export function OfflineBanner() {
  const c = useColors();
  const { online, outbox, syncing, notices } = useSync();
  return (
    <>
      {(!online || syncing || outbox.length > 0) && (
        <View accessibilityRole="alert" style={[s.banner, { backgroundColor: c.sunken }]}>
          <View style={[s.dot, { backgroundColor: online ? c.accent : c.muted }]} />
          <T v="label" style={{ flex: 1 }}>{!online ? 'You are offline' : syncing ? 'Back online. Syncing…' : 'Waiting to sync'}</T>
          {outbox.length > 0 && <T v="amountSm">{outbox.length} waiting to sync</T>}
        </View>
      )}
      {notices.map((n) => (
        <View key={n.key} accessibilityRole="alert" style={[s.banner, { backgroundColor: c.accentSoft, alignItems: 'flex-start' }]}>
          <T v="label" color="pending" style={{ flex: 1 }}>{n.text}</T>
          <IconButton label="Dismiss" onPress={() => void dismissNotice(n.key)}><X color={c.pending} size={18} /></IconButton>
        </View>
      ))}
    </>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Card style={{ gap: space[3], padding: space[4] }}>
      <T color="danger">{msg}</T>
      {onRetry ? <Button label="Try again" variant="secondary" small onPress={onRetry} /> : null}
    </Card>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={{ gap: space[3] }} accessibilityLabel="Loading">
      {[0, 1, 2].map((i) => <View key={i} style={{ height: 64, borderRadius: radius.md, backgroundColor: c.sunken }} />)}
    </View>
  );
}

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={[s.sheet, { backgroundColor: c.surface }]}>
          <View style={[s.grabber, { backgroundColor: c.line }]} />
          <T v="title">{title}</T>
          {children}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingHorizontal: space[2], paddingTop: space[2], paddingBottom: space[2] },
  content: { padding: space[4], gap: space[6], paddingBottom: space[12] },
  footer: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[3], borderTopWidth: 1, gap: space[2] },
  iconBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  btn: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space[6], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  btnSmall: { minHeight: 36, paddingHorizontal: space[3] },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space[3], paddingVertical: space[2] },
  seg: { flexDirection: 'row', padding: 4, borderRadius: radius.md, gap: 4 },
  segItem: { flex: 1, minHeight: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pill: { borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1], alignSelf: 'flex-start' },
  card: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: 48 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginHorizontal: space[4], marginBottom: space[2], borderRadius: radius.md, paddingHorizontal: space[4], paddingVertical: space[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space[4], gap: space[4] },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
});
