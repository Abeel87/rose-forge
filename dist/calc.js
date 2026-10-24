/**
 * ROSE Forge calculation engine. No game probabilities or market prices are
 * assumed: every refinement transition comes from the supplied game settings.
 */

/** Accept finite numbers, Polish decimal commas and spaces used as grouping. */
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[\s\u00a0\u202f]/g, '');
  if (!clean || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(clean)) return null;
  const number = Number(clean.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function own(record, id) {
  return record && Object.prototype.hasOwnProperty.call(record, id) ? record[id] : null;
}

function issue(code, field, message, detail = {}) {
  return { code, field, message, ...detail };
}

function priceFor(prices, id, issues) {
  const raw = own(prices, id);
  const price = parseNumber(raw);
  if (price !== null && price < 0) {
    issues.push(issue('INVALID_PRICE', `prices.${id}`, 'Cena nie może być ujemna.', { id }));
    return null;
  }
  return price;
}

function materialMap(materials, field, issues) {
  if (!Array.isArray(materials)) return null;
  const result = new Map();
  for (const [index, material] of materials.entries()) {
    const id = material?.id;
    const quantity = parseNumber(material?.quantity);
    if (typeof id !== 'string' || !id.trim() || quantity === null || quantity < 0) {
      issues.push(issue('INVALID_MATERIAL', `${field}.${index}`, 'Materiał musi mieć identyfikator i nieujemną liczbę sztuk.'));
      continue;
    }
    result.set(id, (result.get(id) || 0) + quantity);
  }
  return result;
}

/**
 * Cost of a deterministic number of crafting attempts. It does not assume a
 * success formula for crafting, CON, level, or material quality.
 *
 * Prices left blank are unknown; a typed zero means an actual zero price.
 * Inventory reduces cash spending but not the market value of materials used.
 */
export function calculateCraft({ materials, quantity = 1, outputQuantity = 1, fee = 0, prices = {}, inventory = {} } = {}) {
  const issues = [];
  const requested = parseNumber(quantity);
  const output = parseNumber(outputQuantity);
  const feeValue = parseNumber(fee);
  const combined = materialMap(materials, 'materials', issues);
  if (requested === null || requested < 0) issues.push(issue('INVALID_QUANTITY', 'quantity', 'Podaj nieujemną liczbę potrzebnych przedmiotów.'));
  if (output === null || output <= 0) issues.push(issue('INVALID_OUTPUT', 'outputQuantity', 'Liczba przedmiotów z jednej receptury musi być dodatnia.'));
  if (feeValue !== null && feeValue < 0) issues.push(issue('INVALID_FEE', 'fee', 'Opłata nie może być ujemna.'));
  if (combined === null) issues.push(issue('MISSING_MATERIALS', 'materials', 'Brakuje listy materiałów.'));
  if (issues.length) return { status: 'invalid', issues, runs: null, materials: [], marketCost: null, cashCost: null };

  const runs = Math.ceil(requested / output);
  const unknownPriceIds = [];
  const unknownCashPriceIds = [];
  let marketKnownCost = 0;
  let cashKnownCost = 0;
  const rows = [];
  for (const [id, perRun] of combined) {
    const required = perRun * runs;
    const rawOwned = own(inventory, id);
    const ownedValue = parseNumber(rawOwned);
    if (ownedValue !== null && ownedValue < 0) issues.push(issue('INVALID_INVENTORY', `inventory.${id}`, 'Liczba posiadanych materiałów nie może być ujemna.', { id }));
    const owned = Math.max(0, ownedValue ?? 0);
    const use = Math.min(owned, required);
    const buy = Math.max(0, required - use);
    const unitPrice = priceFor(prices, id, issues);
    const marketCost = required === 0 ? 0 : unitPrice === null ? null : required * unitPrice;
    const cashCost = buy === 0 ? 0 : unitPrice === null ? null : buy * unitPrice;
    if (marketCost === null) unknownPriceIds.push(id); else marketKnownCost += marketCost;
    if (cashCost === null) unknownCashPriceIds.push(id); else cashKnownCost += cashCost;
    rows.push({ id, perRun, required, owned, use, buy, unitPrice, marketCost, cashCost });
  }
  const unknownFee = runs > 0 && feeValue === null;
  const knownFeeCost = (feeValue ?? 0) * runs;
  marketKnownCost += knownFeeCost;
  cashKnownCost += knownFeeCost;
  if (!Number.isFinite(marketKnownCost) || !Number.isFinite(cashKnownCost) || !Number.isFinite(runs)) {
    issues.push(issue('NUMERIC_OVERFLOW', '', 'Wartości są zbyt duże, aby bezpiecznie obliczyć wynik.'));
  }
  const invalid = issues.length > 0;
  for (const id of unknownPriceIds) issues.push(issue('MISSING_PRICE', `prices.${id}`, 'Uzupełnij cenę materiału.', { id }));
  if (unknownFee) issues.push(issue('MISSING_FEE', 'fee', 'Uzupełnij opłatę za jedną próbę.'));
  return {
    status: invalid ? 'invalid' : issues.length ? 'incomplete' : 'ok',
    issues,
    runs,
    requestedQuantity: requested,
    producedQuantity: runs * output,
    surplusQuantity: runs * output - requested,
    outputQuantity: output,
    materials: rows,
    feePerRun: feeValue,
    feeCost: unknownFee ? null : knownFeeCost,
    marketKnownCost,
    cashKnownCost,
    marketCost: invalid || unknownPriceIds.length || unknownFee ? null : marketKnownCost,
    cashCost: invalid || unknownCashPriceIds.length || unknownFee ? null : cashKnownCost,
    unknownPriceIds,
    unknownCashPriceIds,
    unknownFee,
  };
}

/** Gaussian elimination with partial pivoting; does not mutate its inputs. */
function solveLinear(matrix, vector) {
  const n = vector.length;
  const rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (!Number.isFinite(rows[pivot][column]) || rows[pivot][column] === 0) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = column + 1; row < n; row++) {
      const factor = rows[row][column] / rows[column][column];
      rows[row][column] = 0;
      for (let j = column + 1; j <= n; j++) rows[row][j] -= factor * rows[column][j];
    }
  }
  const solution = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let value = rows[row][n];
    for (let j = row + 1; j < n; j++) value -= rows[row][j] * solution[j];
    solution[row] = value / rows[row][row];
    if (!Number.isFinite(solution[row])) return null;
  }
  return solution;
}

