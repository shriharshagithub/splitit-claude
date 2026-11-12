# SplitIt | Product Requirements Document (v2, Claude Code run)

## 1. Brief

Build SplitIt, a group expense-splitting application for India. One person pays, the app tracks who owes whom, and everyone settles up over UPI without anyone having to chase anyone.

Target user: 18 to 35, urban India, shares flats, travels in groups, eats out. India-first, UPI-first, INR-only.

Form factor: Native mobile application for Android and iOS (React Native with Expo is acceptable). Must be installable on a real device and function offline.

If native is not possible, a mobile web application is acceptable. Note that as a deviation. The app must work on a phone either way.

Currency: INR only. Format as ₹1,234.50.

## 2. Users and Roles

| Role | Permissions |
| --- | --- |
| Guest | Sign up, log in only |
| Member | Create groups, add expenses, view groups they belong to, settle debts, edit/delete expenses they created |
| Group Admin | All member permissions, plus: add/remove members, rename group, delete group, edit/delete any expense in that group |

A user is a Group Admin only in groups they created. Roles are per-group, not global.

Hard rule: a user must never be able to view, query, or modify any group, expense, or settlement belonging to a group they are not a member of, including by direct URL or API manipulation.

## 3. Data Model

Implement these entities with a real persistent database. Field names may vary; structure may not.

- users: id, full_name, phone (unique), email, upi_id, avatar_url, created_at
- groups: id, name, type (trip | flat | other), created_by, created_at
- group_members: group_id, user_id, role (admin | member), joined_at
- expenses: id, group_id, paid_by (user_id), total_amount, description, category, expense_date, split_type (equal | exact | percentage | shares), receipt_url, created_by, created_at, updated_at
- expense_splits: id, expense_id, user_id, amount_owed
- receipt_items: id, expense_id, item_name, item_amount, assigned_user_ids
- settlements: id, group_id, from_user, to_user, amount, method (upi | cash), status (pending | marked_paid | completed | declined), upi_ref (optional, entered by payer), created_at, marked_paid_at, completed_at
- notifications: id, user_id, group_id, type (payment_request | payment_marked | payment_confirmed | payment_declined | reminder | expense_added | member_added), title, body, payload, read_at, created_at
- reminders: id, group_id, debtor_user_id, creditor_user_id, amount, scheduled_at, sent_at, channel, status

Sum of expense_splits.amount_owed must always equal expenses.total_amount. Rounding remainders go to the payer.

## 4. Screens

Build exactly these nine screens.

1. **Auth**: Sign up and log in. Phone + password, plus one OAuth provider (Google). Password reset by email.
2. **Home**: List of the user's groups. Each row shows group name, member count, and the user's net position in that group ("you are owed ₹450" / "you owe ₹1,200"). Header shows overall net balance across all groups and an unread notifications badge. Empty state with a create-group CTA.
3. **Create / Edit Group**: Name, type, add members by phone number or email. Admin-only for edit.
4. **Group Detail**: Two tabs. Expenses: reverse-chronological feed of expenses with payer, amount, date, and the current user's share. Balances: simplified list of who owes whom within the group, with a Settle Up button on each line.
5. **Add Expense**: Amount, description, category, date, who paid, and split method (equal / exact amounts / percentage / shares). Live preview of each person's share as the user edits. Validation: splits must sum to the total.
6. **Scan Bill**: Upload or capture a photo of a restaurant bill. Extract line items and amounts. Present an editable list. User assigns each line item to one or more group members. Tax and service charge are distributed proportionally to each person's item subtotal. Confirm creates the expense with per-person splits.
7. **Settle Up**: Shows the amount owed between two users. Two options: pay via UPI (section 5.3), or mark as settled in cash. Both require the recipient to confirm before the debt clears.
8. **Activity**: Chronological log of expenses added, settlements marked and confirmed, members added, payment requests and reminders sent, scoped to the user's groups. Also shows the user's notifications with Confirm / Decline actions on incoming payment claims.
9. **Profile & Settings**: Name, phone, email, UPI ID, avatar. Reminder frequency preference. Log out.

## 5. Feature Specifications

### 5.1 Balance calculation

After every expense or confirmed settlement, recalculate group balances and produce a simplified settlement set. Minimise the number of transactions needed to clear all debts, rather than listing every pairwise obligation. Example: if A owes B ₹100 and B owes C ₹100, show A owes C ₹100.

### 5.2 Bill scanning

Image upload (JPEG/PNG, max 10MB, validated server-side). Extract line items via OCR or a vision model. Return item name and amount per line. The user must be able to correct any extracted value before confirming. If extraction fails, fall back gracefully to manual entry, never a dead end. Any AI or OCR API key stays on the server.

### 5.3 Peer-to-peer UPI settlement (no payment gateway)

Money moves directly from the debtor's UPI app to the creditor's UPI ID. The app never holds or routes money. There is no payment gateway (no Razorpay, Cashfree or similar).

Flow:

