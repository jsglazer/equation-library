# Equation Library

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/equation-library?logo=github)](https://github.com/jsglazer/equation-library/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/equation-library/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini)

A pop-up library of your own math formulas for Obsidian, with a live WYSIWYG generator underneath it. Build an equation and watch it render as you type, keep the ones you use again, and drop any of them into a note as `$…$` or `$$…$$`.

Works on **macOS, Windows, Linux, iOS and Android** (`isDesktopOnly: false`).

## The popup

Run **Show Equation Library** from the command palette, or click the sigma icon in the ribbon. Run it with the cursor inside an equation and that equation opens already loaded — see [Editing an equation in a note](#editing-an-equation-in-a-note).

**Top panel — the library.** Every saved equation is rendered in its own fixed-size tile. Tiles render as they scroll into view, so a large library stays responsive.

| Action | Result |
| --- | --- |
| Click a tile | Loads the equation into the generator for editing, and reveals an **Update** button to save changes back to it |
| Double-click a tile | Inserts it at the cursor as inline math, `$…$` |
| Shift + double-click | Inserts it as a block equation, `$$…$$` |
| Right-click a tile | Rename, move to another category, duplicate, or delete |

Search, filter by category and sort by name, newest or recently changed from the toolbar. Search reads names first, then note text, then the LaTeX itself, so "the one about damped oscillation" is findable even when the name says `x(t)`. The three buttons on the right create, rename and delete categories.

**Bottom panel — the generator.** The cursor starts in the plain LaTeX source box, which is the only editable field: structure appears as you type — `\frac` immediately becomes a fraction with two slots, no waiting for the closing brace — but that happens above it, in a **preview** field that shows the same live rendering without accepting typing or pasting directly. Next to the preview, a **Copy PNG** button rasterizes the current equation and puts it on the clipboard as an image.

Alongside the name and category sits an optional **Note** — free text for what an equation is for, where it came from, or which convention it follows. It is saved by **Add to Library** and **Update**, comes back when you click the tile again, and travels with the equation through export and import.

| Button | Result |
| --- | --- |
| Insert at cursor | Inserts what is in the generator into the active note |
| Add to Library | Saves it as a new equation under the chosen name and category |
| Add & Insert | Both, in that order |
| Update *(after clicking a tile)* | Saves the generator's current name, LaTeX, category and note back to that same equation, in place |

**Cmd/Ctrl + Return** fires the primary button — *Insert at cursor*, or *Replace in note* when the popup was opened on an equation in the note — and **Shift + Cmd/Ctrl + Return** fires *Add & Insert*. Both work from anywhere in the popup: the LaTeX box, the name, the note.

Hold **shift** while clicking either insert button to get a block equation instead of inline. **Close after inserting** is a toggle in the bottom-left of the popup, and the plugin version sits in the bottom-right.

`$` signs are optional everywhere. Equations are stored bare, and the delimiters are added when you insert — which is why one saved equation serves both the inline and the block path. The one exception: inserting while the cursor already sits inside an open `$…$` or `$$…$$` span (from any insert button, a tile double-click, or the `$/` autocomplete below) drops the delimiters instead of nesting a redundant `$` inside your existing equation.

"Already inside math" is judged the way Obsidian actually parses a note, so prose full of dollar signs does not silently swallow your delimiters:

- Inline `$…$` is read one line at a time, because inline math cannot span a line break. A stray `$` earlier in the note has no effect on the line you are typing on.
- `$$…$$` blocks *do* span lines and are tracked across the whole note.
- Fenced code blocks and inline code spans are skipped — a `$ ` shell prompt or a Dataview `` `$=` `` query is not an equation.
- `$100` is money and `$ x` is prose; neither opens math. A `$` typed right at the cursor does.

## Editing an equation in a note

An equation you already wrote can be opened back up in the generator, rather than retyped.

- **Right-click an equation** in the editor and choose **Edit equation in Equation Library**.
- Or put the cursor inside it and run **Show Equation Library**.

Either way the popup opens with that equation loaded, and the primary button becomes **Replace in note**: it rewrites the equation where it sits, keeping the delimiters it already had, instead of adding a second copy at the cursor. If the LaTeX matches something in your library, its name and category come along too and **Update** appears, so one action can fix both the note and the saved equation.

The same parsing rules as above decide what counts as an equation, so a `$ ` shell prompt in a fenced code block or a `$100` price is never mistaken for one.

## Editor autocomplete

Type `$/` anywhere in a note and a picker of your library opens; keep typing to filter it. Accepting a suggestion replaces the whole `$/query` span with the delimited equation (or bare LaTeX, if the trigger was typed inside an equation already open), so no trigger characters are left behind.

- The picker matches on names and LaTeX only — note text is deliberately left out, so a common word in a note never floods the popup.
- A bare `$` **never** opens the picker. Ordinary inline math typing is completely untouched.
- The picker does not open inside a fenced code block or an inline code span.
- Pressing Escape closes it for that spot; it comes back at the next one.
- The trigger string is configurable, and the whole feature has an on/off switch.
- Autocomplete is off on **phones**, where the popup fights the on-screen keyboard. Tablets keep it.

## Storage and sync

| File | Where | Contents |
| --- | --- | --- |
| `equations.json` | In your vault, `Equation Library/equations.json` by default | The equation catalog |
| `data.json` | The plugin's own folder | Plugin settings |
| `equation-log.jsonl` | The plugin's own folder | One line per committed action |

**The catalog is an ordinary vault file so that it syncs.** Obsidian Sync, iCloud, Dropbox and friends replicate what is in your vault; they do not carry extra files that live inside a plugin's folder under `.obsidian/`. Keeping `equations.json` in the vault is what makes the same library show up on every machine.

Upgrading from an earlier version moves the catalog for you: the existing `equations.json` is copied out of the plugin folder to the new location on first load, and the original is left behind untouched as a backup. Both the location and the path are settings, so you can put the file wherever suits your vault — or send it back to the plugin folder if you would rather it stayed on one machine.

The log stays local on purpose. It is an append-only record of what you did on *this* machine, and syncing it between machines would only manufacture conflicts.

The log records inserts, library additions, in-place updates and accepted autocompletions — never keystrokes or drafts you did not use. It is capped (100, 500 or 1000 entries, or no limit; 500 by default) and the oldest entries are dropped first, which keeps memory use predictable on mobile.

`data.json` and the log live in a hidden folder that Obsidian will not open in a tab, so the settings panel has **View JSON** and **View log** buttons that show their contents in a scrollable, read-only window with a copy button.

## Settings

- **Close after inserting** — close the popup once an equation lands in a note.
- **Insert format** — inline `$…$` by default, or always block `$$…$$`. Shift always forces block.
- **Enable autocomplete**, and the **trigger** characters (`$/` by default).
- **Log size limit** — 100 / 500 / 1000 entries, or no limit.
- **Catalog location** — keep `equations.json` in the vault, where sync will carry it, or in the plugin folder for this machine only. Switching copies your equations across.
- **Catalog path** — where in the vault that file goes, `Equation Library/equations.json` by default.
- **Export catalog** — write a copy of the catalog to any path in your vault.
- **Import catalog** — paste an exported catalog. Nothing is ever overwritten: a clashing name is suffixed `(2)`, an equation that is already there unchanged is skipped.

Deleting a category never deletes equations — they move to `Uncategorized`, which cannot itself be renamed or deleted.

## Install

Not yet in the community plugin browser. To install manually, copy `main.js`, `manifest.json` and `styles.css` from a [release](https://github.com/jsglazer/equation-library/releases) into `<vault>/.obsidian/plugins/equation-library/`, then enable it in **Settings → Community plugins**.

## Build from source

```bash
npm install
npm run build   # generates the bundled stylesheet, typechecks, then bundles main.js
npm test        # 167 unit tests over the pure core
```

`npm run dev` rebuilds on change.

## How it is put together

- `src/core/` — pure decision logic: search, sorting, category filtering, the catalog model, schema migration, delimiter handling and math-span scanning, the autocomplete state machine, log capping. No imports from `obsidian`, no DOM, no clock, no I/O; ids and timestamps are passed in. This is what the test suite covers.
- `src/ui/mathlive-adapter.ts` — the single point of contact with [MathLive](https://github.com/arnog/mathlive), which is the only math engine used. Replacing it is a one-file change.
- `src/storage/` — all file access through `vault.adapter`, so it behaves the same on desktop and mobile. Node's `fs` and `path` are not imported anywhere.
- `src/editor/`, `src/main.ts` — the Obsidian shell: commands, the suggester, the settings tab.

MathLive's stylesheet ships inside `main.js` with its twenty KaTeX fonts inlined as data URIs, because Obsidian installs only `main.js`, `manifest.json` and `styles.css`. The plugin makes no network requests.

Every colour in `styles.css` is an Obsidian CSS variable, so the popup follows your theme in both light and dark mode.

## Credits

Live math editing by [MathLive](https://cortexjs.io/mathlive/) (MIT). Inspired by [obsidian-mathlive](https://github.com/danzilberdan/obsidian-mathlive) and [obsidian-formula-library](https://github.com/strangelion/obsidian-formula-library).

## License

[MIT](LICENSE) © Josh Glazer
