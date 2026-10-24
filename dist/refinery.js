import { calculateCraft, calculateRefinement, parseNumber } from './calc.js';

const GUIDE = 'https://forum.roseonlinegame.com/topic/5590-guide-how-to-refine/';
const TIERS = 'https://forum.roseonlinegame.com/topic/3925-refining-guide/';
const DURA_GUIDE = 'https://forum.roseonlinegame.com/topic/6519-guide-how-to-reinforce-to-increase-durability/';
const OCT_PATCH = 'https://forum.roseonlinegame.com/topic/7789-patch-notes-2026-10-16-dolphin-island-rmlui-desert-of-the-dead/';
const BASIC_MATERIALS = [
  ['ancient-scarab', 'Ancient Scarab'], ['jupiterune', 'Jupiterune'], ['saturune', 'Saturune'],
  ['honor-bindrune', 'Honor Bindrune'], ['honor-talisman', 'Honor Talisman'],
  ['pink-powder', 'Pink Powder'], ['purple-powder', 'Purple Powder'],
  ['lisent-hg', 'Lisent Hg'], ['lisent-u', 'Lisent U'],
  ['venurune', 'Venurune'], ['plutorune', 'Plutorune'],
  ['reinforcement-powder', 'Reinforcement Powder'],
  ...['sn', 'cr', 'mn', 'ti'].map(code => [`reinforcement-alloy-${code}`, `Reinforcement Alloy (${code[0].toUpperCase()}${code.slice(1)})`]),
];
/** These are named materials, not invented prices or replacement game icons. */
export const REFINERY_ITEMS = [
  ...['Bindrune', 'Talisman', 'Apotrope'].flatMap(name => Array.from({ length: 9 }, (_, i) => ({
    id: `ref:${name.toLowerCase()}-${i + 1}`, name: `${name} (grade ${i + 1})`, genericGradeName: true,
  }))),
  ...BASIC_MATERIALS.map(([key, name]) => ({ id: `ref:${key}`, name })),
].map(item => ({ ...item, type: 'material', synthetic: true, icon: 'assets/unknown.svg' }));
const REFS = new Map(REFINERY_ITEMS.map(item => [item.id, item]));
const TYPES = [
  ['armor', 'Zbroja · Bindrune'], ['weapon', 'Broń / off-hand · Talisman'],
  ['back', 'Plecy · Apotrope'], ['unique', 'Unique · Ancient Scarab'],
  ['event', 'Event · Jupiterune'], ['honorArmor', 'Honor zbroja · Honor Bindrune'],
  ['honorWeapon', 'Honor broń · Honor Talisman'], ['mall', 'Item Mall · Saturune'],
];
const CATALYSTS = [['none', 'Bez katalizatora'], ['pink-powder', 'Pink Powder'], ['purple-powder', 'Purple Powder'], ['lisent-hg', 'Lisent Hg'], ['lisent-u', 'Lisent U']];
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const safeEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function helpers(ctx) {
  const esc = ctx.esc || safeEsc;
  const num = value => value === null || value === undefined || !Number.isFinite(value) ? '—' : (ctx.num ? ctx.num(value) : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(value));
  const money = value => value === null || value === undefined || !Number.isFinite(value) ? '—' : (ctx.money ? ctx.money(value) : `${num(value)} Zulie`);
  return { esc, num, money };
}

function actualMaterial(items, fallback) {
  const grade = /^ref:(bindrune|talisman|apotrope)-([1-9])$/.exec(fallback.id);
  const suffix = grade ? ({ 1: 'st', 2: 'nd', 3: 'rd' }[grade[2]] || 'th') : '';
  const names = [norm(fallback.name)];
  if (grade) names.push(norm(`${grade[2]}${suffix} Grade ${grade[1]}`));
  return (items || []).find(item => !item.synthetic && names.includes(norm(item.name)));
}

function material(ctx, key) {
  const id = key.startsWith('ref:') ? key : `ref:${key}`;
  const fallback = REFS.get(id) || { id, name: key, icon: 'assets/unknown.svg', synthetic: true };
  const actual = actualMaterial(ctx.items, fallback);
  if (actual) return actual;
  const registered = ctx.itemMap?.get(id);
  return registered || fallback;
}

function picture(item, esc) {
  const url = item?.icon || 'assets/unknown.svg';
  return `<span class="item-icon small-icon"><img src="${esc(url)}" alt="" loading="lazy" width="30" height="30"></span>`;
}

