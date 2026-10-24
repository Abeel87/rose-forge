import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCraft, calculateRefinement, parseNumber } from '../dist/calc.js';

const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);
const step = (level, success, failureDrop = 0, quantity = 1, fee = 0) => ({ level, success, failureDrop, materials: [{ id: 'ore', quantity }], fee });

test('Polish input distinguishes zero from missing and invalid values', () => {
  assert.equal(parseNumber('1 234,50'), 1234.5);
  assert.equal(parseNumber('1\u202f234.50'), 1234.5);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber('1,234.50'), null);
  assert.equal(parseNumber('not a number'), null);
  assert.equal(parseNumber(Infinity), null);
});

test('craft batches, duplicate materials and inventory preserve market opportunity cost', () => {
  const result = calculateCraft({ materials: [{ id: 'ore', quantity: 2 }, { id: 'ore', quantity: 1 }], quantity: 5, outputQuantity: 2, prices: { ore: 10 }, inventory: { ore: 4 }, fee: 5 });
  assert.equal(result.status, 'ok');
  assert.equal(result.runs, 3);
  assert.equal(result.producedQuantity, 6);
  assert.equal(result.surplusQuantity, 1);
  assert.deepEqual(result.materials.map(({ required, owned, use, buy }) => ({ required, owned, use, buy })), [{ required: 9, owned: 4, use: 4, buy: 5 }]);
  assert.equal(result.marketCost, 105);
  assert.equal(result.cashCost, 65);
});

test('craft unknown market price can still give a known cash cost when stock covers materials', () => {
  const args = { materials: [{ id: 'ore', quantity: 2 }], quantity: 1, inventory: { ore: 2 }, fee: 7 };
  const result = calculateCraft(args);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.marketCost, null);
  assert.equal(result.cashCost, 7);
  assert.deepEqual(result.unknownPriceIds, ['ore']);
  assert.deepEqual(result.unknownCashPriceIds, []);
  assert.equal(calculateCraft({ ...args, prices: { ore: 0 } }).marketCost, 7);
});

test('craft zero quantity costs zero even with unknown prices and fee', () => {
  const result = calculateCraft({ materials: [{ id: 'ore', quantity: 2 }], quantity: 0, fee: null });
  assert.equal(result.status, 'ok');
  assert.equal(result.runs, 0);
  assert.equal(result.marketCost, 0);
  assert.equal(result.cashCost, 0);
});

test('craft rejects negative values rather than turning them into cheap materials', () => {
  assert.equal(calculateCraft({ materials: [{ id: 'ore', quantity: -1 }] }).status, 'invalid');
  assert.equal(calculateCraft({ materials: [{ id: 'ore', quantity: 1 }], prices: { ore: -5 } }).status, 'invalid');
  assert.equal(calculateCraft({ materials: [], fee: -1 }).status, 'invalid');
});

test('certain refinement uses each level once and sums different material quantities and fees', () => {
  const result = calculateRefinement({ start: 0, target: 2, steps: [step(1, 1, 0, 2, 3), step(2, 1, 1, 4, 5)], prices: { ore: 10 }, maxAttempts: 2 });
  assert.equal(result.status, 'ok');
  assert.equal(result.expectedAttempts, 2);
  assert.equal(result.expectedCost, 68);
  assert.equal(result.minimumCost, 68);
  assert.equal(result.materials[0].expectedQuantity, 6);
  assert.equal(result.successWithinAttempts.probability, 1);
});

test('one state with 50% success and no downgrade is geometric: two expected attempts', () => {
  const result = calculateRefinement({ start: 6, target: 7, steps: [step(7, .5, 0, 1, 2)], prices: { ore: 10 }, maxAttempts: 3 });
  assert.equal(result.status, 'ok');
  near(result.expectedAttempts, 2);
  near(result.expectedCost, 24);
  near(result.minimumCost, 12);
  near(result.successWithinAttempts.probability, .875);
  assert.deepEqual(result.requiredLevels, [7]);
});

test('downgrades include the expected cost of redoing earlier levels', () => {
  const result = calculateRefinement({ start: 0, target: 2, steps: [step(1, .5), step(2, .5, 1)], prices: { ore: 10 }, maxAttempts: 2 });
  assert.equal(result.status, 'ok');
  near(result.expectedAttempts, 6);
  near(result.attemptsByLevel[0].expectedAttempts, 4);
  near(result.attemptsByLevel[1].expectedAttempts, 2);
  near(result.expectedCost, 60);
  near(result.minimumCost, 20);
  near(result.successWithinAttempts.probability, .25);
});

