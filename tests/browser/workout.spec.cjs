const {test, expect} = require('@playwright/test');

test('offline set survives reconnect and syncs exactly once with a fresh token', async ({page, context}) => {
  await page.goto('/');
  await context.setOffline(true);
  await page.locator('#set-weight').fill('72.5');
  await page.locator('#set-reps').fill('8');
  await page.getByRole('button', {name: 'Log Set', exact: true}).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irontrack-pending-workouts')).length)).toBe(1);
  // Change the cookie session to simulate an expired CSRF token.
  await context.clearCookies();
  await context.setOffline(false);
  await page.evaluate(() => syncOfflineWorkouts());
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irontrack-pending-workouts')).length)).toBe(0);
  await page.evaluate(() => syncOfflineWorkouts());
  const backup = await (await page.request.get('/export')).json();
  expect(backup.workouts.filter(set => set.weight === '72.5')).toHaveLength(1);
});

test('invalid queued entry does not block a valid set and can be repaired', async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const base = {date: '2026-11-07', muscle: 'Chest', exercise: 'Barbell Bench Press', weight: '55', reps: '8', rpe: '7', unit: 'kg'};
    localStorage.setItem('irontrack-pending-workouts', JSON.stringify([
      {...base, entry_id: 'invalid-browser', reps: 'bad'},
      {...base, entry_id: 'valid-browser'},
    ]));
    return syncOfflineWorkouts();
  });
  await expect(page.locator('#queued-workouts')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irontrack-pending-workouts')).length)).toBe(1);
  await page.locator('#queued-workouts > summary').click();
  await page.getByText('Edit pending set', {exact: true}).click();
  await page.locator('#queued-workouts input[name="reps"]').fill('8');
  await page.getByRole('button', {name: 'Save changes and retry'}).click();
  await expect(page.locator('#queued-workouts')).toBeHidden();
});

test('mobile logger repeats the last set, focuses training, and undoes deletion', async ({page}) => {
  await page.goto('/');
  await page.locator('#set-weight').fill('61');
  await page.locator('#set-reps').fill('9');
  await page.getByRole('button', {name: 'Log Set', exact: true}).click();
  await expect(page.locator('#last-performance')).toContainText('61 kg × 9');
  await page.getByRole('button', {name: 'Repeat last set', exact: true}).click();
  await expect(page.locator('#set-weight')).toHaveValue('61');
  await page.getByRole('button', {name: 'Toggle workout focus'}).click();
  await expect(page.locator('#section-log .log-entry-card')).toBeVisible();
  await expect(page.locator('#exercise-history-panel')).toBeHidden();
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('form[action$="/delete"] button').last().click();
  await expect(page.getByRole('button', {name: 'Undo deletion'})).toBeVisible();
  await page.getByRole('button', {name: 'Undo deletion'}).click();
  await expect(page.getByRole('button', {name: 'Undo deletion'})).toHaveCount(0);
  const backup = await (await page.request.get('/export')).json();
  expect(backup.workouts.some(set => set.weight === '61')).toBe(true);
});

test('routine targets advance after logging and rest timer starts and stops', async ({page}) => {
  await page.goto('/');
  const token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  await page.request.post('/save_routine', {form: {
    csrf_token: token, mode: 'builder', name: 'Browser training',
    exercises_json: JSON.stringify([
      {muscle: 'Chest', exercise: 'Barbell Bench Press', target_sets: 2, target_reps: '8', target_weight: '40', weight_increment: '2.5', rest_seconds: 30},
      {muscle: 'Back', exercise: 'Barbell Row', target_sets: 2, target_reps: '10', target_weight: '30'},
    ]),
  }});
  await page.goto('/?tab=routines');
  await page.getByRole('button', {name: 'Start routine now'}).click();
  await expect(page.locator('#set-weight')).toHaveValue('40');
  await expect(page.locator('#set-reps')).toHaveValue('8');
  await page.getByRole('button', {name: 'Log Set', exact: true}).click();
  await expect(page.locator('#set-weight')).toHaveValue('42.5');
  await expect(page.locator('#routine-checklist-summary')).toContainText('1 of 2');
  await page.locator('#timer-start').click();
  await expect(page.locator('#active-timer')).toBeVisible();
  await expect(page.locator('#timer-start')).toBeDisabled();
  await page.locator('#timer-stop').click();
  await expect(page.locator('#active-timer')).toBeHidden();
  await page.getByRole('button', {name: 'Next routine exercise'}).click();
  await expect(page.locator('#exercise-select')).toHaveValue('Barbell Row');
  await expect(page.locator('#set-weight')).toHaveValue('30');
});