1. **Request**: From the Balances tab, the creditor can tap "Request payment". The debtor gets an in-app notification and an email: "Ravi is asking for ₹450 for Goa Trip", with a Pay button.
2. **Pay**: The debtor taps Pay via UPI. The app creates a settlement with status `pending`, then opens the phone's UPI app using a UPI deep link with the creditor's UPI ID, name, amount and a note prefilled:
   `upi://pay?pa=<creditor_upi_id>&pn=<creditor_name>&am=<amount_in_rupees_2dp>&cu=INR&tn=SplitIt <group name>`
   On Android, show the UPI app chooser. On iOS or desktop, show a QR code of the same link plus the UPI ID with a Copy button.
3. **Mark as paid**: When the debtor returns to SplitIt, ask "Did the payment go through?" with an optional field for the UPI reference number. Yes moves the settlement to `marked_paid`. No or Cancel leaves it `pending` and retryable.
4. **Message to receiver**: On `marked_paid`, the creditor gets an in-app notification and an email: "Priya says she paid you ₹450 via UPI for Goa Trip. Ref: 123456789012. Confirm?"
5. **Confirm**: The creditor taps Confirm (status `completed`, debt clears, balances recalculate, payer is notified) or Not received (status `declined`, debt stays, payer is notified and can retry).

Rules:

- The debt clears only when the creditor confirms. Never clear it on the debtor's tap alone.
- If the creditor has no UPI ID saved, disable Pay via UPI, show "Ask Ravi to add a UPI ID", and offer cash.
- A settlement in `marked_paid` for more than 3 days without a response sends the creditor one reminder to confirm.
- All status changes happen on the server with an authorisation check. Only the payer can mark paid; only the receiver can confirm or decline.
- Cash follows the same path: payer marks "paid in cash", receiver confirms.

### 5.4 Automated reminders

A scheduled server-side job runs daily. For any debt older than 3 days, send the debtor a reminder (email and in-app notification) naming the creditor, the amount, and the group, with the same Pay via UPI button. Configurable per user: daily / weekly / off. Reminders stop automatically once the debt is settled. This must be automatic; a manual "send reminder" button does not satisfy this requirement.

### 5.5 Offline mode

The app must be usable with no network connection:

- Previously loaded groups, expenses, and balances remain readable
- New expenses can be created offline and are queued locally
- Queued writes sync automatically on reconnection
- Clear visual indicator of offline state and pending-sync count
- Data survives a force-close and reopen while still offline
- Conflicts resolve last-write-wins, and the user is told when a conflict occurred

Settling up needs a network connection. Show a clear message if the user tries offline.

## 6. Non-Functional Requirements

### Security

- Server-side authorisation on every data access, not client-side filtering
- Row-level isolation between groups (see the hard rule in section 2)
- No secrets, API keys, or service credentials in client-side code
- Passwords hashed, sessions expire, password reset tokens single-use and time-limited
- File uploads validated for type and size on the server

### Reliability

- Server-side validation on every write; client validation is not sufficient
- Meaningful error states on every screen; no silent failures, no raw stack traces shown to users
- Money handled as integer paise or fixed-precision decimal, never floats

### Production readiness

- Crash and error reporting wired in on both app and backend, so a production crash is captured with the screen and stack trace
- Transactional email set up for password reset, payment requests, payment confirmations and reminders
- Push notifications for payment requests, payment claims and reminders (in-app notification is the minimum)
- Automated deployment of the backend from the code repository

### Performance

- Home and Group Detail render in under 2 seconds on a 4G connection
- Group Detail paginates or virtualises beyond 50 expenses

### Deployment

- Produces an installable Android build (APK or AAB). An iOS TestFlight build is a bonus, not required
- Backend deployed and reachable from a phone on mobile data
- Source code in a Git repository, exportable and runnable outside the platform, with a README that explains setup

## 7. Seed Data

Seed the app so it is testable immediately:

- 5 users with Indian names, phone numbers and UPI IDs
- 2 groups: "Goa Trip" (5 members) and "Flat 402" (3 members)
- 12 expenses across both groups, mixed split types, ₹150 to ₹8,000
- 1 completed settlement, 1 marked_paid waiting for confirmation, 1 pending

## 8. Out of Scope for MVP

Do not build: payment gateway integration, any money held or routed by the app, multi-currency, trip reports, CSV/PDF export, expense categories analytics, group chat, recurring expenses, budgets, or any paid tier.

## 9. Definition of Done

The build is complete when all of the following are true:

1. A new user can sign up, log in, reset their password, and log out
2. A user can create a group and add members
3. A user can add an expense using all four split types, with correct arithmetic
4. Balances are simplified and correct after every expense and confirmed settlement
5. A bill photo can be scanned, items assigned per person, and the resulting expense created
6. Tapping Pay via UPI opens a UPI app on a real Android phone with the receiver's UPI ID and the amount prefilled
7. After the payer marks paid, the receiver gets a message (in-app and email) and the debt clears only when the receiver confirms
8. A declined or abandoned payment leaves the debt intact and can be retried
9. A cash settlement requires recipient confirmation
10. An automated reminder fires for a debt older than 3 days without human action
11. The app loads, reads, and accepts new expenses with the network disabled, then syncs on reconnect
12. A logged-in user cannot reach another group's data by editing the URL or calling the API directly
13. A forced crash shows up in the error reporting tool
14. Every screen renders correctly on a real phone, with nothing cut off or wrapping mid-value
15. The app installs on a real phone, the backend is reachable, and the code can be exported