test('starting above zero still includes reachable recovery levels below the starting item', () => {
  const result = calculateRefinement({ start: 1, target: 2, steps: [step(1, .5), step(2, .5, 1)], prices: { ore: 10 } });
  assert.equal(result.status, 'ok');
  near(result.expectedAttempts, 4);
  near(result.expectedCost, 40);
  near(result.minimumCost, 10);
  assert.deepEqual(result.requiredLevels, [1, 2]);
  assert.equal(result.attemptsByLevel[0].minimumAttempts, 0);
});

test('unknown recovery data is exposed, while unreachable empty lower steps are ignored', () => {
  const missing = calculateRefinement({ start: 1, target: 2, steps: [step(2, .5, 1)], prices: { ore: 10 } });
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.computationReady, false);
  assert.ok(missing.issues.some(item => item.code === 'MISSING_STEP' && item.level === 1));
  const stay = calculateRefinement({ start: 1, target: 2, steps: [{ level: 1, success: null }, step(2, .5, 0)], prices: { ore: 10 } });
  assert.equal(stay.status, 'ok');
  assert.deepEqual(stay.requiredLevels, [2]);
});

test('zero success reports an impossible goal, not a finite cost', () => {
  const result = calculateRefinement({ start: 0, target: 1, steps: [step(1, 0)], prices: { ore: 10 } });
  assert.equal(result.status, 'impossible');
  assert.equal(result.expectedAttempts, null);
  assert.equal(result.expectedCost, null);
  assert.equal(result.successWithinAttempts.probability, 0);
});

test('positive chance of getting trapped also has no finite unconditional expected cost', () => {
  const result = calculateRefinement({ start: 1, target: 2, steps: [step(1, 0), step(2, .5, 1)], prices: { ore: 10 } });
  assert.equal(result.status, 'impossible');
  assert.equal(result.targetReachable, true);
  assert.equal(result.expectedCost, null);
  assert.equal(result.successWithinAttempts.probability, .5);
  assert.ok(result.issues.some(item => item.code === 'NON_ABSORBING_STATES'));
});

test('missing price and missing fee retain calculable expectations and only known costs', () => {
  const noPrice = calculateRefinement({ target: 1, steps: [step(1, .5, 0, 1, 2)] });
  assert.equal(noPrice.status, 'incomplete');
  assert.equal(noPrice.computationReady, true);
  near(noPrice.expectedAttempts, 2);
  near(noPrice.expectedKnownCost, 4);
  assert.equal(noPrice.expectedCost, null);
  assert.deepEqual(noPrice.unknownPriceIds, ['ore']);
  const noFee = calculateRefinement({ target: 1, steps: [step(1, .5, 0, 1, null)], prices: { ore: 10 } });
  near(noFee.expectedKnownCost, 20);
  assert.equal(noFee.expectedCost, null);
  assert.deepEqual(noFee.unknownFeeLevels, [1]);
  const zeroPrice = calculateRefinement({ target: 1, steps: [step(1, .5, 0, 1, 0)], prices: { ore: 0 } });
  assert.equal(zeroPrice.status, 'ok');
  assert.equal(zeroPrice.expectedCost, 0);
});

test('already at or above target is complete without any step definitions', () => {
  for (const [start, target] of [[5, 5], [6, 5]]) {
    const result = calculateRefinement({ start, target, maxAttempts: 0 });
    assert.equal(result.status, 'ok');
    assert.equal(result.expectedAttempts, 0);
    assert.equal(result.expectedCost, 0);
    assert.equal(result.successWithinAttempts.probability, 1);
  }
});

test('finite attempt probability counts all paths, not only consecutive success', () => {
  const result = calculateRefinement({ target: 2, steps: [step(1, .5), step(2, .5)], prices: { ore: 1 }, maxAttempts: 3 });
  near(result.successWithinAttempts.probability, .5);
});

test('missing and out-of-range probabilities are not silently invented or clamped', () => {
  const missing = calculateRefinement({ target: 1, steps: [step(1, null)] });
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.expectedAttempts, null);
  const invalid = calculateRefinement({ target: 1, steps: [step(1, 50)] });
  assert.equal(invalid.status, 'invalid');
});

test('inputs are never mutated', () => {
  const input = { start: 0, target: 2, steps: [step(1, .8), step(2, .6, 1)], prices: { ore: 5 } };
  const before = structuredClone(input);
  calculateRefinement(input);
  assert.deepEqual(input, before);
});