function probabilityWithin(start, target, states, maxAttempts) {
  let distribution = new Map([[start, 1]]);
  let arrived = start >= target ? 1 : 0;
  for (let attempt = 0; attempt < maxAttempts && distribution.size; attempt++) {
    const next = new Map();
    for (const [state, mass] of distribution) {
      const step = states.get(state);
      const succeeded = mass * step.success;
      if (state + 1 >= target) arrived += succeeded;
      else if (succeeded > 0) next.set(state + 1, (next.get(state + 1) || 0) + succeeded);
      const failed = mass * (1 - step.success);
      if (failed > 0) next.set(step.failureState, (next.get(step.failureState) || 0) + failed);
    }
    distribution = next;
  }
  return Math.max(0, Math.min(1, arrived));
}

function emptyRefinement(start, target, maxAttempts) {
  return {
    status: 'ok', issues: [], computationReady: true, costComplete: true,
    start, target, requiredLevels: [], expectedAttempts: 0, minimumAttempts: 0,
    attemptsByLevel: [], materials: [], expectedKnownCost: 0, expectedCost: 0,
    expectedFeeCost: 0, minimumKnownCost: 0, minimumCost: 0, minimumFeeCost: 0,
    unknownPriceIds: [], unknownFeeLevels: [], unknownMaterialLevels: [],
    minimumUnknownPriceIds: [], minimumUnknownFeeLevels: [],
    successWithinAttempts: { attempts: maxAttempts, probability: 1 },
  };
}

