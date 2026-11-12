import { Component, type ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { report } from '@/lib/sentry';

/** Catches crashes in a screen, reports them (with the screen name) and shows a calm message instead of a stack trace. */
export class ErrorBoundary extends Component<{ children: ReactNode; screen?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { report(error, this.props.screen); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#F4F7F6' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#10201E' }}>Something went wrong</Text>
        <Text style={{ fontSize: 16, color: '#5A6B68', textAlign: 'center' }}>We have been told about it. Your data is safe.</Text>
        <Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })}
          style={{ minHeight: 48, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#F59E0B', justifyContent: 'center' }}>
          <Text style={{ fontWeight: '700', color: '#2A1700' }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
