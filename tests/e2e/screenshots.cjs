// Screenshots of every screen (light and dark) using the demo account Priya. Usage: node tests/e2e/screenshots.cjs docs/design
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.E2E_URL || 'http://localhost:8099/splitit-claude';
const OUT = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await ctx.newPage();
    const shot = async (name) => { await p.waitForTimeout(1800); await p.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) }); };
    await p.goto(`${BASE}/login`); await shot('01-login');
    await p.getByRole('textbox', { name: 'Email or mobile number' }).fill('9000000001');
    await p.getByRole('textbox', { name: 'Password', exact: true }).fill('SplitIt@2026');
    await p.getByRole('button', { name: 'Log in', exact: true }).click();
    await p.getByText('Your groups').filter({ visible: true }).first().waitFor({ timeout: 30000 });
    await shot('02-home');
    await p.getByText('Goa Trip').filter({ visible: true }).first().click(); await shot('03-group-expenses');
    const gid = p.url().split('/group/')[1];
    await p.goto(`${BASE}/group/${gid}?tab=balances`); await shot('04-group-balances');
    await p.goto(`${BASE}/group/${gid}/expense`);
    await p.getByRole('textbox', { name: 'Amount (₹)' }).fill('1250');
    await p.getByRole('textbox', { name: 'Description' }).fill('Sunset cruise');
    await p.getByRole('tab', { name: '%' }).click();
    const f = p.getByRole('textbox', { name: /percent$/ });
    for (const [i, v] of ['30', '20', '20', '20', '10'].entries()) await f.nth(i).fill(v);
    await shot('05-add-expense');
    await p.getByRole('button', { name: /Pick a date/ }).click(); await shot('06-date-picker');
    await p.goto(`${BASE}/group/${gid}/scan`); await shot('07-scan');
    await p.getByRole('button', { name: 'Type the items instead', exact: true }).filter({ visible: true }).first().click(); await shot('08-scan-items');
    const arjun = 'd0000000-0000-4000-8000-000000000004';
    const ravi = 'd0000000-0000-4000-8000-000000000002';
    await p.goto(`${BASE}/group/${gid}/settle?to=${ravi}&amount=48200`); await shot('09-settle');
    await p.goto(`${BASE}/group/${gid}/edit`); await shot('10-group-settings');
    await p.goto(`${BASE}/activity`); await shot('11-activity');
    await p.goto(`${BASE}/profile`); await shot('12-profile');
    await p.goto(`${BASE}/group/new`); await shot('13-new-group');
    await ctx.close();
  }
  await b.close();
})();
