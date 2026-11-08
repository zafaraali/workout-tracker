const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('static/training.js', 'utf8'), context);
const progress = (records, goal = 12, routines = []) => context.trainingProgress(records, goal, '', routines);
const set = (overrides = {}) => ({exercise: 'Bench', date: '2026-11-07', session_id: 'new', weight: '50', reps: '12', rpe: '7', unit: 'kg', finished: true, ...overrides});

test('warmups and drop sets never trigger a load increase', () => {
  const result = progress([set({set_type:'warmup', weight:'100'}), set({set_type:'drop', weight:'10'}), set({reps:'10'})]);
  assert.equal(result.ready, false);
  assert.equal(result.weight, 50);
  assert.equal(result.hits, 0);
});
test('planned set count and completion gate the next load', () => {
  const routines = [{id:'r', exercises:[{exercise:'Bench', target_sets:3}]}];
  assert.equal(progress([set({routine_id:'r', routine_slot:0})],12,routines).ready,false);
  assert.equal(progress([set({finished:false})]).ready,false);
  assert.equal(progress([set({rpe:''})]).ready,false);
  assert.equal(progress([set(),set(),set()]).weight,52.5);
});
test('three completed flat sessions flag a plateau and mixed units normalize', () => {
  const result = progress([set({weight:'110.231131',unit:'lb',reps:'8'}),set({session_id:'old2',reps:'8'}),set({session_id:'old1',reps:'8'})]);
  assert.equal(result.stalled,true);
  assert.equal(progress([set({reps:'10'}),set({session_id:'old2',reps:'8'}),set({session_id:'old1',reps:'8'})]).stalled,false);
});
