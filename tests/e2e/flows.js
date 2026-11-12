// End-to-end test against a running web build and the live backend.
// Usage: npx expo export -p web --output-dir dist && node tests/e2e/serve.js "$PWD/dist" & node tests/e2e/flows.js <screenshot-dir>
// Creates a throwaway user and group (names start with "kiran." / "E2E Dinner"); remove them afterwards.
const { chromium } = require('playwright');
const out = process.argv[2];
const BASE = 'http://localhost:8099/splitit-claude';
const ts = Date.now().toString().slice(-6);
const kiran = { name: 'Kiran Test', phone: `97${ts}01`.slice(0, 10), email: `kiran.${ts}@example.com`, pw: 'Testing@123' };
const log = (...a) => console.log(...a);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return { ctx, page };
}
const text = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const wait = (page, ms = 2500) => page.waitForTimeout(ms);

async function addExpense(page, { amount, desc, type, values, payer }) {
  await page.getByRole('button', { name: 'Add expense' }).click();
  await wait(page, 1500);
  await page.getByLabel('Amount (₹)').fill(amount);
  await page.getByLabel('Description').fill(desc);
  if (payer) await page.getByRole('button', { name: payer, exact: true }).first().click();
  const typeName = { equal: 'Equal', exact: 'Exact', percentage: 'Percent', shares: 'Shares' }[type];
  await page.getByRole('radio', { name: typeName }).click();
  for (const [who, v] of Object.entries(values || {})) {
    if (type === 'exact') await page.getByLabel(`Amount for ${who}`).fill(v);
    if (type === 'percentage') await page.getByLabel(`Percent for ${who}`).fill(v);
    if (type === 'shares') for (let i = 0; i < v; i++) await page.getByLabel(`One more share for ${who}`).click();
  }
  await wait(page, 500);
  const preview = await text(page);
  if (await page.getByRole('button', { name: 'Save expense' }).isDisabled()) return preview + ' [SAVE DISABLED]';
  await page.getByRole('button', { name: 'Save expense' }).click();
  await wait(page, 3000);
  return preview;
}

