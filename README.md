# Equation Library

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/equation-library?logo=github)](https://github.com/jsglazer/equation-library/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/equation-library/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini)

A pop-up library of your own math formulas for Obsidian, with a live WYSIWYG generator underneath it. Build an equation and watch it render as you type, keep the ones you use again, and drop any of them into a note as `$…$` or `$$…$$`.

**Every equation is a Markdown note in your vault.** The library is a folder; each note's frontmatter holds the name, the LaTeX, a symbol, a category and a note, and the note's body is yours for derivations, examples, sources and backlinks. The popup reads and writes only the frontmatter keys it owns and leaves everything else in the note exactly as you wrote it. There is no separate catalog file to keep in step: Dataview, backlinks, search, sync and the popup all see the same notes.

Works on **macOS, Windows, Linux, iOS and Android** (`isDesktopOnly: false`).

## The popup

Run **Show Equation Library** from the command palette, or click the sigma icon in the ribbon. Run it with the cursor inside an equation and that equation opens already loaded — see [Editing an equation in a note](#editing-an-equation-in-a-note).

**Top panel — the library.** Every equation note is rendered in its own fixed-size tile, as `symbol = equation` when the note has a symbol. Tiles render as they scroll into view, so a large library stays responsive.

| Action | Result |
| --- | --- |
| Click a tile | Loads the equation into the generator for editing, and reveals an **Update** button to save changes back to its note |
| Double-click a tile | Inserts it at the cursor as inline math, `$…$` |
| Shift + double-click | Inserts it as a block equation, `$$…$$` |
| Alt/Option + double-click | Inserts it with its symbol, `$E_p = …$` |
| Right-click a tile | Open the note, insert with symbol, insert as a `[[link]]`, rename, move to another category, duplicate, or delete |

Search, filter by category and by usage tag, and sort by name, newest or recently changed from the toolbar. Search reads names first, then the note field, the LaTeX, the symbol, usage tags and source, and finally the note's body and any other frontmatter, so "the one about damped oscillation" is findable even when the name says `x(t)`. The three buttons on the right create, rename and delete categories. The usage filter appears only when at least one note carries a usage tag.

**Bottom panel — the generator.** The cursor starts in the plain LaTeX source box, which is the only editable field: structure appears as you type — `\frac` immediately becomes a fraction with two slots, no waiting for the closing brace — but that happens above it, in a **preview** field that shows the same live rendering without accepting typing or pasting directly. Next to the preview, a **Copy PNG** button rasterizes the current equation and puts it on the clipboard as an image.

Alongside the name and category sit an optional **Symbol** — the left-hand side, as LaTeX, so tiles read `\bar{x} = …` — and an optional **Note**, free text for what an equation is for or which convention it follows. Both are saved by **Add to Library** and **Update**, come back when you click the tile again, and travel with the equation through export and import.

| Button | Result |
| --- | --- |
| Insert at cursor | Inserts what is in the generator into the active note |
| Add to Library | Creates a new equation note under the chosen name and category |
| Add & Insert | Both, in that order |
| Update *(after clicking a tile)* | Saves the generator's current name, symbol, LaTeX, category and note back to that same note, in place |

Adding an equation whose LaTeX is already in the library does not make a copy: the existing note is loaded for editing instead, so a second click on **Add to Library** is harmless, and **Add & Insert** still inserts it.

**Cmd/Ctrl + Return** fires the primary button — *Insert at cursor*, or *Replace in note* when the popup was opened on an equation in the note — and **Shift + Cmd/Ctrl + Return** fires *Add & Insert*. Both work from anywhere in the popup: the LaTeX box, the name, the note.

Hold **shift** while clicking either insert button to get a block equation instead of inline. **Close after inserting** is a toggle in the bottom-left of the popup, and the plugin version sits in the bottom-right.

`$` signs are optional everywhere. Equations are stored bare in the generator, and the delimiters are added when you insert — which is why one saved equation serves both the inline and the block path. The one exception: inserting while the cursor already sits inside an open `$…$` or `$$…$$` span (from any insert button, a tile double-click, or the `$/` autocomplete below) drops the delimiters instead of nesting a redundant `$` inside your existing equation.

"Already inside math" is judged the way Obsidian actually parses a note, so prose full of dollar signs does not silently swallow your delimiters:

- Inline `$…$` is read one line at a time, because inline math cannot span a line break. A stray `$` earlier in the note has no effect on the line you are typing on.
- `$$…$$` blocks *do* span lines and are tracked across the whole note.
- Fenced code blocks and inline code spans are skipped — a `$ ` shell prompt or a Dataview `` `$=` `` query is not an equation.
- `$100` is money and `$ x` is prose; neither opens math. A `$` typed right at the cursor does.

## Editing an equation in a note

An equation you already wrote can be opened back up in the generator, rather than retyped.

- **Right-click an equation** in the editor and choose **Edit equation in Equation Library**.
- Or put the cursor inside it and run **Show Equation Library**.

Either way the popup opens with that equation loaded, and the primary button becomes **Replace in note**: it rewrites the equation where it sits, keeping the delimiters it already had, instead of adding a second copy at the cursor. If the LaTeX matches something in your library, its name, symbol and category come along too and **Update** appears, so one action can fix both the note and the library.

The same parsing rules as above decide what counts as an equation, so a `$ ` shell prompt in a fenced code block or a `$100` price is never mistaken for one.

## Editor autocomplete

Type `$/` anywhere in a note and a picker of your library opens; keep typing to filter it. Accepting a suggestion replaces the whole `$/query` span with the delimited equation (or bare LaTeX, if the trigger was typed inside an equation already open), so no trigger characters are left behind.

- The picker matches on names and LaTeX only — note text, tags and bodies are deliberately left out, so a common word in a note never floods the popup.
- A bare `$` **never** opens the picker. Ordinary inline math typing is completely untouched.
- The picker does not open inside a fenced code block or an inline code span.
- Pressing Escape closes it for that spot; it comes back at the next one.
- The trigger string is configurable, and the whole feature has an on/off switch.
- Autocomplete is off on **phones**, where the popup fights the on-screen keyboard. Tablets keep it.

## Your library is a folder of notes

The library folder is a setting (`Equation Library` by default). Every Markdown note in it, at any depth, whose frontmatter has the LaTeX key is an equation; a note without that key — an index, a template, a scratch note — is ignored. An equation note looks like this:

```markdown
---
Name: Bayes Theorem
Smb: $P(A|B)$
Eq: $\dfrac{P(A \cap B)}{P(B)}$
Category: Stats
Note: Conditional probability from the joint.
Usage:
  - Sets
  - Probability
Source: OpenStax 3.2
---
Anything you like: a derivation, worked examples, links to the chapters that use it.
```

| Field | Frontmatter key (default) | Written by the plugin | Used for |
| --- | --- | --- | --- |
| Name | `Name` | yes | Display name; falls back to the file name |
| LaTeX | `Eq` | yes | The equation, stored `$…$`-wrapped so an inline Dataview field such as `` `= this.Eq` `` renders it |
| Symbol | `Smb` | yes | The left-hand side; tiles show `symbol = equation` |
| Category | `Category` | yes | Single-valued. Missing or blank means `Uncategorized` |
| Note | `Note` | yes | The generator's note field |
| Usage | `Usage` | no | A list of tags; feeds the usage filter and the search |
| Source | `Source` | no | Where it came from; searched |

Every key name is a setting, so an existing collection of notes can be adopted as it stands — if your notes say `LaTeX:` and `Symbol:`, tell the plugin so. Any other key in a note (`Cond`, `AltName`, `Flag`, `R`, …) is never touched, but its text is still searched.

**Writes are surgical.** Saving an edit rewrites only the lines of the keys that changed, in place; the plugin never re-serializes the frontmatter block, so your key order, spacing, list style and blank fields stay as you left them, and the body is never read for writing at all. Deleting an equation moves its note to the trash, following your Obsidian trash setting. Renaming changes the `Name` field, not the file, so your `[[links]]` keep working.

**New notes** are named from the equation's name with a configurable prefix (`eq-Bayes-Theorem.md`), disambiguated with `-2`, `-3` when taken. If you name a **template note** in the settings, every new equation note is scaffolded from it: the template's frontmatter keys are copied in its order (a Templater `<% … %>` value is blanked), the plugin fills in its own keys, and the template's body becomes the new note's body — so your Dataview backlinks block or standard headings appear in every equation note.

**Categories** are whatever the notes' `Category` values say, plus any you create in the popup before assigning an equation to them (those are remembered in the plugin's settings). Renaming a category rewrites the field in every member note; deleting one blanks it, moving the members to `Uncategorized`, which cannot itself be renamed or deleted. Equations are never deleted as a side effect.

Because the library is ordinary notes, **sync is Obsidian's problem, not the plugin's** — Obsidian Sync, iCloud, Dropbox and git all carry it. Notes edited by hand or changed by sync are picked up the next time the popup opens; the autocomplete re-reads the folder whenever anything under it changes.

### Upgrading from 1.0.x

Version 1.0 kept the library in an `equations.json` file. That file is no longer read. On first load after upgrading, the plugin shows a notice and the old settings are dropped; to bring the equations across, open the JSON, copy it, and paste it into **Settings → Import equations**. Each becomes a note in the library folder; anything whose LaTeX is already there is skipped. The JSON file itself is left where it was.

## The log

`equation-log.jsonl` in the plugin's own folder is an append-only record of what you did on *this* machine — inserts, library additions, in-place updates and accepted autocompletions — never keystrokes or drafts you did not use. It is capped (100, 500 or 1000 entries, or no limit; 500 by default) and the oldest entries are dropped first, which keeps memory use predictable on mobile. It stays local on purpose: syncing it between machines would only manufacture conflicts. The settings panel has a **View log** button that shows it in a scrollable, read-only window with a copy button, since Obsidian will not open the hidden plugin folder in a tab.

## Settings

- **Close after inserting** — close the popup once an equation lands in a note.
- **Insert format** — inline `$…$` by default, or always block `$$…$$`. Shift always forces block.
- **Enable autocomplete**, and the **trigger** characters (`$/` by default).
- **Library folder** — the vault folder whose notes are the library.
- **Template note** — optional scaffold for new equation notes.
- **New note file name prefix** — `eq-` by default; may be empty.
- **Frontmatter keys** — the seven key names above.
- **Log size limit** — 100 / 500 / 1000 entries, or no limit.
- **Export library** — write a JSON snapshot of every equation to a path in your vault.
- **Import equations** — paste an exported catalog (or a 1.0 `equations.json`). Each equation becomes a note; LaTeX already in the library is skipped and a clashing name is suffixed `(2)`.

## Install

Not yet in the community plugin browser. To install manually, copy `main.js`, `manifest.json` and `styles.css` from a [release](https://github.com/jsglazer/equation-library/releases) into `<vault>/.obsidian/plugins/equation-library/`, then enable it in **Settings → Community plugins**.

## Build from source

```bash
npm install
npm run build   # generates the bundled stylesheet, typechecks, then bundles main.js
npm test        # 213 unit tests over the pure core
```

`npm run dev` rebuilds on change.

## How it is put together

- `src/core/` — pure decision logic: search, sorting, category and usage filtering, the catalog model, the note ↔ equation mapping, line-level frontmatter editing, import planning, delimiter handling and math-span scanning, the autocomplete state machine, log capping. No imports from `obsidian`, no DOM, no clock, no I/O; ids and timestamps are passed in. This is what the test suite covers.
- `src/ui/mathlive-adapter.ts` — the single point of contact with [MathLive](https://github.com/arnog/mathlive), which is the only math engine used. Replacing it is a one-file change.
- `src/storage/note-store.ts` — the library as notes: reads frontmatter from Obsidian's metadata cache (synchronous, already in memory), writes through `Vault.process`, and turns the difference between the catalog before and after an edit into note creates, field rewrites and trash moves. `log-store.ts` is the action log, through `vault.adapter`. Node's `fs` and `path` are not imported anywhere.
- `src/editor/`, `src/main.ts` — the Obsidian shell: commands, the suggester, the settings tab.

MathLive's stylesheet ships inside `main.js` with its twenty KaTeX fonts inlined as data URIs, because Obsidian installs only `main.js`, `manifest.json` and `styles.css`. The plugin makes no network requests.

Every colour in `styles.css` is an Obsidian CSS variable, so the popup follows your theme in both light and dark mode.

## Credits

Live math editing by [MathLive](https://cortexjs.io/mathlive/) (MIT). Inspired by [obsidian-mathlive](https://github.com/danzilberdan/obsidian-mathlive) and [obsidian-formula-library](https://github.com/strangelion/obsidian-formula-library).

## License

[MIT](LICENSE) © Josh Glazer
