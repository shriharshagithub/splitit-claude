// Tokens from the SplitIt design system (docs/design/system/tokens.json).
import { useColorScheme } from 'react-native';

const light = {
  ground: '#f5f5fb', surface: '#ffffff', sunken: '#e9eaf4', line: '#d6d7e6', lineStrong: '#84869f',
  ink: '#15163a', muted: '#54567a', brand: '#2b2f8f', onBrand: '#ffffff', brandSoft: '#e4e5f8',
  accent: '#f5a70a', onAccent: '#231700', accentSoft: '#fdefcf', pending: '#6b4e00',
  positive: '#00696b', positiveSoft: '#d9f0ee', negative: '#b4380d', negativeSoft: '#fbe4d9', danger: '#a8123a',
  scrim: 'rgba(21,22,58,0.45)',
};
const dark: typeof light = {
  ground: '#0e0f24', surface: '#191a37', sunken: '#080917', line: '#2f3159', lineStrong: '#7577a3',
  ink: '#eeeefc', muted: '#a8aace', brand: '#aab0ff', onBrand: '#10113a', brandSoft: '#272a5c',
  accent: '#ffc247', onAccent: '#231700', accentSoft: '#3d2f0a', pending: '#ffd27a',
  positive: '#5fd4d0', positiveSoft: '#0d3536', negative: '#ff9a6b', negativeSoft: '#45200f', danger: '#ff8fa8',
  scrim: 'rgba(0,0,0,0.6)',
};
export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const font = {
  display: 'AnekLatin_700Bold',
  displaySemi: 'AnekLatin_600SemiBold',
  body: 'Mukta_400Regular',
  bodyMedium: 'Mukta_500Medium',
  bodyStrong: 'Mukta_600SemiBold',
  amount: 'JetBrainsMono_500Medium',
  amountStrong: 'JetBrainsMono_600SemiBold',
};

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 } as const;
export const radius = { sm: 8, md: 14, lg: 24, full: 999 } as const;

export const type = {
  display: { fontFamily: font.display, fontSize: 32, lineHeight: 36 },
  title: { fontFamily: font.displaySemi, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: font.displaySemi, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: font.bodyStrong, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: font.bodyMedium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: font.bodyStrong, fontSize: 12, lineHeight: 16, letterSpacing: 0.7 },
  amountXl: { fontFamily: font.amountStrong, fontSize: 36, lineHeight: 40 },
  amountLg: { fontFamily: font.amountStrong, fontSize: 22, lineHeight: 28 },
  amount: { fontFamily: font.amount, fontSize: 16, lineHeight: 24 },
  amountSm: { fontFamily: font.amount, fontSize: 13, lineHeight: 18 },
} as const;