test('quick controls, substitutions, and weekly review work on mobile', async ({page}) => {
  await page.goto('/');
  await page.locator('#set-weight').fill('20');
  await page.locator('#weight-increment').selectOption('2.5');
  await page.getByRole('button', {name: 'Increase weight', exact: true}).click();
  await expect(page.locator('#set-weight')).toHaveValue('22.5');
  await page.locator('#set-reps').fill('8');
  await page.getByRole('button', {name: 'Increase reps', exact: true}).click();
  await expect(page.locator('#set-reps')).toHaveValue('9');
  expect(await page.locator('#set-weight').getAttribute('inputmode')).toBe('decimal');
  const csrf_token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  await page.request.post('/save_routine', {form: {
    csrf_token, mode:'builder', name:'Substitution browser routine',
    exercises_json:JSON.stringify([{muscle:'Chest',exercise:'Barbell Bench Press',target_sets:2,target_reps:'8',target_weight:'50',rest_seconds:60}]),
  }});
  await page.goto('/?tab=routines');
  await page.locator('article').filter({has: page.getByRole('heading',{name:'Substitution browser routine',exact:true})}).getByRole('button',{name:'Start routine now'}).click();
  await page.getByRole('button',{name:'Log Set',exact:true}).click();
  await page.locator('#routine-substitution summary').click();
  await page.locator('#substitution-exercise').selectOption(JSON.stringify({muscle:'Chest',exercise:'Incline Dumbbell Press'}));
  await page.getByRole('button',{name:'Use replacement',exact:true}).click();
  await expect(page.locator('#exercise-select')).toHaveValue('Incline Dumbbell Press');
  await expect(page.locator('#set-weight')).toHaveValue('0');
  await expect(page.locator('#routine-checklist-summary')).toContainText('1 of 2');
  await page.locator('#set-weight').fill('20');
  await page.getByRole('button',{name:'Log Set',exact:true}).click();
  await expect(page.locator('#exercise-select')).toHaveValue('Incline Dumbbell Press');
  await expect(page.locator('#routine-checklist-summary')).toContainText('2 of 2');
  await page.getByRole('button',{name:'Finish workout',exact:true}).click();
  await expect(page.locator('#toast-container')).toContainText('Workout complete');
  await page.getByRole('tab',{name:'Progress',exact:true}).click();
  await expect(page.locator('#weekly-review')).toBeVisible();
  await expect(page.locator('#weekly-review')).toContainText('completed sessions');
  const backup = await (await page.request.get('/export')).json();
  const routine = backup.routines.find(r => r.name === 'Substitution browser routine');
  expect(routine.exercises[0].exercise).toBe('Barbell Bench Press');
  expect(backup.workouts.some(set => set.routine_id === routine.id && set.exercise === 'Incline Dumbbell Press' && set.routine_slot === 0)).toBe(true);
});

test('plate calculator shows per-side loading for the selected unit', async ({page}) => {
  await page.goto('/');
  await page.locator('#set-weight').fill('60');
  await page.getByRole('button', {name: 'Calculate plates', exact: true}).click();
  await expect(page.locator('#plate-calculator-result')).toContainText('Per side');
  await expect(page.locator('#plate-calculator-result')).toContainText('20 kg');
  await page.locator('#weight-unit').selectOption('lb');
  await page.locator('#set-weight').fill('135');
  await page.getByRole('button', {name: 'Calculate plates', exact: true}).click();
  await expect(page.locator('#plate-calculator-result')).toContainText('lb');
});

