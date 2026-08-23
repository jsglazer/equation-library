# Equation Library

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/equation-library?logo=github)](https://github.com/jsglazer/equation-library/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/equation-library/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini)

A pop-up library of your own math formulas for Obsidian, with a live WYSIWYG generator underneath it. Build an equation and watch it render as you type, keep the ones you use again, and drop any of them into a note as `$…$` or `$$…$$`.

Works on **macOS, Windows, Linux, iOS and Android** (`isDesktopOnly: false`).

## The popup

Run **Show Equation Library** from the command palette, or click the sigma icon in the ribbon.

**Top panel — the library.** Every saved equation is rendered in its own fixed-size tile. Tiles render as they scroll into view, so a large library stays responsive.

| Action | Result |
| --- | --- |
| Click a tile | Loads the equation into the generator, rendered and as LaTeX source |
| Double-click a tile | Inserts it at the cursor as inline math, `$…$` |
| Shift + double-click | Inserts it as a block equation, `$$…$$` |
| Right-click a tile | Rename, move to another category, or delete |

Search, filter by category and sort by name, newest or recently changed from the toolbar. The three buttons on the right create, rename and delete categories.

**Bottom panel — the generator.** A live math field where structure appears as you type: `\frac` immediately becomes a fraction with two slots, no waiting for the closing brace. Beneath it is a plain LaTeX source box, and the two are bound in both directions — edit either one and the other follows.

| Button | Result |
| --- | --- |
| Insert at cursor | Inserts what is in the generator into the active note |
| Add to Library | Saves it as a new equation under the chosen name and category |
| Add & Insert | Both, in that order |

Hold **shift** while clicking either insert button to get a block equation instead of inline. **Close after inserting** is a toggle in the bottom-left of the popup, and the plugin version sits in the bottom-right.

`$` signs are optional everywhere. Equations are stored bare, and the delimiters are added when you insert — which is why one saved equation serves both the inline and the block path.

## Editor autocomplete

Type `$/` anywhere in a note and a picker of your library opens; keep typing to filter it. Accepting a suggestion replaces the whole `$/query` span with the fully delimited equation, so no trigger characters are left behind.

- A bare `$` **never** opens the picker. Ordinary inline math typing is completely untouched.
- The picker does not open inside a fenced code block or an inline code span.
- Pressing Escape closes it for that spot; it comes back at the next one.
- The trigger string is configurable, and the whole feature has an on/off switch.
- Autocomplete is off on **phones**, where the popup fights the on-screen keyboard. Tablets keep it.

## Storage

Three files, all inside the plugin's own folder — nothing is added to your vault unless you ask for an export.

| File | Contents |
| --- | --- |
| `data.json` | Plugin settings |
| `equations.json` | The equation catalog |
| `equation-log.jsonl` | One line per committed action |

The log records inserts, library additions and accepted autocompletions — never keystrokes or drafts you did not use. It is capped (100, 500 or 1000 entries, or no limit; 500 by default) and the oldest entries are dropped first, which keeps memory use predictable on mobile.

Those files live in a hidden folder that Obsidian will not open in a tab, so the settings panel has **View JSON** and **View log** buttons that show their contents in a scrollable, read-only window with a copy button.

## Settings

- **Close after inserting** — close the popup once an equation lands in a note.
- **Insert format** — inline `$…$` by default, or always block `$$…$$`. Shift always forces block.
- **Enable autocomplete**, and the **trigger** characters (`$/` by default).
- **Log size limit** — 100 / 500 / 1000 entries, or no limit.
- **Export catalog** — write a copy of the catalog to any path in your vault.
- **Import catalog** — paste an exported catalog. Nothing is ever overwritten: a clashing name is suffixed `(2)`, an equation that is already there unchanged is skipped.

Deleting a category never deletes equations — they move to `Uncategorized`, which cannot itself be renamed or deleted.

## Install

Not yet in the community plugin browser. To install manually, copy `main.js`, `manifest.json` and `styles.css` from a [release](https://github.com/jsglazer/equation-library/releases) into `<vault>/.obsidian/plugins/equation-library/`, then enable it in **Settings → Community plugins**.

## Build from source

```bash
npm install
npm run build   # generates the bundled stylesheet, typechecks, then bundles main.js
npm test        # 138 unit tests over the pure core
```

`npm run dev` rebuilds on change.

## How it is put together

- `src/core/` — pure decision logic: search, sorting, category filtering, the catalog model, schema migration, delimiter handling, the autocomplete state machine, log capping. No imports from `obsidian`, no DOM, no clock, no I/O; ids and timestamps are passed in. This is what the test suite covers.
- `src/ui/mathlive-adapter.ts` — the single point of contact with [MathLive](https://github.com/arnog/mathlive), which is the only math engine used. Replacing it is a one-file change.
- `src/storage/` — all file access through `vault.adapter`, so it behaves the same on desktop and mobile. Node's `fs` and `path` are not imported anywhere.
- `src/editor/`, `src/main.ts` — the Obsidian shell: commands, the suggester, the settings tab.

MathLive's stylesheet ships inside `main.js` with its twenty KaTeX fonts inlined as data URIs, because Obsidian installs only `main.js`, `manifest.json` and `styles.css`. The plugin makes no network requests.

Every colour in `styles.css` is an Obsidian CSS variable, so the popup follows your theme in both light and dark mode.

## Credits

Live math editing by [MathLive](https://cortexjs.io/mathlive/) (MIT). Inspired by [obsidian-mathlive](https://github.com/danzilberdan/obsidian-mathlive) and [obsidian-formula-library](https://github.com/strangelion/obsidian-formula-library).

## License

[MIT](LICENSE) © Josh Glazer
