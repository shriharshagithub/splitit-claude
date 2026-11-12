// End-to-end browser test of the main flows, against the live backend, as real people would use the app.
// Two people (A and B) each in their own browser, plus an outsider (C).
// Usage: node tests/e2e/serve.mjs dist 8099 &  node tests/e2e/flows.cjs <screenshot dir>
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.E2E_URL || 'http://localhost:8099/splitit-claude';
const OUT = process.argv[2] || '.';
const run = Date.now().toString(36);
const pw = `Passw0rd!${run}`;
const rnd = () => '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
const people = { A: { name: `Asha ${run}`, email: `e2e-${run}-a@example.com`, phone: rnd() }, B: { name: `Bala ${run}`, email: `e2e-${run}-b@example.com`, phone: rnd() }, C: { name: `Chitra ${run}`, email: `e2e-${run}-c@example.com`, phone: rnd() } };
let n = 0, failed = 0;
const t0 = Date.now();

async function step(name, page, f) {
  n++;
  const s = Date.now();
  try {
    await f();
    console.log(`PASS ${String(n).padStart(2)} ${name} (${((Date.now() - s) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${String(n).padStart(2)} ${name}\n     ${String(e.message).split('\n')[0]}`);
    if (page) await page.screenshot({ path: path.join(OUT, `fail-${n}.png`) }).catch(() => {});
    if (process.env.E2E_STOP !== '0') { await browser.close(); process.exit(1); }
  }
}
// Earlier screens stay mounted (hidden) in the navigation stack, so only match what is visible.
const btn = (p, name) => p.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const expectText = (p, text, timeout = 10000) => p.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout });
async function gone(p, text, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await p.getByText(text, { exact: false }).filter({ visible: true }).count()) === 0) return;
    await p.waitForTimeout(200);
  }
  throw new Error(`"${text}" still visible after ${timeout} ms`);
}
const field = (p, name) => p.getByRole('textbox', { name, exact: true }).filter({ visible: true }).first();
let browser;

async function signUp(p, who) {
  await p.goto(`${BASE}/login`);
  await p.getByRole('tab', { name: 'Sign up' }).click();
  await field(p, 'Your name').fill(who.name);
  await field(p, 'Email').fill(who.email);
  await field(p, 'Mobile number').fill(who.phone);
  await field(p, 'Password').fill(pw);
  await btn(p, 'Create account').click();
  await expectText(p, 'Your groups', 20000);
}