test('logger shows an inline validation message for invalid strength values', async ({page}) => {
  await page.goto('/');
  await page.locator('#set-reps').fill('0');
  await page.getByRole('button', {name: 'Log Set', exact: true}).click();
  await expect(page.locator('#logger-validation-message')).toContainText('at least 1 rep');
});


test('swipe reveals explicit actions and deletion retains confirmation', async ({page}) => {
  await page.goto('/?tab=history');
  const row = page.locator('[data-swipe-set]').first();
  await row.dispatchEvent('touchstart', {touches:[{identifier:0,clientX:300,clientY:100}]});
  await row.dispatchEvent('touchend', {changedTouches:[{identifier:0,clientX:100,clientY:105}]});
  await expect(row.locator('.swipe-actions')).toBeVisible();
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Delete this set'); await dialog.dismiss(); });
  await row.locator('.swipe-actions').getByRole('button',{name:'Delete set',exact:true}).click();
  await expect(row).toBeVisible();
  await row.locator('.swipe-actions').getByRole('button',{name:'Close actions'}).click();
  await expect(row.locator('.swipe-actions')).toBeHidden();
});

test('bulk history deletion can be undone', async ({page}) => {
  await page.goto('/');
  for (const weight of ['83', '84']) {
    await page.locator('#set-weight').fill(weight);
    await page.getByRole('button', {name: 'Log Set', exact: true}).click();
  }
  await page.goto('/?tab=history');
  await page.locator('.history-set-checkbox').nth(0).check();
  await page.locator('.history-set-checkbox').nth(1).check();
  await expect(page.locator('#bulk-history-count')).toHaveText('2 sets selected');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#bulk-history-delete').click();
  await expect(page.getByRole('button', {name: 'Undo deletion'})).toBeVisible();
  await page.getByRole('button', {name: 'Undo deletion'}).click();
  await expect(page.getByRole('button', {name: 'Undo deletion'})).toHaveCount(0);
});

test('deleting an entire workout can be undone', async ({page}) => {
  await page.goto('/');
  for (const weight of ['88', '89']) {
    await page.locator('#set-weight').fill(weight);
    await page.getByRole('button', {name: 'Log Set', exact: true}).click();
  }
  await page.goto('/?tab=history');
  const latestWorkout = page.locator('.history-workout').first();
  await expect(latestWorkout).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await latestWorkout.getByRole('button', {name: 'Delete entire workout', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Undo deletion'})).toBeVisible();
  await page.getByRole('button', {name: 'Undo deletion'}).click();
  await expect(page.getByRole('button', {name: 'Undo deletion'})).toHaveCount(0);
  await expect(page.locator('.history-workout').first()).toBeVisible();
});

test('history filters narrow results and clear together', async ({page}) => {
  await page.goto('/');
  await page.locator('#set-weight').fill('46');
  await page.locator('#set-reps').fill('8');
  await page.getByRole('button', {name: 'Log Set', exact: true}).click();
  await page.goto('/?tab=history');
  const workout = page.locator('.history-workout').first();
  await expect(workout).toBeVisible();

  await page.locator('#history-type-filter').selectOption('cardio');
  await expect(workout).toBeHidden();
  await expect(page.locator('#history-search-empty')).toBeVisible();

  await page.getByRole('button', {name: 'Clear', exact: true}).click();
  await expect(workout).toBeVisible();
  await expect(page.locator('#history-search-empty')).toBeHidden();
});

test('CSV preview reports whether required columns are present', async ({page}) => {
  await page.goto('/?tab=history');
  const file = page.locator('#workouts-file');
  await file.setInputFiles({
    name: 'workouts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Exercise Name,Weight\n2026-11-08,Barbell Bench Press,50\n'),
  });
  await expect(page.locator('.csv-preview-ready')).toContainText('Ready to import');
  await file.setInputFiles({
    name: 'invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Workout Name,Weight\nPush Day,50\n'),
  });
  await expect(page.locator('.csv-preview-warning')).toContainText('date and exercise');
});