function optionList(entries, selected, esc) {
  return entries.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function numericInput(value, attr, label, extra = '') {
  return `<input class="input mini" type="text" inputmode="decimal" autocomplete="off" ${attr} value="${safeEsc(value ?? '')}" aria-label="${safeEsc(label)}" placeholder="brak danych" ${extra}>`;
}

function field(label, inner, hint = '') {
  return `<label class="field"><span>${label}</span>${inner}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
}

const PRICE_LIMIT = 1e15;
function priceError(raw) {
  if (String(raw ?? '').trim() === '') return '';
  const value = parseNumber(raw);
  return value === null || value < 0 || value > PRICE_LIMIT ? 'Wpisz cenę od 0 do 1 000 000 000 000 000 Zulie.' : '';
}

function pricesFor(state, ctx) {
  const prices = { ...ctx.state.prices };
  for (const [id, draft] of Object.entries(state.priceDrafts || {})) if (priceError(draft)) prices[id] = null;
  return prices;
}

function acceptPriceInput(input, state, ctx) {
  const id = input.dataset.refPrice;
  const error = priceError(input.value);
  state.priceDrafts ||= {};
  if (error) state.priceDrafts[id] = input.value;
  else {
    delete state.priceDrafts[id];
    ctx.state.prices[id] = parseNumber(input.value);
  }
  input.setCustomValidity(error);
  input.setAttribute('aria-invalid', String(Boolean(error)));
  const message = input.parentElement.querySelector('[data-ref-price-error]');
  if (message) message.textContent = error;
}

function pricesPanel(items, ctx, title = 'Ceny materiałów', priceDrafts = {}) {
  const { esc } = helpers(ctx);
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  return `<section class="panel"><h2>${title}</h2><p class="muted small">Wpisz własne ceny za sztukę w Zulie. Puste pole oznacza brak ceny; wpisane 0 oznacza cenę zerową.</p>
    <div class="table-wrap"><table><thead><tr><th>Materiał</th><th>Cena / szt.</th></tr></thead><tbody>${unique.map(item => {
      const value = Object.prototype.hasOwnProperty.call(priceDrafts, item.id) ? priceDrafts[item.id] : ctx.state.prices?.[item.id];
      const error = priceError(value);
      return `<tr><td><div class="item-cell">${picture(item, esc)}<div><strong>${esc(item.name)}</strong>${item.genericGradeName ? '<div class="tiny muted">Nazwa według typu i grade</div>' : ''}</div></div></td><td>${numericInput(value, `data-ref-price="${esc(item.id)}"`, `Cena ${item.name}`, `aria-invalid="${Boolean(error)}"`)}<span class="tiny" style="display:block;color:var(--danger);max-width:210px;margin-top:6px" data-ref-price-error role="status">${esc(error)}</span></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="linkline">Ceny zapisują się także w Twoim cenniku. Wycena obejmuje zużyte materiały, również posiadane.</p></section>`;
}

function registerMaterials(ctx) {
  ctx.state.prices ||= {};
  for (const entry of REFINERY_ITEMS) {
    const actual = actualMaterial(ctx.items, entry);
    if (actual) {
      ctx.itemMap?.delete(entry.id);
      const duplicate = ctx.items?.findIndex(item => item.id === entry.id);
      if (duplicate >= 0) ctx.items.splice(duplicate, 1);
      if (Object.prototype.hasOwnProperty.call(ctx.state.prices, entry.id)) {
        if (ctx.state.prices[actual.id] == null && ctx.state.prices[entry.id] != null && !priceError(ctx.state.prices[entry.id])) ctx.state.prices[actual.id] = parseNumber(ctx.state.prices[entry.id]);
        delete ctx.state.prices[entry.id];
      }
      continue;
    }
    if (ctx.itemMap && !ctx.itemMap.has(entry.id)) ctx.itemMap.set(entry.id, entry);
    if (ctx.items && !ctx.items.some(item => item.id === entry.id)) ctx.items.push(entry);
  }
}

function primaryMaterial(state, ctx) {
  const key = ({ armor: `bindrune-${state.grade}`, weapon: `talisman-${state.grade}`, back: `apotrope-${state.grade}`, unique: 'ancient-scarab', event: 'jupiterune', honorArmor: 'honor-bindrune', honorWeapon: 'honor-talisman', mall: 'saturune' })[state.type];
  return material(ctx, key || `bindrune-${state.grade}`);
}

function rowFor(state, level) {
  state.rows ||= {};
  state.rows[level] ||= { p: '', fee: level === 1 ? '0' : '', quantity: '', drop: '', catalystQty: '' };
  return state.rows[level];
}

function selectedRefineMaterials(state, ctx) {
  const selected = [primaryMaterial(state, ctx)];
  if (state.type !== 'mall') {
    if (state.catalyst !== 'none') selected.push(material(ctx, state.catalyst));
    if (Number(state.venurune) > 0) selected.push(material(ctx, 'venurune'));
    if (Number(state.plutorune) > 0) selected.push(material(ctx, 'plutorune'));
  }
  return selected;
}

function refillMall(state) {
  for (let level = 1; level <= 20; level++) Object.assign(rowFor(state, level), { p: '100', fee: '0', drop: '0' });
}

function stepTable(levels, state, ctx) {
  const { esc } = helpers(ctx);
  const cat = state.type !== 'mall' && state.catalyst !== 'none';
  return `<div class="table-wrap refine-steps"><table><thead><tr><th>Próba</th><th>Szansa %</th><th>Opłata Zulie</th><th>Materiał · szt.</th>${cat ? '<th>Katalizator · szt.</th>' : ''}<th>Spadek po porażce</th></tr></thead><tbody>${levels.map(level => {
    const row = rowFor(state, level);
    const input = (key, label) => numericInput(row[key], `data-step="${level}" data-key="${key}"`, `${label}, próba +${level - 1} do +${level}`);
    return `<tr${level <= Number(state.start) ? ' class="below-start"' : ''}><td class="step-label">+${level - 1} → +${level}</td><td data-label="Szansa %">${input('p', 'Końcowa szansa w procentach')}</td><td data-label="Opłata Zulie">${input('fee', 'Opłata NPC w Zulie')}</td><td data-label="Materiał · szt.">${input('quantity', 'Liczba sztuk głównego materiału')}</td>${cat ? `<td data-label="Katalizator · szt.">${input('catalystQty', 'Liczba sztuk katalizatora')}</td>` : ''}<td data-label="Spadek po porażce"><select class="input mini" data-step="${level}" data-key="drop" aria-label="Spadek po porażce przy próbie +${level - 1} do +${level}">${optionList([['', 'Wybierz'], [0, '0 poziomów'], [1, '1 poziom'], [2, '2 poziomy']], row.drop, esc)}</select></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function refineResult(state, ctx) {
  const start = Number(state.start);
  const target = state.mode === 'single' ? start + 1 : Number(state.target);
  const primary = primaryMaterial(state, ctx);
  const malformed = [];
  const steps = Array.from({ length: target }, (_, i) => {
    const level = i + 1;
    const row = rowFor(state, level);
    const quantity = parseNumber(row.quantity);
    let mats = quantity === null ? null : [{ id: primary.id, quantity }];
    if (quantity !== null && (!Number.isInteger(quantity) || quantity <= 0)) malformed.push({ level, message: `+${level - 1} → +${level}: liczba materiałów musi być dodatnią liczbą całkowitą.` });
    if (state.type !== 'mall') {
      if (state.catalyst !== 'none') {
        const catQty = parseNumber(row.catalystQty);
        if (catQty === null) mats = null;
        else if (!Number.isInteger(catQty) || catQty <= 0) malformed.push({ level, message: `+${level - 1} → +${level}: wpisz dodatnią liczbę sztuk katalizatora.` });
        if (mats) mats.push({ id: material(ctx, state.catalyst).id, quantity: catQty });
      }
      if (mats && Number(state.venurune)) mats.push({ id: material(ctx, 'venurune').id, quantity: Number(state.venurune) });
      if (mats && Number(state.plutorune)) mats.push({ id: material(ctx, 'plutorune').id, quantity: 1 });
    }
    const p = parseNumber(row.p);
    return { level, success: p === null ? null : p / 100, fee: parseNumber(row.fee), failureDrop: parseNumber(row.drop), materials: mats };
  });
  const result = calculateRefinement({ start, target, steps, prices: pricesFor(state, ctx), maxAttempts: parseNumber(state.attempts) });
  for (const item of selectedRefineMaterials(state, ctx)) if (priceError(state.priceDrafts?.[item.id])) {
    result.issues.push({ code: 'INVALID_PRICE_INPUT', id: item.id, message: priceError(state.priceDrafts[item.id]) });
    result.expectedCost = null;
    result.minimumCost = null;
    result.costComplete = false;
    result.status = 'invalid';
  }
  const activeMalformed = malformed.filter(problem => result.requiredLevels.includes(problem.level));
  if (activeMalformed.length) {
    result.expectedCost = null;
    result.minimumCost = null;
    result.costComplete = false;
    result.status = 'invalid';
    result.issues.push(...activeMalformed.map(problem => ({ code: 'INVALID_QUANTITY', field: 'materials', ...problem })));
  }
  return result;
}

function describeIssue(issue, ctx) {
  if (issue.id) return `${materialName(ctx, issue.id)}: uzupełnij lub popraw cenę.`;
  const prefix = issue.level ? `+${issue.level - 1} → +${issue.level}: ` : '';
  return `${prefix}${issue.message}`;
}

function materialName(ctx, id) {
  return ctx.itemMap?.get(id)?.name || REFS.get(id)?.name || id;
}

function drawRefineResults(wrapper, state, ctx) {
  const { esc, num, money } = helpers(ctx);
  const result = refineResult(state, ctx);
  const out = wrapper.querySelector('[data-refine-results]');
  const issues = [...new Set(result.issues.map(item => describeIssue(item, ctx)))];
  const limit = result.successWithinAttempts?.attempts;
  const probability = result.successWithinAttempts?.probability;
  const currentPath = `+${result.start} → +${result.target}`;
  out.innerHTML = `<h2>Plan ${currentPath}</h2>
    <p class="muted small">Średnia uwzględnia nieudane próby i odrabianie spadków.</p>
    <div class="result-hero"><div class="label">Średni koszt dojścia do celu</div><div class="value">${money(result.expectedCost)}</div><div class="sub">${result.expectedCost === null ? 'Uzupełnij dane, aby otrzymać pełną wycenę.' : 'Wartość oczekiwana, nie gwarantowany budżet.'}</div></div>
    <div class="result-row"><span>Przy samych sukcesach</span><strong>${money(result.minimumCost)}</strong></div>
    <div class="result-row"><span>Średnia liczba prób</span><strong>${num(result.expectedAttempts)}</strong></div>
    <div class="result-row"><span>Szansa osiągnięcia celu<br>w ${num(limit)} próbach</span><strong>${probability === null || probability === undefined ? '—' : `≈ ${num(probability * 100)}%`}</strong></div>
    ${probability !== null && probability !== undefined ? `<div class="progress-bar" aria-label="Szansa w limicie prób: ${esc(num(probability * 100))}%"><i style="width:${Math.max(0, Math.min(100, probability * 100))}%"></i></div>` : ''}
    ${issues.length ? `<div class="panel-note${result.status === 'invalid' || result.status === 'impossible' ? ' danger-note' : ''}"><strong>${result.status === 'impossible' ? 'Cel nieosiągalny dla części lub wszystkich prób' : 'Do uzupełnienia / poprawy'}</strong><ul class="missing-list">${issues.slice(0, 7).map(message => `<li>${esc(message)}</li>`).join('')}</ul>${issues.length > 7 ? `<span class="tiny">Pozostałe pola do sprawdzenia: ${issues.length - 7}.</span>` : ''}</div>` : ''}
    ${result.materials.length ? `<h3>Przewidywane zużycie</h3><div class="ingredients-list">${result.materials.map(row => `<div class="ingredient-line"><div>${picture(ctx.itemMap?.get(row.id) || REFS.get(row.id), esc)}<span>${esc(materialName(ctx, row.id))}</span></div><strong>${num(row.expectedQuantity)} szt.</strong></div>`).join('')}</div><p class="tiny muted">Ilości są średnimi; w jednej próbie zużywasz całe sztuki. Nieznane materiały nie wchodzą do tej częściowej listy.</p>` : ''}
    <p class="panel-note info">Wynik zakłada stałe, niezależne szanse. Dłuższa seria porażek nadal jest możliwa. Koszt przy samych sukcesach pokazuje najkrótszą ścieżkę.</p>
    ${result.attemptsByLevel.length ? `<details class="details-box"><summary>Próby na poszczególnych poziomach</summary><div class="table-wrap"><table><thead><tr><th>Cel</th><th>Średnio prób</th></tr></thead><tbody>${result.attemptsByLevel.map(row => `<tr><td>+${row.level}</td><td>${num(row.expectedAttempts)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
  const lower = wrapper.querySelector('[data-lower-steps]');
  const needsRecovery = result.issues.some(issue => issue.level && issue.level <= Number(state.start));
  if (lower && needsRecovery) lower.open = true;
}

export function mountRefinery(container, ctx) {
  registerMaterials(ctx);
  const { esc } = helpers(ctx);
  const state = ctx.state.refine ||= {};
  Object.entries({ mode: 'single', start: '0', target: '1', type: 'armor', grade: '1', catalyst: 'none', venurune: '0', plutorune: '0', attempts: '100' }).forEach(([key, value]) => { if (state[key] === undefined) state[key] = value; });
  if (!['single', 'plan'].includes(state.mode)) state.mode = 'single';
  state.start = String(Math.min(19, Math.max(0, Math.trunc(parseNumber(state.start) ?? 0))));
  state.target = String(Math.min(20, Math.max(Number(state.start) + 1, Math.trunc(parseNumber(state.target) ?? 1))));
  const start = Number(state.start);
  const target = state.mode === 'single' ? start + 1 : Number(state.target);
  const mainLevels = Array.from({ length: target - start }, (_, i) => start + i + 1);
  const lowerLevels = Array.from({ length: start }, (_, i) => i + 1);
  const numericGrade = ['armor', 'weapon', 'back'].includes(state.type);
  const primary = primaryMaterial(state, ctx);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<header class="page-head"><div class="eyebrow">WARSZTAT · REFINING</div><h1>Od +0 do +20</h1><p>Sprawdź koszt materiałów, ryzyko powtórek i szansę dojścia do celu. Przepisz wartości z okna rafinacji swojej rzeczy w grze.</p></header>
    <div class="cols-two"><div><section class="panel"><div class="radio-tabs"><button class="risk-card ${state.mode === 'single' ? 'active' : ''}" data-mode="single" type="button" aria-pressed="${state.mode === 'single'}"><strong>Jeden poziom</strong>Koszt dojścia na następny +</button><button class="risk-card ${state.mode === 'plan' ? 'active' : ''}" data-mode="plan" type="button" aria-pressed="${state.mode === 'plan'}"><strong>Cały plan</strong>Wiele etapów i odrabianie strat</button></div>
    <div class="field-grid">${field('Typ przedmiotu', `<select class="input" data-setting="type">${optionList(TYPES, state.type, esc)}</select>`)}
    ${numericGrade ? field('Item Grade', `<select class="input" data-setting="grade">${optionList(Array.from({ length: 9 }, (_, i) => [i + 1, `Grade ${i + 1}`]), state.grade, esc)}</select>`, 'Grade z opisu przedmiotu, nie poziom rafinacji. Dla Valor sprawdź materiał w oknie gry.') : ''}
    ${field('Obecna rafinacja', `<select class="input" data-setting="start">${optionList(Array.from({ length: 20 }, (_, i) => [i, `+${i}`]), state.start, esc)}</select>`)}
    ${state.mode === 'plan' ? field('Cel', `<select class="input" data-setting="target">${optionList(Array.from({ length: 20 - start }, (_, i) => [start + i + 1, `+${start + i + 1}`]), state.target, esc)}</select>`) : ''}
    ${field('Limit prób dla szansy', `<input class="input" data-setting="attempts" type="text" inputmode="numeric" value="${esc(state.attempts)}" autocomplete="off">`, 'Ile prób chcesz przeznaczyć na cały plan?')}
    </div><div class="panel-note info"><strong>Materiał główny: ${esc(primary.name)}</strong><br>${state.type === 'mall' ? 'Item Mall: poradnik potwierdza 100% sukcesu i brak opłaty NPC. Wpisz liczbę Saturune. Cena poniżej to wyłącznie Twoja wycena w Zulie, nie cena zakupu za Rose Points; nie przeliczamy walut automatycznie.' : 'Sprawdź nazwę i ilość w grze. Dla zwykłych przedmiotów materiał musi odpowiadać Item Grade.'}</div>
    ${state.type !== 'mall' ? `<details class="details-box"${state.catalyst !== 'none' || Number(state.venurune) || Number(state.plutorune) ? ' open' : ''}><summary>Dodatki do każdej próby</summary><p>Te same dodatki zostaną policzone na wszystkich etapach i przy odrabianiu spadków.</p><div class="field-grid">${field('Katalizator', `<select class="input" data-setting="catalyst">${optionList(CATALYSTS, state.catalyst, esc)}</select>`)}${field('Venurune / próbę', `<select class="input" data-setting="venurune">${optionList([[0, '0 szt.'], [1, '1 szt.'], [2, '2 szt.']], state.venurune, esc)}</select>`)}${field('Plutorune / próbę', `<select class="input" data-setting="plutorune">${optionList([[0, 'Bez ochrony'], [1, '1 szt.']], state.plutorune, esc)}</select>`)}</div><p>Venurune zwiększa szansę, Plutorune zmniejsza utratę o jeden poziom. Wpisuj już końcową szansę i faktyczny spadek widoczne w grze — nie doliczamy bonusów drugi raz.</p></details>` : '<div class="button-row"><button class="btn small" type="button" data-action="mall">Ustaw potwierdzone 100% / 0 opłaty</button></div>'}
    </section><section class="panel"><h2>Parametry prób</h2><p class="muted small">Szansa końcowa w %, opłata NPC, ilość materiału i faktyczny spadek po zastosowaniu ochrony. Puste pola wymagają uzupełnienia.</p>
    ${stepTable(mainLevels, state, ctx)}
    ${lowerLevels.length ? `<details class="details-box" data-lower-steps><summary>Poziomy +0…+${start}: odrabianie możliwych spadków</summary><p>Kalkulator potrzebuje tylko poziomów, do których rzeczywiście można spaść. Poziom startowy nie daje automatycznej ochrony.</p>${stepTable(lowerLevels, state, ctx)}</details>` : ''}
    ${state.type !== 'mall' ? `<details class="details-box"><summary>Pomoc z progami spadku</summary><p>Starszy wątek graczy podaje: cel +1…+10 — spadek 0; +11…+15 — spadek 1; +16…+20 — spadek 2. To dane społeczności z 2023 r.; porównaj je z oknem gry. Przycisk uwzględni wybrany Plutorune.</p><button class="btn small" data-action="tiers" type="button">Wstaw progi z forum (2023)</button><p><a href="${TIERS}" target="_blank" rel="noopener noreferrer">Źródło progów i wyjaśnienie +10 → +11</a></p></details>` : ''}
    <p class="tiny muted">Pierwsza rafinacja ma opłatę NPC 0 według poradnika. Materiały nadal mogą kosztować Zulie.</p></section>
    ${pricesPanel(selectedRefineMaterials(state, ctx), ctx, undefined, state.priceDrafts)}
    <section class="panel"><h3>Skąd są zasady?</h3><p class="muted small">Rafinacja zwiększa bazowe parametry i może obniżyć poziom po porażce. Przedmiot nie jest niszczony przez sam refine. Ulepszenie przez Artisana (np. Hardened) wykonaj przed rafinacją, ponieważ przerobienie usuwa refine.</p><div class="source-links"><a href="${GUIDE}" target="_blank" rel="noopener noreferrer">Poradnik rafinacji · HoneyBuns, GM</a><a href="${OCT_PATCH}" target="_blank" rel="noopener noreferrer">Aktualizacja 16.10.2026 · zmiany sklepów materiałów</a></div><p class="linkline">Nie korzystamy z dawnych cen run w punktach Honor/Valor. Ceny w kalkulatorze pochodzą z Twojego cennika.</p></section></div>
    <aside class="panel calc-results" data-refine-results aria-live="polite"></aside></div>`;
  container.replaceChildren(wrapper);
  drawRefineResults(wrapper, state, ctx);

  const saveAndDraw = () => { ctx.save(); drawRefineResults(wrapper, state, ctx); };
  wrapper.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.refPrice) { acceptPriceInput(input, state, ctx); saveAndDraw(); }
    else if (input.dataset.step) { rowFor(state, Number(input.dataset.step))[input.dataset.key] = input.value; saveAndDraw(); }
    else if (input.dataset.setting === 'attempts') { state.attempts = input.value; saveAndDraw(); }
  });
  wrapper.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement)) return;
    if (input.dataset.step) { rowFor(state, Number(input.dataset.step))[input.dataset.key] = input.value; saveAndDraw(); return; }
    const key = input.dataset.setting;
    if (!key) return;
    state[key] = input.value;
    if (key === 'type' || key === 'grade') {
      state.rows = {};
      if (state.type === 'mall') refillMall(state);
    } else if (['catalyst', 'venurune', 'plutorune'].includes(key)) {
      for (const row of Object.values(state.rows || {})) { row.p = ''; row.drop = ''; }
      ctx.toast?.('Dodatki zmienione. Przepisz końcowe szanse i spadki z gry.');
    }
    ctx.save(); mountRefinery(container, ctx);
  });
  wrapper.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.mode) { state.mode = button.dataset.mode; ctx.save(); mountRefinery(container, ctx); }
    else if (button.dataset.action === 'mall') { refillMall(state); ctx.save(); mountRefinery(container, ctx); }
    else if (button.dataset.action === 'tiers') {
      for (let level = 1; level <= 20; level++) rowFor(state, level).drop = String(Math.max(0, (level <= 10 ? 0 : level <= 15 ? 1 : 2) - Number(state.plutorune)));
      ctx.toast?.('Wstawiono progi z forum z 2023 r. Porównaj je z grą.');
      ctx.save(); mountRefinery(container, ctx);
    }
  });
}

