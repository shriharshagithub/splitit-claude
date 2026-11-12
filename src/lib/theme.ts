import { useColorScheme } from 'react-native';

const light = {
  bg: '#F4F7F6', surface: '#FFFFFF', surface2: '#EAF1EF', text: '#10201E', muted: '#5A6B68', border: '#DCE5E3',
  primary: '#0F766E', onPrimary: '#FFFFFF', accent: '#F59E0B', onAccent: '#2A1700',
  owe: '#B45309', oweBg: '#FEF3C7', owed: '#0F766E', owedBg: '#CCFBF1', danger: '#B91C1C', dangerBg: '#FEE2E2',
  overlay: 'rgba(16,32,30,0.45)',
};
const dark: typeof light = {
  bg: '#0E1514', surface: '#16201F', surface2: '#1E2B29', text: '#E8F0EE', muted: '#9DB0AC', border: '#2A3836',
  primary: '#2DD4BF', onPrimary: '#04201D', accent: '#FBBF24', onAccent: '#2A1700',
  owe: '#FCD34D', oweBg: '#3A2A06', owed: '#5EEAD4', owedBg: '#0B3530', danger: '#F87171', dangerBg: '#3B1212',
  overlay: 'rgba(0,0,0,0.6)',
};
export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { s: 10, m: 16, l: 24 };
export const space = (n: number) => n * 4;
export const MIN_TOUCH = 48;
