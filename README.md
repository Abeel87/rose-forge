# ROSE Forge

**Publiczna aplikacja:** https://abeel87.github.io/rose-forge/

**Repozytorium:** https://github.com/Abeel87/rose-forge

Polish crafting workshop for ROSE Online Global (Rednim Games). A standalone buildless web app with local browser persistence; no connection to game accounts or automatic market-price feed.

## Features

- 2,791 crafting recipes, category and ingredient search, favorites, actual game item icons.
- Material quantities for an explicit number of crafting attempts, own prices in Zulie, inventory, optional Artisan service fee.
- Generic Chemical / Metal / Rare Metal / Wooden material categories require choosing a concrete material before a complete valuation.
- Craft material editor with add/remove, and explicit confirmation for PAT recipes affected by October 16, 2026 changes.
- Aggregated shopping list: shared materials summed first; inventory deducted once. CSV export.
- Refinement cost expectation using an absorbing Markov chain with real recovery below the starting level; finite-attempt target probability via dynamic programming. No invented success tables.
- Separate Saki durability calculator, limited to a single attempt or repeated No Risk attempts until the first success.
- Local prices, inventory, favorites, cart, edits, calculator state; JSON backup and import.

## Publikacja na GitHub Pages

Działająca aplikacja: https://abeel87.github.io/rose-forge/

Workflow `.github/workflows/pages.yml` sprawdza JavaScript i testy kalkulatorów, a następnie publikuje katalog `dist/` na GitHub Pages. Publikacja uruchamia się po zmianach aplikacji na gałęzi `main`; można ją też uruchomić ręcznie w zakładce Actions.

## Run / verify

Static output is already in `dist/`. No build dependencies are required.

Start a local web server:

```sh
python3 -m http.server 8000 --directory dist
```

Then open http://localhost:8000/. Serve over HTTP so the browser can load the JSON recipe database and JavaScript modules. To host elsewhere, publish the contents of `dist/`.

Run the checks:

```sh
node --check dist/app.js
node --check dist/refinery.js
node tests/calc.test.mjs
```

The mathematical tests cover deterministic success, repeated failures without downgrade, loss and recovery below start, impossible paths, incomplete probability/material data, missing prices versus zero prices, inventory deductions, decimal comma parsing and invalid input. Browser checks also covered live price changes, choosing a Chemical, cart aggregation, persistence, refinery inputs, and responsive views at a 390 px content width.

## Data provenance and scope

Recipe data: [ROSE Online Toolbox](https://roseonlinetoolbox.com/data/equipmentWithMaterials.json), originally attributed to [Lucky's Crafting House](https://luckyscraftinghouse.netlify.app/). The provider declares a January 4, 2026 snapshot; this is not proof that every record matches the current client. All 200 gem ingredient lists were compared with the current Lucky's public API on October 24, 2026 and match. One incomplete recipe, Charming Sunglasses, was excluded instead of guessing a quantity.

Names and images for additional chemicals and refinement reagents: Toolbox's [monster drop dataset](https://roseonlinetoolbox.com/data/monsterDrops.json), attributed to ROSE Utils. Lucky's and ROSE Utils IDs are separate namespaces; added item IDs retain this distinction. Missing icons use a neutral question mark rather than a fabricated item appearance.

Game-mechanic sources:

- [GM refinement guide](https://forum.roseonlinegame.com/topic/5590-guide-how-to-refine/)
- [Community downgrade tiers, 2023](https://forum.roseonlinegame.com/topic/3925-refining-guide/): optional, explicitly historical preset.
- [GM Saki durability guide](https://forum.roseonlinegame.com/topic/6519-guide-how-to-reinforce-to-increase-durability/)
- [Crafting formula change, March 7, 2025](https://forum.roseonlinegame.com/topic/6637-patch-notes-2025-03-07-wandering-wanderings-speedy-summons-youve-got-mail/)
- [Gem 10 difficulty and Plutorune, May 31, 2026](https://forum.roseonlinegame.com/topic/7664-patch-notes-2026-05-31-clan-skills-treasure-chests-gem-10-difficulty-drop-rate-increase/)
- [PAT and shop changes, October 16, 2026](https://forum.roseonlinegame.com/topic/7789-patch-notes-2026-10-16-dolphin-island-rmlui-desert-of-the-dead/)

## Deliberate limits

Market prices are entered by the user. Recipe output quantities and current success formulas are not supplied by the recipe source, so the UI budgets complete sets for a number of attempts, not guaranteed produced items. Refinement requires final success rates, fees, quantities and effective failure drops from the game. Item Mall has a sourced 100%/zero NPC fee preset but still requires material quantities and prices. Saki Medium/High modes do not extrapolate a fabricated total cost to DURA 100. The current PAT recipes need confirmation after the October update.

All data and calculations are displayed inside the app. Source links are optional evidence. Personal data, credentials and conversation details are not included in the site source.

This is an unofficial fan project; game names and artwork remain the property of their respective owners.