function alloyCode(state) {
  if (['sn', 'cr', 'mn', 'ti'].includes(state.alloy)) return state.alloy;
  const current = parseNumber(state.current);
  if (current === null) return null;
  return current < 40 ? 'sn' : current < 60 ? 'cr' : current < 80 ? 'mn' : 'ti';
}

function durabilityResult(state, ctx) {
  const current = parseNumber(state.current);
  const p = parseNumber(state.p);
  const powderQty = parseNumber(state.powderQty);
  const alloyQty = parseNumber(state.alloyQty);
  const fee = parseNumber(state.fee);
  const attempts = parseNumber(state.attempts);
  const code = alloyCode(state);
  const problems = [];
  if (current === null || !Number.isInteger(current) || current < 1 || current > 99) problems.push(current === 100 ? 'Przedmiot ma już maksymalne DURA 100.' : 'Wpisz obecną trwałość od 1 do 99. DURA 0 nie kwalifikuje się do wzmacniania według poradnika.');
  if (p === null || p < 0 || p > 100) problems.push('Wpisz końcową szansę 0–100% z wybranego trybu w grze.');
  if (powderQty === null || !Number.isInteger(powderQty) || powderQty <= 0) problems.push('Uzupełnij dodatnią liczbę Reinforcement Powder na próbę.');
  if (alloyQty === null || !Number.isInteger(alloyQty) || alloyQty <= 0) problems.push('Uzupełnij dodatnią liczbę sztuk stopu na próbę.');
  if (fee === null || fee < 0) problems.push('Uzupełnij nieujemną opłatę NPC za próbę.');
  if (!code) problems.push('Wybierz stop lub wpisz obecną trwałość.');
  if (state.risk === 'safe' && (attempts === null || !Number.isInteger(attempts) || attempts < 1 || attempts > 100000)) problems.push('Limit prób musi być liczbą całkowitą od 1 do 100 000.');
  const cost = calculateCraft({ materials: code && powderQty !== null && alloyQty !== null ? [{ id: material(ctx, 'reinforcement-powder').id, quantity: powderQty }, { id: material(ctx, `reinforcement-alloy-${code}`).id, quantity: alloyQty }] : null, quantity: 1, fee, prices: pricesFor(state, ctx) });
  for (const problem of cost.issues || []) if (problem.code === 'MISSING_PRICE' || problem.code === 'INVALID_PRICE') problems.push(`${materialName(ctx, problem.id)}: uzupełnij lub popraw cenę.`);
  const validNumbers = current !== null && Number.isInteger(current) && current >= 1 && current <= 99 && powderQty !== null && Number.isInteger(powderQty) && powderQty > 0 && alloyQty !== null && Number.isInteger(alloyQty) && alloyQty > 0;
  const singleCost = validNumbers ? cost.marketCost : null;
  const validP = p !== null && p >= 0 && p <= 100;
  const safe = state.risk === 'safe' && validP && Number.isInteger(current) && current >= 1 && current <= 99;
  return { problems: [...new Set(problems)], singleCost, expectedAttempts: safe && p > 0 ? 100 / p : null, expectedCost: safe && p > 0 && singleCost !== null ? singleCost * 100 / p : null, probability: safe && Number.isInteger(attempts) && attempts >= 1 && attempts <= 100000 ? (p === 100 ? 1 : -Math.expm1(attempts * Math.log1p(-p / 100))) : null, p, attempts };
}

