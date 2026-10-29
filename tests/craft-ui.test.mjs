import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {calculateCraft, parseNumber} from '../dist/calc.js';

// Execute the shipped UI owner without its network boot. DOM stubs cover only
// the toast/navigation used by adding a plan; calculations use the real module.
function app(fee) {
  const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/\nboot\(\);\s*$/, '');
  const element = {addEventListener(){}, classList:{add(){}, remove(){}}};
  const context = vm.createContext({
    calculateCraft, parseNumber, console,
    localStorage:{getItem(){return null;}, setItem(){}},
    document:{querySelector(){return element;}, querySelectorAll(){return [];}, addEventListener(){}},
    window:{addEventListener(){}}, location:{hash:''}, setTimeout(){return 1;}, clearTimeout(){},
  });
  vm.runInContext(source + `
    globalThis.audit = {
      configure(fee) {
        const recipe = {id:'sample', name:'Sample', category:'Weapon Craft', materials:[{id:'steel',name:'Steel',quantity:2}]};
        recipes = [recipe]; recipeMap = new Map([['sample',recipe]]);
        items = [{id:'steel',name:'Steel'}]; itemMap = new Map(items.map(i=>[i.id,i]));
        selected = 'sample'; state.prices = {steel:100}; state.craftFees = {sample:fee};
        return recipe;
      },
      craftResult, addToCart, shoppingResult, importBackup,
      cart:()=>state.cart,
    };`, context);
  const recipe = context.audit.configure(fee);
  return {...context.audit, recipe};
}

test('cleared craft fee remains unknown after reopening and adding a shopping plan', () => {
  const ui = app(null);
  assert.equal(ui.craftResult(ui.recipe).cashCost, null);
  ui.addToCart();
  assert.equal(ui.cart()[0].fee, null);
  assert.equal(ui.shoppingResult().result.cashCost, null);
});

test('explicit zero fee and a positive fee remain calculable', () => {
  for (const fee of [0, 75]) {
    const ui = app(fee);
    assert.equal(ui.craftResult(ui.recipe).cashCost, 200 + fee);
    ui.addToCart();
    assert.equal(ui.shoppingResult().result.cashCost, 200 + fee);
  }
});

test('an explicit unknown fee argument cannot fall back to a saved price', () => {
  const ui = app(75);
  assert.equal(ui.craftResult(ui.recipe, 1, {}, null).cashCost, null);
});

test('an imported shopping plan retains an unknown fee', async () => {
  const ui = app(75);
  const backup = JSON.stringify({app:'rose-forge',version:1,state:{cart:[{
    key:'imported',recipeId:'sample',runs:1,fee:null,
    materials:[{id:'steel',name:'Steel',quantity:2}],
  }]}});
  await ui.importBackup({size:backup.length,text:async()=>backup});
  assert.equal(ui.cart().length,1);
  assert.equal(ui.cart()[0].fee,null);
  assert.equal(ui.shoppingResult().result.cashCost,null);
});
