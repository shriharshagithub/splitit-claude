# SplitIt design

## The taste questions, and the answers I chose

You asked not to be asked anything, so I answered the five taste questions myself, from the brief (18 to 35, urban India, flats, trips, eating out) and from your feedback on the last build (you didn't like the indigo palette and its pattern).

| Question | Answer I chose |
| --- | --- |
| Apps you like? | Google Pay and CRED for clarity of money; Zomato for warmth. |
| Colours? | Not indigo. A warm, Indian palette that still reads as "money you can trust". |
| Mood? | Friendly and calm. Money between friends should not feel like a bank statement or a debt collector. |
| Logo? | A simple wordmark plus a split circle (one coin, two halves). |
| Density? | Roomy. Big numbers, 48 px touch targets, one main action per screen. |

## Three style directions

| | A. Masala Chai | B. Monsoon | C. Night Market |
| --- | --- | --- | --- |
| Feel | Warm, homely, cafe menu | Fresh, calm, trustworthy | Bold, young, neon on dark |
| Primary | Terracotta `#B4532A` | Deep teal `#0F766E` | Electric violet `#7C3AED` |
| Accent | Cardamom green `#5B7F3A` | Marigold `#F59E0B` | Lime `#A3E635` |
| Background | Cream `#FBF6EE` | Mist `#F4F7F6` | Ink `#0B0B12` |
| Type | Rounded sans | System sans, tabular numbers | Condensed display |
| Risk | Can look dated | Safe, could feel plain | Tiring in daylight; poor in light mode |

**Chosen: B, Monsoon.** It works best in both light and dark mode, the teal reads as "settled / safe" without using red or green for money direction, and marigold gives warmth for the main buttons and highlights. It also avoids the indigo you disliked.

## Rules

- **Money direction is always written in words**: "you owe ₹450.00", "you are owed ₹450.00", "settled up". Colour (amber for owe, teal for owed) is only a second signal, with an arrow icon as a third.
- Amounts always show two decimals and Indian grouping: ₹1,23,456.00. Numbers use tabular figures so columns line up.
- Dates are shown as "3 Nov 2026"; times in IST.
- Every tap target is at least 48 × 48 px.
- Light and dark mode follow the phone setting.
- One primary (marigold) button per screen; secondary buttons are outlined teal.

## Tokens

| Token | Light | Dark |
| --- | --- | --- |
| background | `#F4F7F6` | `#0E1514` |
| surface (cards) | `#FFFFFF` | `#16201F` |
| text | `#10201E` | `#E8F0EE` |
| muted text | `#5A6B68` | `#9DB0AC` |
| border | `#DCE5E3` | `#2A3836` |
| primary (teal) | `#0F766E` | `#2DD4BF` |
| on primary | `#FFFFFF` | `#04201D` |
| accent (marigold) | `#F59E0B` | `#FBBF24` |
| on accent | `#2A1700` | `#2A1700` |
| owe (amber text) | `#B45309` | `#FCD34D` |
| owed (teal text) | `#0F766E` | `#5EEAD4` |
| danger | `#B91C1C` | `#F87171` |

Spacing is on a 4 px grid; cards have 16 px radius; the app is a phone-width column (max 480 px) on desktop browsers.

Screenshots of every screen in light and dark mode are in [design/](design/).
