const {test, expect} = require('@playwright/test');

test('sign-in protects data and sign-out clears private browser state', async ({page, context}) => {
  const response = await page.request.get('/export', {maxRedirects:0});
  expect(response.status()).toBe(302);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Sign in to IronTrack'})).toBeVisible();
  await page.getByLabel('Username',{exact:true}).fill('owner');
  await page.getByLabel('Password',{exact:true}).fill('browser-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('#set-weight')).toBeVisible();
  await page.evaluate(async () => {
    localStorage.setItem('irontrack-theme','light');
    localStorage.setItem('irontrack-pending-workouts',JSON.stringify([{entry_id:'auth-browser',date:'2026-11-07',muscle:'Chest',exercise:'Barbell Bench Press',weight:'20',reps:'bad',rpe:'7',unit:'kg'}]));
    await (await caches.open('irontrack-test-private')).put('/private-test', new Response('private workout'));
  });
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('#offline-status')).toContainText('Sync your pending sets before signing out');
  await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('irontrack-pending-workouts'));
    queue[0].reps = '8';
    localStorage.setItem('irontrack-pending-workouts',JSON.stringify(queue));
    return syncOfflineWorkouts();
  });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irontrack-pending-workouts')).length)).toBe(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to IronTrack'})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('irontrack-theme'))).toBeNull();
  expect(await page.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('irontrack-')).length)).toBe(0);
  expect((await context.request.get('/csrf-token')).status()).toBe(401);
});