function unavailableRefinement(start, target, maxAttempts, status, issues, extra = {}) {
  return {
    ...emptyRefinement(start, target, maxAttempts),
    status, issues, computationReady: false, costComplete: false,
    expectedAttempts: null, minimumAttempts: null,
    expectedKnownCost: null, expectedCost: null, expectedFeeCost: null,
    minimumKnownCost: null, minimumCost: null, minimumFeeCost: null,
    successWithinAttempts: { attempts: maxAttempts, probability: null },
    ...extra,
  };
}

/**
 * Expected cost of refinement, including repeat attempts and recovery from
 * downgrades. `level` is the destination of a successful attempt: level 7 is
 * the attempt +6 -> +7. `success` is a probability in [0,1], NOT a percentage.
 * A failure from current = level - 1 goes to max(0, current - failureDrop).
 *
 * Only reachable states are required. When a downgrade reaches below `start`,
 * their recovery steps are included. Blank prices/fees do not become zero.
 * Results assume unchanged independent probabilities and unlimited retries.
 * `maxAttempts` is the attempt budget for the exact cumulative probability.
 */
export function calculateRefinement({ start = 0, target = 1, steps = [], prices = {}, maxAttempts = 100 } = {}) {
  const issues = [];
  start = parseNumber(start);
  target = parseNumber(target);
  maxAttempts = parseNumber(maxAttempts);
  if (!Number.isInteger(start) || start < 0 || start > 100) issues.push(issue('INVALID_START', 'start', 'Poziom początkowy musi być liczbą całkowitą od 0 do 100.'));
  if (!Number.isInteger(target) || target < 0 || target > 100) issues.push(issue('INVALID_TARGET', 'target', 'Poziom docelowy musi być liczbą całkowitą od 0 do 100.'));
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 100000) issues.push(issue('INVALID_ATTEMPT_LIMIT', 'maxAttempts', 'Limit prób musi być liczbą całkowitą od 0 do 100 000.'));
  if (!Array.isArray(steps)) issues.push(issue('INVALID_STEPS', 'steps', 'Potrzebna jest lista poziomów rafinacji.'));
  if (issues.length) return unavailableRefinement(start, target, maxAttempts, 'invalid', issues);
  if (start >= target) return emptyRefinement(start, target, maxAttempts);

  const supplied = new Map();
  const duplicates = new Set();
  for (const step of steps) {
    const level = parseNumber(step?.level);
    if (!Number.isInteger(level) || level < 1) continue;
    if (supplied.has(level)) duplicates.add(level);
    supplied.set(level, step);
  }
  const queue = [start];
  const visited = new Set();
  const states = new Map();
  const costIssues = [];
  let invalid = false;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current >= target || visited.has(current)) continue;
    visited.add(current);
    const level = current + 1;
    const source = supplied.get(level);
    if (!source) {
      issues.push(issue('MISSING_STEP', `steps.${level}`, `Uzupełnij dane próby +${current} → +${level}.`, { level }));
      continue;
    }
    if (duplicates.has(level)) {
      invalid = true;
      issues.push(issue('DUPLICATE_STEP', `steps.${level}`, 'Ten poziom występuje więcej niż raz.', { level }));
      continue;
    }
    const success = parseNumber(source.success);
    let failureDrop = parseNumber(source.failureDrop);
    if (success === null) {
      issues.push(issue('MISSING_SUCCESS', `steps.${level}.success`, 'Uzupełnij szansę powodzenia z okna gry.', { level }));
      continue;
    }
    if (success < 0 || success > 1) {
      invalid = true;
      issues.push(issue('INVALID_SUCCESS', `steps.${level}.success`, 'Prawdopodobieństwo musi mieścić się w przedziale 0–1.', { level }));
      continue;
    }
    if (success === 1 && failureDrop === null) failureDrop = 0;
    if (failureDrop === null) {
      issues.push(issue('MISSING_FAILURE_DROP', `steps.${level}.failureDrop`, 'Uzupełnij liczbę poziomów traconych po niepowodzeniu.', { level }));
      continue;
    }
    if (!Number.isInteger(failureDrop) || failureDrop < 0) {
      invalid = true;
      issues.push(issue('INVALID_FAILURE_DROP', `steps.${level}.failureDrop`, 'Spadek musi być nieujemną liczbą całkowitą.', { level }));
      continue;
    }
    const materials = materialMap(source.materials, `steps.${level}.materials`, costIssues);
    if (materials === null) costIssues.push(issue('MISSING_MATERIALS', `steps.${level}.materials`, 'Uzupełnij materiały potrzebne do tej próby.', { level }));
    const fee = parseNumber(source.fee);
    if (fee !== null && fee < 0) costIssues.push(issue('INVALID_FEE', `steps.${level}.fee`, 'Opłata nie może być ujemna.', { level }));
    const failureState = Math.max(0, current - failureDrop);
    states.set(current, { level, success, failureDrop, failureState, materials, fee });
    if (success > 0 && current + 1 < target) queue.push(current + 1);
    if (success < 1) queue.push(failureState);
  }
  const requiredLevels = [...visited].map(state => state + 1).sort((a, b) => a - b);
  if (issues.length) return unavailableRefinement(start, target, maxAttempts, invalid ? 'invalid' : 'incomplete', issues, { requiredLevels });

  // Every reachable state must have a path to the absorbing target. Otherwise
  // some trajectories never finish, and a finite unconditional mean is false.
  const canFinish = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [state, step] of states) {
      if (canFinish.has(state)) continue;
      if ((step.success > 0 && canFinish.has(state + 1)) || (step.success < 1 && canFinish.has(step.failureState))) {
        canFinish.add(state);
        changed = true;
      }
    }
  }
  const probability = probabilityWithin(start, target, states, maxAttempts);
  const trappedLevels = [...states.keys()].filter(state => !canFinish.has(state));
  if (trappedLevels.length) {
    const reachable = canFinish.has(start);
    issues.push(issue(reachable ? 'NON_ABSORBING_STATES' : 'UNREACHABLE_TARGET', 'steps', reachable
      ? 'Część niepowodzeń prowadzi do poziomów, z których nie można osiągnąć celu. Skończony średni koszt nie istnieje.'
      : 'Przy podanych szansach nie można osiągnąć poziomu docelowego.', { levels: trappedLevels }));
    return unavailableRefinement(start, target, maxAttempts, 'impossible', issues, {
      requiredLevels, targetReachable: reachable,
      successWithinAttempts: { attempts: maxAttempts, probability },
    });
  }

  const orderedStates = [...states.keys()].sort((a, b) => a - b);
  const indexByState = new Map(orderedStates.map((state, i) => [state, i]));
  const n = orderedStates.length;
  const matrix = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, column) => row === column ? 1 : 0));
  const initial = new Array(n).fill(0);
  initial[indexByState.get(start)] = 1;
  for (const [state, step] of states) {
    const from = indexByState.get(state);
    if (step.success > 0 && state + 1 < target) matrix[indexByState.get(state + 1)][from] -= step.success;
    if (step.success < 1) matrix[indexByState.get(step.failureState)][from] -= 1 - step.success;
  }
  const visits = solveLinear(matrix, initial);
  if (visits === null || visits.some(value => value < -1e-7)) {
    return unavailableRefinement(start, target, maxAttempts, 'invalid', [issue('NUMERIC_INSTABILITY', 'steps', 'Obliczenie jest niestabilne dla tych wartości; sprawdź bardzo małe prawdopodobieństwa.')], { requiredLevels });
  }

  const combined = new Map();
  const attemptsByLevel = [];
  const unknownFeeLevels = [];
  const unknownMaterialLevels = [];
  const minimumUnknownFeeLevels = [];
  let expectedAttempts = 0;
  let expectedKnownFeeCost = 0;
  let minimumKnownFeeCost = 0;
  for (const [i, state] of orderedStates.entries()) {
    const step = states.get(state);
    const expected = Math.max(0, visits[i]);
    const minimum = state >= start ? 1 : 0;
    expectedAttempts += expected;
    if (step.materials === null) unknownMaterialLevels.push(step.level);
    else for (const [id, quantity] of step.materials) {
      const row = combined.get(id) || { id, expectedQuantity: 0, minimumQuantity: 0 };
      row.expectedQuantity += quantity * expected;
      row.minimumQuantity += quantity * minimum;
      combined.set(id, row);
    }
    if (step.fee === null) {
      unknownFeeLevels.push(step.level);
      if (minimum) minimumUnknownFeeLevels.push(step.level);
    } else {
      expectedKnownFeeCost += expected * step.fee;
      minimumKnownFeeCost += minimum * step.fee;
    }
    attemptsByLevel.push({ level: step.level, expectedAttempts: expected, minimumAttempts: minimum, success: step.success, failureDrop: step.failureDrop, fee: step.fee, expectedFee: step.fee === null ? null : step.fee * expected });
  }

  const unknownPriceIds = [];
  const minimumUnknownPriceIds = [];
  let expectedKnownCost = expectedKnownFeeCost;
  let minimumKnownCost = minimumKnownFeeCost;
  const materials = [...combined.values()].map(row => {
    const unitPrice = priceFor(prices, row.id, costIssues);
    const expectedCost = row.expectedQuantity === 0 ? 0 : unitPrice === null ? null : row.expectedQuantity * unitPrice;
    const minimumCost = row.minimumQuantity === 0 ? 0 : unitPrice === null ? null : row.minimumQuantity * unitPrice;
    if (expectedCost === null) unknownPriceIds.push(row.id); else expectedKnownCost += expectedCost;
    if (minimumCost === null) minimumUnknownPriceIds.push(row.id); else minimumKnownCost += minimumCost;
    return { ...row, unitPrice, expectedCost, minimumCost };
  });
  for (const id of unknownPriceIds) costIssues.push(issue('MISSING_PRICE', `prices.${id}`, 'Uzupełnij cenę materiału.', { id }));
  for (const level of unknownFeeLevels) costIssues.push(issue('MISSING_FEE', `steps.${level}.fee`, 'Uzupełnij opłatę za próbę.', { level }));
  if (![expectedAttempts, expectedKnownCost, minimumKnownCost].every(Number.isFinite)) costIssues.push(issue('NUMERIC_OVERFLOW', 'steps', 'Wartości są zbyt duże, aby bezpiecznie obliczyć wynik.'));
  const costInvalid = costIssues.some(item => item.code.startsWith('INVALID_') || item.code === 'NUMERIC_OVERFLOW');
  const costComplete = !costIssues.length;
  const minimumComplete = !costInvalid && !minimumUnknownPriceIds.length && !minimumUnknownFeeLevels.length && !unknownMaterialLevels.some(level => level > start);
  return {
    status: costInvalid ? 'invalid' : costComplete ? 'ok' : 'incomplete',
    issues: costIssues,
    computationReady: true,
    costComplete,
    start, target, requiredLevels,
    expectedAttempts,
    minimumAttempts: target - start,
    attemptsByLevel,
    materials,
    expectedKnownCost,
    expectedCost: costComplete ? expectedKnownCost : null,
    expectedFeeCost: unknownFeeLevels.length || costInvalid ? null : expectedKnownFeeCost,
    minimumKnownCost,
    minimumCost: minimumComplete ? minimumKnownCost : null,
    minimumFeeCost: minimumUnknownFeeLevels.length || costInvalid ? null : minimumKnownFeeCost,
    unknownPriceIds,
    unknownFeeLevels,
    unknownMaterialLevels,
    minimumUnknownPriceIds,
    minimumUnknownFeeLevels,
    successWithinAttempts: { attempts: maxAttempts, probability },
  };
}
