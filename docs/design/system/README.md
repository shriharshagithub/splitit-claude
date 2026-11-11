SplitIt is a group expense-splitting app for India: one person pays, the app tracks who owes whom, and everyone settles over UPI. Build every screen for a phone held in one hand, 360 to 430 px wide, in light and dark.

## Principles

1. **The amount is the content.** Every screen has one figure that matters. Set it in an `amount-*` style and give it room. Everything else supports it.
2. **Say the direction in words.** A balance is never a bare number or a colour alone. Write "you are owed ₹450.00" or "you owe ₹1,200.00", then colour it.
3. **Nothing clears without the other person.** Pending and awaiting-confirmation states look unfinished on purpose: `accent-soft` pills, never `positive`.
4. **Calm when offline.** Offline is a normal state, not an error. Use the offline banner in `surface-sunken` and `ink`, never `danger`.

## Voice

- Speak like a flatmate who is good with money: short, direct, friendly. "Ravi is asking for ₹450.00 for Goa Trip."
- Address the user as "you". Use first names for everyone else.
- Sentence case everywhere, including buttons: "Add expense", "Settle up", "Pay via UPI". Uppercase only in the `overline` style.
- Buttons name the action and its result: "Confirm received", "Not received", "Mark as paid".
- Errors say what happened and what to do: "Splits add up to ₹980.00. Add ₹20.00 more to match the total."
- No emoji in the interface. No exclamation marks.

## Money

- Format every amount as `₹1,234.50`: rupee sign, no space, Indian digit grouping (`₹1,00,000.00`), always two decimals.
- Set amounts in the `amount` family with tabular figures so columns line up. Never let an amount wrap or truncate; shrink the label beside it first.
- Right-align amounts in lists.
- Money owed to the user: `positive` text, optionally on `positive-soft`. Money the user owes: `negative` text, optionally on `negative-soft`. Settled: `ink-muted` with the word "settled up".
- `positive` and `negative` are teal and orange so they stay distinct for colour-blind users. Do not swap in green and red.
- `danger` is for errors and declined payments. Never use it for a balance.

## Color

- Screens sit on `ground`. Rows, cards, inputs and sheets are `surface` separated by `line`. Do not stack cards inside cards.
- `brand` (indigo) marks the primary action on a screen, the active tab and links. One primary button per screen.
- `accent` (marigold) is a fill for exactly one thing per screen: the Pay via UPI button, the unread badge, or the split dial. Text on it is `on-accent`. Never use `accent` as a text colour.
- Text on `brand` is `on-brand`. In dark, `brand` is light and `on-brand` is dark; always use the pair.
- Focus ring: 2px solid `brand`, 2px offset, on every interactive element.

## Type

- `display` family (Anek Latin) for titles and headings only. `body` family (Mukta) for all running text and controls. `amount` family (JetBrains Mono) for money and UPI reference numbers only.
- Minimum size is `caption` (13px). Body is 16px so inputs do not trigger zoom.
- One `display` or `amount-xl` element per screen.

## Layout

- Side gutter `space-4`. Sections are separated by `space-6`. Rows have `space-3` vertical padding and a minimum height of `space-12`.
- Touch targets are at least 48 px tall.
- Primary action sits at the bottom of the screen, full width, above the safe area. The floating add button appears only on Home and Group Detail.
- Lists are flat rows with `line` dividers. Use `radius-md` cards only for a single summary block (overall balance, settle-up amount, QR panel).
- Shadows only on the floating button and bottom sheets (`shadow-raised`).

## Shape

The signature shape is the split disc: a circle cut into halves or shares with a `space-1` gap. Use it for the split-method dial on Add Expense, group avatars, and empty states. Do not add other decorative shapes.

## Iconography

- Lucide icons, 24 px, 1.75 px stroke, coloured with `ink` or `ink-muted`; `on-brand` on brand fills. No icon files are stored here; load them from the `lucide-react-native` package.
- Every icon-only button has an accessibility label.
- There is no logo mark. Set the name "SplitIt" in the `display` style.

## States

- Settlement pills: pending and awaiting confirmation use `accent-soft` with `pending` text; completed uses `positive-soft` with `positive`; declined uses `surface-sunken` with `danger`. Each pill carries its word.
- Disabled controls: `surface-sunken` fill, `ink-muted` text, and a line of helper text that says why ("Ask Ravi to add a UPI ID").
- Loading: skeleton blocks in `surface-sunken`. Errors: inline, in `danger`, next to the thing that failed, with a retry.
- Motion is limited to 150 to 200 ms fades and slides; respect reduced-motion settings.