(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } });

  // 1. Sign up
  const K = await newPage(browser);
  await K.page.goto(`${BASE}/login`);
  await wait(K.page);
  await K.page.getByRole('radio', { name: 'Sign up' }).click();
  await K.page.getByLabel('Full name').fill(kiran.name);
  await K.page.getByLabel('Phone number').fill(kiran.phone);
  await K.page.getByLabel('Email').fill(kiran.email);
  await K.page.getByLabel('Password').fill(kiran.pw);
  await K.page.getByRole('button', { name: 'Create account' }).click();
  const landed = await K.page.getByText('No groups yet').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  check('sign up lands on empty Home', landed);
  await K.page.screenshot({ path: `${out}/10-empty-home.png` });

  // 2. Create group with an existing user (Priya, by phone) and a non-user (invite)
  await K.page.getByRole('button', { name: 'Create a group' }).click();
  await wait(K.page, 1500);
  await K.page.getByLabel('Group name').fill(`E2E Dinner ${ts}`);
  await K.page.getByRole('radio', { name: 'Other' }).click();
  await K.page.getByLabel('Add members').fill('98860 54321');
  await K.page.getByRole('button', { name: 'Add', exact: true }).click();
  await K.page.getByLabel('Add members').fill(`friend.${ts}@example.com`);
  await K.page.getByRole('button', { name: 'Add', exact: true }).click();
  await K.page.getByRole('button', { name: 'Create group' }).click();
  await wait(K.page, 4000);
  const inv = await text(K.page);
  check('non-user gets an invite', inv.includes(`friend.${ts}@example.com`) && /Share link/.test(inv));
  await K.page.screenshot({ path: `${out}/11-invite.png` });
  await K.page.getByRole('button', { name: 'Go to group' }).click();
  await wait(K.page, 3000);
  const groupUrl = K.page.url();
  const groupId = groupUrl.split('/group/')[1].split(/[/?]/)[0];
  check('group created with 2 members', /2 members/.test(await text(K.page)), groupId);

  // 3. Four split types (Kiran + Priya)
  let p = await addExpense(K.page, { amount: '1000', desc: 'Equal pizza', type: 'equal' });
  check('equal preview shows ₹500.00 each', (p.match(/₹500\.00/g) || []).length >= 2);
  p = await addExpense(K.page, { amount: '999.99', desc: 'Exact drinks', type: 'exact', values: { 'Kiran Test': '333.33', 'Priya Sharma': '600' } });
  check('save disabled while exact split does not add up', p.includes('[SAVE DISABLED]'));
  // the previous save must have failed validation (sum 933.33); fix the value and save again
  if (/Add ₹66\.66 more/.test(p)) {
    check('exact mismatch message', true, 'Add ₹66.66 more');
    await K.page.getByLabel('Amount for Priya Sharma').fill('666.66');
    await wait(K.page, 300);
    await K.page.getByRole('button', { name: 'Save expense' }).click();
    await wait(K.page, 3000);
  } else check('exact mismatch message', false, p.slice(0, 300));
  p = await addExpense(K.page, { amount: '100', desc: 'Percent snacks', type: 'percentage', values: { 'Kiran Test': '33.33', 'Priya Sharma': '66.67' } });
  check('percent preview ₹33.33 / ₹66.67', /₹33\.33/.test(p) && /₹66\.67/.test(p));
  p = await addExpense(K.page, { amount: '450', desc: 'Shares cab', type: 'shares', values: { 'Kiran Test': 1 } });
  check('shares preview ₹300.00 / ₹150.00', /₹300\.00/.test(p) && /₹150\.00/.test(p));
  const feed = await text(K.page);
  check('feed shows four expenses', ['Equal pizza', 'Exact drinks', 'Percent snacks', 'Shares cab'].every((d) => feed.includes(d)), feed.slice(0, 200));
  await K.page.screenshot({ path: `${out}/12-feed.png` });

  // 4. Offline add, then sync
  await K.ctx.setOffline(true);
  await wait(K.page, 1500);
  check('offline banner shows', /You are offline/.test(await text(K.page)));
  await addExpense(K.page, { amount: '200', desc: 'Offline chai', type: 'equal' });
  const off = await text(K.page);
  check('offline expense queued and visible', /Offline chai/.test(off) && /1 waiting to sync/.test(off));
  await K.page.screenshot({ path: `${out}/13-offline.png` });
  const stored = await K.page.evaluate(() => localStorage.getItem('splitit.outbox.v1'));
  check('queue persisted to storage (survives restart)', /Offline chai/.test(stored || ''));
  await K.ctx.setOffline(false);
  await wait(K.page, 6000);
  const synced = await text(K.page);
  check('queue synced on reconnect', /Offline chai/.test(synced) && !/waiting to sync/.test(synced));

  // Balances: Kiran paid everything, so Priya owes Kiran
  await K.page.getByRole('radio', { name: 'Balances' }).click();
  await wait(K.page, 2500);
  const bal = await text(K.page);
  // Priya owes: 500 + 666.66 + 66.67 + 150 + 100 = 1483.33
  check('balance: Priya owes Kiran ₹1,483.33', /Priya owes you ₹1,483\.33/.test(bal), bal.slice(0, 250));

  // 5. Priya settles via UPI (web shows QR), Kiran declines, Priya retries, Kiran confirms
  const P = await newPage(browser);
  await P.page.goto(`${BASE}/login`);
  await wait(P.page);
  await P.page.getByLabel('Phone number').fill('9886054321');
  await P.page.getByLabel('Password').fill('SplitIt@2026');
  await P.page.getByRole('button', { name: 'Log in' }).last().click();
  await wait(P.page, 4000);
  const settle = async () => {
    await P.page.goto(`${BASE}/group/${groupId}?tab=balances`);
    await wait(P.page, 3000);
    await P.page.getByRole('button', { name: /Settle up|Finish paying/ }).first().click();
    await wait(P.page, 2500);
    check('settle screen shows amount', /You pay Kiran Test/.test(await text(P.page)));
    await P.page.getByRole('button', { name: /Pay ₹1,483\.33 via UPI/ }).click();
    await wait(P.page, 2500);
  };
  // Kiran has no UPI ID yet, so UPI must be disabled
  await P.page.goto(`${BASE}/group/${groupId}?tab=balances`);
  await wait(P.page, 3000);
  await P.page.getByRole('button', { name: /Settle up/ }).first().click();
  await wait(P.page, 2500);
  check('no UPI ID: pay disabled and asks to add one', /Ask Kiran to add a UPI ID/.test(await text(P.page)));
  await P.page.screenshot({ path: `${out}/14-no-upi.png` });
  // Kiran adds a UPI ID
  await K.page.goto(`${BASE}/profile`);
  await wait(K.page, 2500);
  await K.page.getByLabel('UPI ID').fill('kiran.test@okaxis');
  await K.page.getByRole('button', { name: 'Save changes' }).click();
  await wait(K.page, 2500);
  check('profile saved', /Saved\./.test(await text(K.page)));

  await settle();
  const qr = await text(P.page);
  check('web/iOS shows QR + UPI ID + copy', /kiran\.test@okaxis/.test(qr) && /Copy/.test(qr) && /I have paid/.test(qr));
  await P.page.screenshot({ path: `${out}/15-qr.png` });
  await P.page.getByRole('button', { name: 'I have paid' }).click();
  await wait(P.page, 1000);
  await P.page.getByLabel('UPI reference number (optional)').fill('123456789012');
  await P.page.screenshot({ path: `${out}/16-did-it-go-through.png` });
  await P.page.getByRole('button', { name: 'Yes, mark as paid' }).click();
  await wait(P.page, 3000);
  check('payer sees waiting for confirmation', /Waiting for Kiran to confirm/.test(await text(P.page)));

  // debt NOT cleared yet
  await K.page.goto(`${BASE}/group/${groupId}?tab=balances`);
  await wait(K.page, 3000);
  check('marked_paid does not clear the debt', /₹1,483\.33/.test(await text(K.page)));

  // Kiran: Activity -> decline
  await K.page.goto(`${BASE}/activity`);
  await wait(K.page, 3500);
  const act = await text(K.page);
  check('receiver gets claim with ref', /Priya marked ₹1,483\.33 to you as paid via UPI/.test(act) && /123456789012/.test(act), act.slice(0, 300));
  await K.page.screenshot({ path: `${out}/17-claim.png` });
  await K.page.getByRole('button', { name: 'Not received' }).first().click();
  await wait(K.page, 3000);
  await K.page.goto(`${BASE}/group/${groupId}?tab=balances`);
  await wait(K.page, 3000);
  check('declined leaves debt intact', /Priya owes you ₹1,483\.33/.test(await text(K.page)));

  // Priya retries and Kiran confirms
  await settle();
  await P.page.getByRole('button', { name: 'I have paid' }).click();
  await wait(P.page, 1000);
  await P.page.getByRole('button', { name: 'Yes, mark as paid' }).click();
  await wait(P.page, 3000);
  await K.page.goto(`${BASE}/activity`);
  await wait(K.page, 3500);
  await K.page.getByRole('button', { name: 'Confirm', exact: true }).first().click();
  await wait(K.page, 3000);
  await K.page.goto(`${BASE}/group/${groupId}?tab=balances`);
  await wait(K.page, 3000);
  check('confirm clears the debt', /Everyone is settled up/.test(await text(K.page)));

  // 6. Cash: new expense, Priya pays cash, Kiran confirms
  await K.page.goto(`${BASE}/group/${groupId}`);
  await wait(K.page, 2500);
  await addExpense(K.page, { amount: '300', desc: 'Cash test', type: 'equal' });
  await P.page.goto(`${BASE}/group/${groupId}?tab=balances`);
  await wait(P.page, 3000);
  await P.page.getByRole('button', { name: /Settle up/ }).first().click();
  await wait(P.page, 2500);
  await P.page.getByRole('button', { name: 'I paid in cash' }).click();
  await wait(P.page, 2000);
  await P.page.getByRole('button', { name: 'Yes, I paid in cash' }).click();
  await wait(P.page, 3000);
  await K.page.goto(`${BASE}/group/${groupId}?tab=balances`);
  await wait(K.page, 3000);
  check('cash claim still needs confirmation', /₹150\.00/.test(await text(K.page)));
  await K.page.goto(`${BASE}/activity`);
  await wait(K.page, 3500);
  check('cash claim shown to receiver', /in cash/.test(await text(K.page)));
  await K.page.getByRole('button', { name: 'Confirm', exact: true }).first().click();
  await wait(K.page, 2500);

  // 7. Priya cannot open another group's data by URL
  await P.page.goto(`${BASE}/group/00000000-0000-4000-8000-000000000000`);
  await wait(P.page, 3000);
  check('unknown/foreign group by URL shows no data', /does not exist or you are not a member/.test(await text(P.page)));

  // record the group id for cleanup
  require('fs').writeFileSync(`${out}/e2e-state.json`, JSON.stringify({ groupId, kiran }));
  console.log('PAGE ERRORS', K.page.errors.slice(0, 5), P.page.errors.slice(0, 5));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await browser.close();
})().catch(async (e) => { console.error('SCRIPT ERROR', e.message); console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed before error`); process.exit(1); });