function drawDurabilityResults(wrapper, state, ctx) {
  const { esc, money, num } = helpers(ctx);
  const result = durabilityResult(state, ctx);
  const safe = state.risk === 'safe';
  const out = wrapper.querySelector('[data-dura-results]');
  out.innerHTML = `<h2>Koszt wzmocnienia</h2><div class="result-hero"><div class="label">Jedna próba u Saki</div><div class="value">${money(result.singleCost)}</div><div class="sub">Materiały i opłata NPC za jeden klik</div></div>
    ${safe ? `<div class="result-row"><span>Średnio do pierwszego sukcesu</span><strong>${money(result.expectedCost)}</strong></div><div class="result-row"><span>Średnia liczba prób</span><strong>${num(result.expectedAttempts)}</strong></div><div class="result-row"><span>Pierwszy sukces w ${num(result.attempts)} próbach</span><strong>${result.probability === null ? '—' : `≈ ${num(result.probability * 100)}%`}</strong></div><p class="panel-note info">To powtarzanie próby przy tej samej trwałości w trybie No Risk. Wynik dotyczy pierwszego sukcesu, nie drogi do DURA 100. Po sukcesie ponownie odczytaj dane w grze.</p>${result.p === 0 ? '<p class="panel-note danger-note">Przy szansie 0% sukces nie nastąpi. Średni koszt dojścia do sukcesu nie jest skończony.</p>' : ''}` : `<p class="panel-note danger-note">${state.risk === 'high' ? 'High Risk: niepowodzenie może zniszczyć przedmiot. Koszt utraconego sprzętu nie jest uwzględniony.' : 'Medium Risk: niepowodzenie obniża trwałość. Kolejna próba może mieć inne materiały, koszt i szansę.'} Liczymy koszt jednej próby.</p>`}
    ${result.problems.length ? `<div class="panel-note"><strong>Do sprawdzenia</strong><ul class="missing-list">${result.problems.map(message => `<li>${esc(message)}</li>`).join('')}</ul></div>` : ''}`;
}