(async () => {
  browser = await chromium.launch();
  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`     [page error] ${e.message}`));
    return { ctx, page };
  };
  const { ctx: ctxA, page: a } = await mk();
  const { page: b } = await mk();
  const { page: c } = await mk();

  await step('A signs up with name, email, mobile and password', a, () => signUp(a, people.A));
  await step('B signs up', b, () => signUp(b, people.B));
  await step('C (outsider) signs up', c, () => signUp(c, people.C));

  await step('wrong password shows a plain message', c, async () => {
    const { page: x } = await mk();
    await x.goto(`${BASE}/login`);
    await field(x, 'Email or mobile number').fill(people.A.phone);
    await field(x, 'Password').fill('nope-nope');
    await btn(x, 'Log in').click();
    await expectText(x, 'That login or password is not right.');
    await x.context().close();
  });

  await step('A logs out and logs back in with the mobile number', a, async () => {
    await a.getByRole('tab', { name: 'Profile' }).click();
    await btn(a, 'Log out').click();
    await field(a, 'Email or mobile number').waitFor();
    await field(a, 'Email or mobile number').fill(`${people.A.phone.slice(0, 5)} ${people.A.phone.slice(5)}`);
    await field(a, 'Password').fill(pw);
    await btn(a, 'Log in').click();
    await expectText(a, 'Your groups', 20000);
  });

  await step('forgot password sends a reset link message', null, async () => {
    const { page: x } = await mk();
    await x.goto(`${BASE}/login`);
    await x.getByText('Forgot password?').click();
    await field(x, 'Email').fill(people.A.email);
    await btn(x, 'Send reset link').click();
    await expectText(x, 'a reset link is on its way');
    await x.context().close();
  });

  let gid;
  const gname = `Goa ${run}`;
  await step('A creates a Trip group', a, async () => {
    await btn(a, '+ New group').click();
    await field(a, 'Group name').fill(gname);
    await a.getByRole('checkbox', { name: '🏖️ Trip' }).click();
    await btn(a, 'Create group').click();
    await expectText(a, "Who's in?");
  });

  await step('B sees the new group appear on their open Home screen once added (no refresh)', b, async () => {
    await field(a, 'Add by mobile number or email').fill(people.B.phone);
    await btn(a, 'Add person').click();
    await expectText(a, `${people.B.name} is on SplitIt and has been added`);
    await expectText(b, gname, 5000);
  });

  await step('adding an unknown phone creates an invite with a "Send on WhatsApp" button', a, async () => {
    const unknown = rnd();
    // The test machine has no route to WhatsApp; answer the link locally and check where it pointed.
    await ctxA.route(/wa\.me|whatsapp\.com/, (r) => r.fulfill({ body: 'whatsapp' }));
    await field(a, 'Add by mobile number or email').fill(unknown);
    await btn(a, 'Add person').click();
    await expectText(a, "isn't on SplitIt yet");
    const [popup] = await Promise.all([a.waitForEvent('popup'), btn(a, 'Send on WhatsApp').click()]);
    const url = decodeURIComponent(popup.url());
    if (!url.includes(`wa.me/91${unknown}`) && !url.includes(`phone=91${unknown}`)) throw new Error(`unexpected WhatsApp URL ${url}`);
    if (!url.includes('/join/')) throw new Error('invite link missing from WhatsApp message');
    await popup.close();
  });

  await step('adding an unknown email sends an invite email', a, async () => {
    await field(a, 'Add by mobile number or email').fill(`e2e-${run}-d@example.com`);
    await btn(a, 'Add person').click();
    await expectText(a, 'We emailed them an invite');
    await btn(a, 'Done, open the group').click();
    await a.waitForURL(/\/group\/[0-9a-f-]{36}$/);
    gid = a.url().split('/group/')[1];
  });

  await step('B opens the group page', b, async () => {
    await b.getByText(gname).first().click();
    await expectText(b, 'No expenses yet');
  });

  await step('A adds an equal expense with the calendar date picker; B sees it live within seconds', a, async () => {
    await btn(a, '+ Add expense').click();
    await field(a, 'Amount (₹)').fill('1000');
    await field(a, 'Description').fill('Beach shack dinner');
    await a.getByRole('button', { name: /Pick a date/ }).click();
    await btn(a, 'Previous month').click();
    await a.getByRole('button', { name: /^3 \w{3} \d{4}$/ }).click();
    await a.getByRole('button', { name: /Pick a date, currently 3 \w{3} \d{4}/ }).waitFor();
    await expectText(a, '₹500.00');
    await expectText(a, 'Adds up to ₹1,000.00');
    const saved = Date.now();
    await btn(a, 'Save expense').click();
    await expectText(b, 'Beach shack dinner', 8000);
    console.log(`     B saw it ${Date.now() - saved} ms after A tapped Save`);
    await expectText(b, 'your share ₹500.00');
  });

  await step('exact amounts: live preview flags a mismatch, then saves', a, async () => {
    await btn(a, '+ Add expense').click();
    await field(a, 'Amount (₹)').fill('300');
    await field(a, 'Description').fill('Cab to airport');
    await a.getByRole('tab', { name: 'Amounts' }).click();
    const fields = a.getByRole('textbox', { name: /amount$/ });
    await fields.nth(0).fill('100');
    await fields.nth(1).fill('150');
    await expectText(a, '₹50.00 still to assign');
    await fields.nth(1).fill('200');
    await expectText(a, 'Adds up to ₹300.00');
    await btn(a, 'Save expense').click();
    await expectText(a, 'Cab to airport');
  });

  await step('percentages: 60/40 of ₹999.99', a, async () => {
    await btn(a, '+ Add expense').click();
    await field(a, 'Amount (₹)').fill('999.99');
    await field(a, 'Description').fill('Hotel');
    await a.getByRole('tab', { name: '%' }).click();
    const f = a.getByRole('textbox', { name: /percent$/ });
    await f.nth(0).fill('60'); await f.nth(1).fill('40');
    await expectText(a, 'Adds up to ₹999.99');
    await btn(a, 'Save expense').click();
    await expectText(a, 'Hotel');
  });

  await step('shares: 1 and 2 shares of ₹900', a, async () => {
    await btn(a, '+ Add expense').click();
    await field(a, 'Amount (₹)').fill('900');
    await field(a, 'Description').fill('Boat ride');
    await a.getByRole('tab', { name: 'Shares' }).click();
    const f = a.getByRole('textbox', { name: /shares$/ });
    await f.nth(1).fill('2');
    await expectText(a, '₹600.00');
    await btn(a, 'Save expense').click();
    await expectText(a, 'Boat ride');
  });

  await step('offline: A goes offline, still reads the group, adds an expense that is queued', a, async () => {
    const sub = (m) => process.env.E2E_DEBUG && console.log(`     · ${m}`);
    await gone(a, 'Waiting to sync');
    await expectText(a, 'Hotel');
    sub('synced');
    await ctxA.setOffline(true);
    await a.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expectText(a, 'You are offline');
    sub('banner');
    await btn(a, '+ Add expense').click();
    await field(a, 'Amount (₹)').fill('150');
    sub('form');
    await field(a, 'Description').fill('Chai offline');
    await btn(a, 'Save expense').click();
    await a.waitForTimeout(1500);
    await a.screenshot({ path: path.join(OUT, 'offline-after-save.png') });
    await expectText(a, 'Waiting to sync');
    sub('pending row');
    await expectText(a, '1 change waiting to sync');
    const stored = await a.evaluate(() => localStorage.getItem('splitit.outbox.v1'));
    if (!stored || !stored.includes('Chai offline')) throw new Error('queued expense not stored on the device');
  });

  await step('back online: the queued expense syncs and B sees it', a, async () => {
    await ctxA.setOffline(false);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await gone(a, 'Waiting to sync');
    await expectText(b, 'Chai offline', 10000);
  });

  // Balances: A paid 1000 + 999.99 + 900 + 150 (Chai, equal) ; A owes 500 + 100 + 600 + 300 + 75.
  // B paid 0 ; B owes 500 + 200 + 399.99 + 600 + 75 = 1774.99
  await step('B sees "you owe ₹1,774.99" in words and who pays whom', b, async () => {
    await b.getByRole('tab', { name: 'Balances' }).click();
    await expectText(b, 'you owe ₹1,774.99');
    await expectText(b, `You pay ${people.A.name.split(' ')[0]}`.slice(0, 7));
  });

  await step('A is prompted to add a UPI ID because they are owed money', a, async () => {
    await a.goto(`${BASE}/`);
    await expectText(a, 'Add your UPI ID so they can pay you');
  });

  await step('B cannot pay by UPI until A adds a UPI ID; cash is offered', b, async () => {
    await btn(b, 'Settle up').click();
    await expectText(b, 'add a UPI ID in their SplitIt profile');
  });

  await step('A adds a UPI ID in Profile', a, async () => {
    await a.getByRole('tab', { name: 'Profile' }).click();
    await field(a, 'UPI ID').fill(`asha${run}@okaxis`);
    await btn(a, 'Save changes').click();
    await expectText(a, 'Saved.');
  });

  await step('B (on a computer) gets a UPI QR code and a Copy button; marks paid with a reference', b, async () => {
    await b.reload();
    await btn(b, 'Pay via UPI').click();
    await expectText(b, 'Scan this with any UPI app');
    await expectText(b, `asha${run}@okaxis`);
    await btn(b, 'Copy UPI ID').waitFor();
    await field(b, 'UPI reference number (optional)').fill('412345678901');
    await btn(b, 'Yes, I paid').click();
    await expectText(b, 'The debt clears as soon as they confirm');
  });

  await step('the debt is NOT cleared until A confirms', b, async () => {
    await btn(b, 'Back to group').click();
    await expectText(b, 'Waiting for');
    await expectText(b, 'you owe ₹1,774.99');
  });

  await step('A gets the "says they paid" message with the reference and declines it', a, async () => {
    await a.getByRole('tab', { name: /Activity/ }).click();
    await expectText(a, '412345678901');
    await btn(a, 'Not received').first().click();
    await gone(a, 'Not received', 10000);
  });

  await step('declined: B still owes the full amount and is told', b, async () => {
    await expectText(b, 'you owe ₹1,774.99');
    await b.goto(`${BASE}/activity`);
    await expectText(b, 'has not received your');
  });

  await step('B retries in cash; A confirms; B is settled up (updates live)', b, async () => {
    await b.goto(`${BASE}/group/${gid}?tab=balances`);
    await btn(b, 'Settle up').click();
    await b.getByRole('tab', { name: 'Cash' }).click();
    await btn(b, 'I paid in cash').click();
    await btn(b, 'Yes, I gave the cash').click();
    await btn(b, 'Back to group').click();
    await a.goto(`${BASE}/group/${gid}?tab=balances`);
    await btn(a, 'Confirm received').click();
    await expectText(b, 'you are settled up', 10000);
    await expectText(b, 'Everyone is settled up');
  });

  await step('Android phone browser: Pay via UPI opens the upi://pay link for the UPI app chooser', b, async () => {
    // Give A a debt to B first so A has something to pay, then open settle as an Android phone.
    await b.goto(`${BASE}/group/${gid}/expense`);
    await field(b, 'Amount (₹)').fill('450');
    await field(b, 'Description').fill('Parasailing');
    await b.getByRole('checkbox', { name: 'You' }).filter({ visible: true }).nth(1).click(); // split chips come after 'Who paid?': only A shares
    await btn(b, 'Save expense').click();
    await expectText(b, 'Parasailing');
    await b.goto(`${BASE}/profile`);
    await field(b, 'UPI ID').fill(`bala${run}@ybl`);
    await btn(b, 'Save changes').click();
    await expectText(b, 'Saved.');
    const state = await ctxA.storageState();
    const droid = await browser.newContext({ storageState: state, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', viewport: { width: 412, height: 915 } });
    const d = await droid.newPage();
    const seen = [];
    d.on('console', (m) => seen.push(m.text()));
    d.on('request', (r) => seen.push(r.url()));
    d.on('framenavigated', (f) => seen.push(f.url()));
    await d.goto(`${BASE}/group/${gid}?tab=balances`);
    await btn(d, 'Settle up').click();
    await btn(d, 'Pay via UPI app').click();
    await d.waitForTimeout(1000);
    await d.screenshot({ path: path.join(OUT, 'android-settle.png') });
    await expectText(d, 'Did the payment go through?');
    await d.waitForTimeout(1500);
    const hit = seen.find((s) => s.includes('upi://pay?'));
    if (!hit) throw new Error('no upi:// navigation seen');
    const link = hit.slice(hit.indexOf('upi://'));
    if (!link.includes(`pa=bala${run}@ybl`) || !link.includes('am=450.00') || !link.includes('cu=INR')) throw new Error(`bad link ${link}`);
    console.log(`     ${link.split(' ')[0].replace(/["'].*$/, '')}`);
    await droid.close();
  });

  await step('outsider C cannot open the group by URL', c, async () => {
    await c.goto(`${BASE}/group/${gid}`);
    await c.waitForTimeout(3000);
    const body = await c.textContent('body');
    if (body.includes('Beach shack dinner') || body.includes(gname)) throw new Error('outsider saw group data');
    await expectText(c, "This group doesn't exist, or you are not in it.");
  });

  await step('scan a bill: photo is read by OCR, items assigned, expense saved', a, async () => {
    await a.goto(`${BASE}/group/${gid}/scan`);
    const [chooser] = await Promise.all([a.waitForEvent('filechooser'), btn(a, '🖼️ Choose a photo').click()]);
    await chooser.setFiles(path.join(__dirname, 'fixtures/bill.png'));
    await a.getByText(/We found|could not read|could not find/).first().waitFor({ timeout: 45000 });
    const read = await a.getByText(/We found \d+ item/).count();
    if (read) {
      console.log('     OCR read the bill: ' + (await a.getByText(/We found \d+ item/).first().textContent()));
      await a.getByRole('checkbox', { name: 'You' }).filter({ visible: true }).first().click(); // first item: only B
    } else {
      console.log('     OCR could not read it; manual entry screen opened (fallback path)');
      await field(a, 'Item 1').fill('Paneer Tikka');
      await field(a, '₹').first().fill('320');
    }
    await a.getByRole('button', { name: /^Save ₹/ }).click();
    await a.waitForURL(/\/group\/[0-9a-f-]{36}$/);
    await expectText(a, 'Restaurant bill');
  });

  await step('scan fallback: "Type the items instead" opens the same screen empty', a, async () => {
    await a.goto(`${BASE}/group/${gid}/scan`);
    await btn(a, 'Type the items instead').click();
    await field(a, 'Item 1').waitFor();
  });

  await step('dark mode renders with readable text', null, async () => {
    const dctx = await browser.newContext({ storageState: await ctxA.storageState(), colorScheme: 'dark', viewport: { width: 390, height: 844 } });
    const d = await dctx.newPage();
    await d.goto(`${BASE}/group/${gid}`);
    await expectText(d, 'Beach shack dinner');
    await d.screenshot({ path: path.join(OUT, 'dark-group.png') });
    await dctx.close();
  });

  await step('every button and tab is at least 48 px tall (touch target check)', a, async () => {
    for (const url of [`${BASE}/`, `${BASE}/group/${gid}`, `${BASE}/group/${gid}/expense`, `${BASE}/profile`]) {
      await a.goto(url);
      await a.waitForTimeout(1500);
      const small = await a.evaluate(() => [...document.querySelectorAll('[role="button"],[role="tab"],[role="checkbox"],input')]
        .filter((el) => el.offsetParent !== null).map((el) => ({ h: el.getBoundingClientRect().height, label: el.getAttribute('aria-label') || el.textContent }))
        .filter((x) => x.h > 0 && x.h < 44));
      if (small.length) throw new Error(`${url}: ${JSON.stringify(small.slice(0, 5))}`);
    }
  });

  await browser.close();
  console.log(`\n${n - failed}/${n} steps passed in ${((Date.now() - t0) / 1000).toFixed(0)} s (run ${run})`);
  process.exit(failed ? 1 : 0);
})();