test('routine search shows a useful filtered empty state', async ({page}) => {
  await page.goto('/?tab=routines');
  const csrf_token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  await page.request.post('/save_routine', {form: {
    csrf_token,
    mode: 'builder',
    name: 'Searchable routine',
    exercises_json: JSON.stringify([{muscle: 'Chest', exercise: 'Barbell Bench Press', target_sets: 2, target_reps: '8'}]),
  }});
  await page.goto('/?tab=routines');
  const search = page.locator('#routine-search');
  await expect(search).toBeVisible();
  const routines = page.locator('.routine-card');
  const count = await routines.count();
  await search.fill('no routine with this name');
  expect(count).toBeGreaterThan(0);
  await expect(routines.first()).toBeHidden();
  await expect(page.locator('#routine-search-empty')).toBeVisible();
  await search.fill('');
  await expect(page.locator('#routine-search-empty')).toBeHidden();
});

test('measurement search shows a filtered empty state', async ({page}) => {
  await page.goto('/?tab=measurements');
  const csrf_token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  await page.request.post('/save_measurement', {form: {
    csrf_token,
    date: '2026-11-08',
    body_weight: '82',
    unit: 'kg',
    waist: '84',
    chest: '',
    hips: '',
    notes: 'Searchable measurement',
  }});
  await page.goto('/?tab=measurements');
  const search = page.locator('#measurement-search');
  await expect(search).toBeVisible();
  const measurements = page.locator('.measurement-history-item');
  expect(await measurements.count()).toBeGreaterThan(0);
  await search.fill('no measurement with this text');
  await expect(measurements.first()).toBeHidden();
  await expect(page.locator('#measurement-search-empty')).toBeVisible();
  await search.fill('');
  await expect(page.locator('#measurement-search-empty')).toBeHidden();
});

test('tab navigation exposes panel visibility to assistive technology', async ({page}) => {
  await page.goto('/');
  await page.getByRole('tab', {name: 'Progress', exact: true}).click();
  await expect(page.locator('#section-progress')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#section-log')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('tab', {name: 'Progress', exact: true})).toHaveAttribute('aria-selected', 'true');
});

test('active tab survives a page reload', async ({page}) => {
  await page.goto('/');
  await page.getByRole('tab', {name: 'History', exact: true}).click();
  expect(new URL(page.url()).searchParams.get('tab')).toBe('history');
  await page.reload();
  await expect(page.locator('#section-history')).toBeVisible();
  await expect(page.locator('#section-log')).toBeHidden();
});

test('keyboard shortcuts navigate between workout sections', async ({page}) => {
  await page.goto('/');
  await page.keyboard.press('h');
  await expect(page.locator('#section-history')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.locator('#section-progress')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.locator('#section-routines')).toBeVisible();
});

test('compact mobile logging mode persists across reloads', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Compact mode', exact: true}).click();
  await expect(page.locator('body')).toHaveClass(/compact-log/);
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/compact-log/);
  await expect(page.getByRole('button', {name: 'Full mode', exact: true})).toBeVisible();
});

test.describe('installed offline shell', () => {
  test.use({serviceWorkers: 'allow'});
  test('reloads with local styling and accepts a queued set offline', async ({page, context}) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true}));
      }
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#set-weight')).toBeVisible();
    expect(await page.locator('#section-history').evaluate(element => getComputedStyle(element).display)).toBe('none');
    await page.locator('#set-weight').fill('37');
    await page.getByRole('button', {name: 'Log Set', exact: true}).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irontrack-pending-workouts')).length)).toBe(1);
  });
});