export function mountDurability(container, ctx) {
  registerMaterials(ctx);
  const { esc } = helpers(ctx);
  const state = ctx.state.dura ||= {};
  Object.entries({ current: '', risk: 'safe', alloy: 'auto', p: '', fee: '', powderQty: '', alloyQty: '', attempts: '10' }).forEach(([key, value]) => { if (state[key] === undefined) state[key] = value; });
  const code = alloyCode(state);
  const powder = material(ctx, 'reinforcement-powder');
  const alloy = code ? material(ctx, `reinforcement-alloy-${code}`) : null;
  const wrapper = document.createElement('div');
  const input = (key, label) => `<input class="input" data-dura="${key}" type="text" inputmode="decimal" value="${esc(state[key])}" placeholder="Z okna gry" autocomplete="off" aria-label="${esc(label)}">`;
  wrapper.innerHTML = `<header class="page-head"><div class="eyebrow">WARSZTAT · DURABILITY</div><h1>Wzmocnienie DURA</h1><p>Kalkulator próby u [Armor Merchant] Saki w Junon Polis. Trwałość można zwiększyć do 100. To osobny system od rafinacji +20.</p></header><div class="cols-two"><div>
    <section class="panel"><h2>Próba u Saki</h2><div class="radio-tabs">${[['safe', 'No Risk', 'Bez spadku po porażce'], ['medium', 'Medium Risk', 'Porażka obniża trwałość'], ['high', 'High Risk', 'Możliwe zniszczenie itema']].map(([value, label, hint]) => `<button class="risk-card ${state.risk === value ? 'active' : ''}" data-risk="${value}" aria-pressed="${state.risk === value}" type="button"><strong>${label}</strong>${hint}</button>`).join('')}</div>
    <div class="field-grid">${field('Obecne DURA (1–99)', input('current', 'Obecna trwałość przedmiotu'))}${field('Stop z okna gry', `<select class="input" data-dura="alloy">${optionList([['auto', 'Według DURA (potwierdź w grze)'], ['sn', 'Reinforcement Alloy (Sn)'], ['cr', 'Reinforcement Alloy (Cr)'], ['mn', 'Reinforcement Alloy (Mn)'], ['ti', 'Reinforcement Alloy (Ti)']], state.alloy, esc)}</select>`)}${field('Końcowa szansa %', input('p', 'Końcowa szansa powodzenia'), 'Dla wybranego trybu, po uwzględnieniu jego bonusu.')}${field('Reinforcement Powder · szt.', input('powderQty', 'Ilość proszku na próbę'))}${field('Reinforcement Alloy · szt.', input('alloyQty', 'Ilość stopu na próbę'))}${field('Opłata NPC · Zulie', input('fee', 'Opłata Saki za próbę'))}${state.risk === 'safe' ? field('Limit prób dla szansy', input('attempts', 'Limit prób do pierwszego sukcesu')) : ''}</div>
    <p class="panel-note${state.risk === 'high' ? ' danger-note' : ' info'}">${state.risk === 'safe' ? 'No Risk nie obniża trwałości przy niepowodzeniu. Materiały i opłata przepadają po każdej próbie.' : state.risk === 'medium' ? 'Medium Risk w poradniku daje bonus +15%, ale zmniejsza DURA przy porażce. Wpisz końcowy procent z gry — kalkulator nie dodaje bonusu ponownie.' : 'High Risk w poradniku daje bonus +30%, ale może zniszczyć przedmiot. Wpisz końcową szansę z gry. Nie wyliczamy nieznanego prawdopodobieństwa zniszczenia.'}</p>
    </section><div data-dura-prices>${pricesPanel(alloy ? [powder, alloy] : [powder], ctx, undefined, state.priceDrafts)}</div>
    <section class="panel"><h2>Który stop?</h2><div class="table-wrap"><table><thead><tr><th>Materiał</th><th>Zakres z poradnika</th></tr></thead><tbody><tr><td>Reinforcement Powder</td><td>Każdy poziom DURA</td></tr><tr><td>Reinforcement Alloy (Sn)</td><td>Do DURA 40</td></tr><tr><td>Reinforcement Alloy (Cr)</td><td>Do DURA 60</td></tr><tr><td>Reinforcement Alloy (Mn)</td><td>Do DURA 80</td></tr><tr><td>Reinforcement Alloy (Ti)</td><td>Do DURA 100</td></tr></tbody></table></div><p class="panel-note">Przy granicy zakresu potwierdź stop w oknie Saki lub wybierz go ręcznie. Ilości, opłatę i szansę przepisz z gry — zmieniają się wraz z trwałością.</p><p class="muted small">Materiały pochodzą z Game Arena dungeons. Wzmocnienie DURA nie jest umiejętnością Armor Reinforcement Artisana.</p><div class="source-links"><a href="${DURA_GUIDE}" target="_blank" rel="noopener noreferrer">Poradnik DURA · HoneyBuns, GM (2025)</a></div></section>
    </div><aside class="panel calc-results" data-dura-results aria-live="polite"></aside></div>`;
  container.replaceChildren(wrapper);
  drawDurabilityResults(wrapper, state, ctx);
  let shownCode = code;
  wrapper.addEventListener('input', event => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement)) return;
    if (element.dataset.refPrice) acceptPriceInput(element, state, ctx);
    else if (element.dataset.dura) state[element.dataset.dura] = element.value;
    else return;
    if (element.dataset.dura === 'current' && alloyCode(state) !== shownCode) {
      shownCode = alloyCode(state);
      wrapper.querySelector('[data-dura-prices]').innerHTML = pricesPanel(shownCode ? [powder, material(ctx, `reinforcement-alloy-${shownCode}`)] : [powder], ctx, undefined, state.priceDrafts);
    }
    ctx.save(); drawDurabilityResults(wrapper, state, ctx);
  });
  wrapper.addEventListener('change', event => {
    const element = event.target;
    if (!(element instanceof HTMLSelectElement) || element.dataset.dura !== 'alloy') return;
    state.alloy = element.value;
    ctx.save(); mountDurability(container, ctx);
  });
  wrapper.addEventListener('click', event => {
    const button = event.target.closest('[data-risk]');
    if (!button || button.dataset.risk === state.risk) return;
    state.risk = button.dataset.risk;
    state.p = '';
    ctx.toast?.('Wpisz końcową szansę dla nowego trybu ryzyka.');
    ctx.save(); mountDurability(container, ctx);
  });
}
