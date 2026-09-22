/**
 * The Equation Library panel: a grid of rendered equations on top, a live
 * generator underneath.
 *
 * This used to be a `Modal`. It is now an `ItemView` living in a workspace
 * leaf — a sidebar panel, or a popout window — so it can stay open while the
 * note underneath is being written. `Modal` could not do that at any price: it
 * paints a click-swallowing `.modal-bg` overlay and owns the keyboard scope,
 * both by construction.
 *
 * `LibraryRenderer` holds the UI and is host-agnostic: it draws into whatever
 * element it is handed and never touches the leaf it sits in. The `ItemView` at
 * the bottom of this file is a thin mount for it.
 *
 * All decision logic — search, sort, category filtering, catalog edits,
 * delimiter handling, re-finding a moved equation — lives in `src/core/`. This
 * file reads the catalog, draws it, and applies the results of those pure
 * functions.
 */
import {
	App,
	ButtonComponent,
	EditorPosition,
	ItemView,
	Menu,
	Notice,
	Platform,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { Catalog, Equation, LogAction, UNCATEGORIZED } from "../core/types";
import { EquationLibrarySettings } from "../core/settings";
import {
	InsertMode,
	isInsideMath,
	relocateMathSpan,
	resolveInsertMode,
	stripDelimiters,
	wrapDelimiters,
} from "../core/latex";
import { SortOrder, allUsages, searchEquations } from "../core/search";
import {
	addCategory,
	addEquation,
	deleteCategory,
	deleteEquation,
	findByLatex,
	orderedCategories,
	renameCategory,
	updateEquation,
} from "../core/catalog";
import {
	MathFieldHandle,
	copyLatexAsPng,
	createMathField,
	hideVirtualKeyboard,
	renderLatexInto,
} from "./mathlive-adapter";
import { EditorTarget } from "./editor-tracker";
import { PromptModal } from "./prompt-modal";

export const LIBRARY_VIEW_TYPE = "equation-library";

export interface LogRequest {
	readonly action: LogAction;
	readonly latex: string;
	readonly name?: string;
	readonly category?: string;
}

/**
 * An equation the panel should open with already loaded in the generator.
 *
 * `range` is the span in the document the LaTeX came from: when it is present
 * an insert rewrites that span in place — editing an equation where it sits —
 * rather than adding a second copy at the cursor. `filePath` records which note
 * that span was in, because the panel outlives the note being on screen.
 */
export interface GeneratorPrefill {
	readonly latex: string;
	readonly mode: InsertMode;
	readonly range?: { readonly from: EditorPosition; readonly to: EditorPosition };
	readonly filePath?: string;
}

export interface LibraryViewDeps {
	readonly version: string;
	readonly getSettings: () => EquationLibrarySettings;
	readonly saveSettings: (patch: Partial<EquationLibrarySettings>) => Promise<void>;
	readonly loadCatalog: () => Promise<Catalog>;
	/**
	 * Persists the difference between the catalog as loaded and as edited, and
	 * returns the catalog re-read from storage (new equations get their real ids).
	 */
	readonly saveCatalog: (previous: Catalog, next: Catalog) => Promise<Catalog>;
	/** Opens the note behind an equation; false when it no longer exists. */
	readonly openNote: (id: string) => Promise<boolean>;
	/** The `[[link]]` text that points at an equation's note from the active note. */
	readonly linkFor: (id: string) => string;
	readonly log: (request: LogRequest) => void;
	/** A placeholder id for an equation not yet saved; storage assigns the real one. */
	readonly mintId: () => string;
	readonly now: () => string;
	readonly isMobile: boolean;
	/**
	 * The note to insert into, resolved fresh on every call.
	 *
	 * This replaced an `Editor` captured when the popup opened: with a non-modal
	 * panel that capture goes stale the moment the user switches or closes a tab.
	 */
	readonly getEditor: () => EditorTarget | null;
	/** Fires when that target changes, so the insert buttons can follow it. */
	readonly onEditorChange: (listener: () => void) => () => void;
	/**
	 * Fires when a note under the library folder is written, renamed or deleted
	 * — by this panel, by hand, or by sync. Returns an unsubscribe function.
	 */
	readonly onLibraryChange: (listener: () => void) => () => void;
}

const ALL_CATEGORIES = "__all__";
const ALL_USAGES = "__all__";

/** An edit-in-place waiting to be applied, and where it came from. */
interface PendingReplace {
	readonly range: { readonly from: EditorPosition; readonly to: EditorPosition };
	/** The LaTeX as it stood in the document, used to find the span again. */
	readonly latex: string;
	readonly mode: InsertMode;
	readonly filePath?: string;
}

/** `symbol = latex` when the equation has a symbol, otherwise just the LaTeX. */
function withSymbol(equation: Equation): string {
	return equation.symbol ? `${equation.symbol} = ${equation.latex}` : equation.latex;
}

/** The same rule as `withSymbol`, for the loose fields in the generator. */
function joinSymbol(symbol: string, latex: string): string {
	const trimmed = symbol.trim();
	return trimmed.length > 0 && latex.length > 0 ? `${trimmed} = ${latex}` : trimmed.length > 0 ? trimmed : latex;
}

/** The generator's fields as saved, used to tell an edited equation from an untouched one. */
interface GeneratorSnapshot {
	readonly name: string;
	readonly symbol: string;
	readonly note: string;
	readonly latex: string;
	readonly category: string;
}

export class LibraryRenderer {
	private catalog: Catalog = { schemaVersion: 1, categories: [UNCATEGORIZED], equations: [] };
	private searchText = "";
	private category: string | null;
	/** The Usage tag filter; null is "any". Not remembered between sessions. */
	private usage: string | null = null;
	private sort: SortOrder;
	/**
	 * True while a save is being written. Saving creates or edits notes, which
	 * takes long enough for a second click to land, so every action that writes
	 * checks this first — a double-click on Add to Library saves once.
	 */
	private busy = false;

	private rootEl!: HTMLElement;
	private gridEl!: HTMLElement;
	private scrollEl!: HTMLElement;
	private searchEl!: HTMLInputElement;
	private searchClearEl!: HTMLElement;
	private observer: IntersectionObserver | null = null;
	private unsubscribeEditor: (() => void) | null = null;
	private unsubscribeLibrary: (() => void) | null = null;
	/** A note under the library folder changed and the grid has not caught up. */
	private stale = false;
	/** False until the first catalog load has been taken in. */
	private loaded = false;
	/** The pending debounced reload, so a burst of vault events reloads once. */
	private refreshTimer: number | null = null;
	private readonly pending = new Map<HTMLElement, Equation>();
	/** Rendered markup, cached for the panel's lifetime and keyed by content. */
	private readonly markupCache = new Map<string, string>();

	private mathField: MathFieldHandle | null = null;
	private latexInput!: HTMLTextAreaElement;
	private nameInput!: HTMLInputElement;
	private symbolInput!: HTMLInputElement;
	private noteInput!: HTMLTextAreaElement;
	private usageFilterEl!: HTMLSelectElement;
	private generatorCategoryEl!: HTMLSelectElement;
	private generatorCategory = UNCATEGORIZED;
	private latex = "";
	private insertButtons: ButtonComponent[] = [];
	private addButton: ButtonComponent | null = null;
	private updateButton: ButtonComponent | null = null;
	private openNoteButton: ButtonComponent | null = null;
	/** The equation the generator is editing, or null when building a fresh one. */
	private editingEquationId: string | null = null;
	/** That equation's fields as loaded; null when nothing is loaded from the library. */
	private editingBaseline: GeneratorSnapshot | null = null;
	/** The pending edit-in-place, or null when an insert goes at the cursor. */
	private replace: PendingReplace | null = null;

	constructor(private readonly app: App, private readonly deps: LibraryViewDeps) {
		const settings = deps.getSettings();
		this.category = settings.lastCategory;
		this.sort = settings.sortOrder;
	}

	/**
	 * Draws the panel into `parent`.
	 *
	 * Nothing here takes focus. The modal fought Obsidian for the caret on open
	 * — the Search Equations field won it, which was right when the workspace
	 * was frozen behind the modal. In a docked panel the same code would yank
	 * the cursor out of the note being typed in, so the panel now takes focus
	 * only when it is clicked. The search field is still the first tabbable
	 * element, so one Tab reaches it.
	 */
	mount(parent: HTMLElement): void {
		this.rootEl = parent;
		parent.empty();
		parent.addClass("eqlib-content", "eqlib-panel");

		this.buildToolbar(parent);
		this.scrollEl = parent.createDiv({ cls: "eqlib-grid-scroll" });
		this.gridEl = this.scrollEl.createDiv({ cls: "eqlib-grid" });
		this.buildGenerator(parent);
		this.buildFooter(parent);
		this.registerShortcuts(parent);

		const win = parent.win as Window & typeof globalThis;
		this.observer = new win.IntersectionObserver((entries) => this.onIntersect(entries), {
			root: this.scrollEl,
			rootMargin: "200px",
		});

		this.unsubscribeEditor = this.deps.onEditorChange(() => this.refreshEditorState());
		this.unsubscribeLibrary = this.deps.onLibraryChange(() => this.onLibraryChanged());
		this.refreshEditorState();

		void this.refreshCatalog();
	}

	// -------------------------------------------------------------- refresh

	/**
	 * A note under the library folder changed on disk.
	 *
	 * The grid is redrawn straight away when the panel is on screen, and marked
	 * stale when it is not — a panel in a collapsed sidebar or a background tab
	 * catches up the moment it is shown again, rather than re-rendering tiles
	 * nobody is looking at. Vault events arrive in bursts (one save can touch
	 * several notes), so the reload is debounced.
	 */
	private onLibraryChanged(): void {
		this.stale = true;
		if (this.isVisible()) this.scheduleRefresh();
	}

	/** Called by the host view when its leaf becomes visible again. */
	viewShown(): void {
		if (this.stale) this.scheduleRefresh();
	}

	private isVisible(): boolean {
		return this.rootEl?.isShown?.() ?? true;
	}

	private scheduleRefresh(): void {
		const win = this.rootEl?.win as (Window & typeof globalThis) | undefined;
		if (!win) return;
		if (this.refreshTimer !== null) win.clearTimeout(this.refreshTimer);
		this.refreshTimer = win.setTimeout(() => {
			this.refreshTimer = null;
			void this.refreshCatalog();
		}, 300);
	}

	/** The Refresh button: reload from the notes now, stale or not. */
	private async reloadNow(): Promise<void> {
		const win = this.rootEl?.win as (Window & typeof globalThis) | undefined;
		if (this.refreshTimer !== null && win) {
			win.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		await this.refreshCatalog();
		new Notice(
			this.catalog.equations.length === 1
				? "Reloaded the library — 1 equation."
				: `Reloaded the library — ${this.catalog.equations.length} equations.`,
		);
	}

	/**
	 * Cmd/Ctrl+Return runs the primary action — Insert at cursor, or Replace in
	 * note when the panel was opened on an equation in the document — and
	 * Cmd/Ctrl+Shift+Return runs Add & Insert. They are bound on the panel body
	 * rather than per field so they fire from the LaTeX box, the name, the note
	 * or a focused button alike.
	 *
	 * Neither fires without a note to insert into, which is the same condition
	 * that disables the two buttons — and it is tested now, not at open.
	 */
	private registerShortcuts(parent: HTMLElement): void {
		parent.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
			if (this.deps.getEditor() === null) {
				new Notice("Open a markdown note to insert an equation.");
				return;
			}
			event.preventDefault();
			// The shortcut carries no format intent of its own: Shift already
			// selects the action, so the insert format stays the configured one.
			if (event.shiftKey) void this.onAddAndInsert(undefined);
			else this.onInsert(undefined);
		});
	}

	unmount(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.unsubscribeEditor?.();
		this.unsubscribeEditor = null;
		this.unsubscribeLibrary?.();
		this.unsubscribeLibrary = null;
		const win = this.rootEl?.win as (Window & typeof globalThis) | undefined;
		if (this.refreshTimer !== null && win) win.clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		this.pending.clear();
		this.mathField?.destroy();
		this.mathField = null;
		this.insertButtons = [];
		this.addButton = null;
		this.updateButton = null;
		this.openNoteButton = null;
		hideVirtualKeyboard();
		this.rootEl?.empty();
	}

	// ---------------------------------------------------------------- chrome

	private buildToolbar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "eqlib-toolbar" });

		// The clear affordance is drawn rather than left to the browser: Obsidian
		// hides the native `type="search"` cancel button, and on mobile there is
		// none to hide.
		const searchWrap = bar.createDiv({ cls: "eqlib-search-wrap" });
		const search = searchWrap.createEl("input", { cls: "eqlib-search", type: "search" });
		search.placeholder = "Search equations";
		this.searchEl = search;
		search.addEventListener("input", () => {
			this.searchText = search.value;
			this.syncSearchClear();
			this.renderGrid();
		});
		search.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && search.value.length > 0) {
				event.preventDefault();
				this.clearSearch();
			}
		});

		const clear = searchWrap.createEl("button", {
			cls: "eqlib-search-clear",
			attr: { type: "button", "aria-label": "Clear the search" },
		});
		setIcon(clear, "x");
		clear.addEventListener("click", () => this.clearSearch());
		this.searchClearEl = clear;
		this.syncSearchClear();

		const categorySelect = bar.createEl("select", { cls: "dropdown eqlib-category-filter" });
		this.fillCategoryFilter(categorySelect);
		categorySelect.addEventListener("change", () => {
			this.category = categorySelect.value === ALL_CATEGORIES ? null : categorySelect.value;
			void this.deps.saveSettings({ lastCategory: this.category });
			this.renderGrid();
		});

		this.usageFilterEl = bar.createEl("select", { cls: "dropdown eqlib-usage-filter" });
		this.fillUsageFilter();
		this.usageFilterEl.addEventListener("change", () => {
			this.usage = this.usageFilterEl.value === ALL_USAGES ? null : this.usageFilterEl.value;
			this.renderGrid();
		});

		const sortSelect = bar.createEl("select", { cls: "dropdown eqlib-sort" });
		for (const [value, label] of [
			["name", "Name"],
			["created", "Newest"],
			["modified", "Recently changed"],
		] as Array<[SortOrder, string]>) {
			const option = sortSelect.createEl("option", { text: label });
			option.value = value;
		}
		sortSelect.value = this.sort;
		sortSelect.addEventListener("change", () => {
			this.sort = sortSelect.value as SortOrder;
			void this.deps.saveSettings({ sortOrder: this.sort });
			this.renderGrid();
		});

		const actions = bar.createDiv({ cls: "eqlib-toolbar-actions" });
		new ButtonComponent(actions)
			.setIcon("refresh-cw")
			.setTooltip("Reload the library from the notes")
			.onClick(() => void this.reloadNow());
		new ButtonComponent(actions)
			.setIcon("folder-plus")
			.setTooltip("New category")
			.onClick(() => this.promptNewCategory());
		new ButtonComponent(actions)
			.setIcon("pencil")
			.setTooltip("Rename the selected category")
			.onClick(() => this.promptRenameCategory());
		new ButtonComponent(actions)
			.setIcon("trash-2")
			.setTooltip("Delete the selected category (its equations move to Uncategorized)")
			.onClick(() => this.confirmDeleteCategory());
	}

	/** The x only exists while there is something to clear. */
	private syncSearchClear(): void {
		this.searchClearEl?.toggle(this.searchEl.value.length > 0);
	}

	private clearSearch(): void {
		this.searchEl.value = "";
		this.searchText = "";
		this.syncSearchClear();
		this.renderGrid();
		this.searchEl.focus();
	}

	private fillCategoryFilter(select: HTMLSelectElement): void {
		select.empty();
		const all = select.createEl("option", { text: "All categories" });
		all.value = ALL_CATEGORIES;
		for (const category of orderedCategories(this.catalog)) {
			const option = select.createEl("option", { text: category });
			option.value = category;
		}
		select.value = this.category ?? ALL_CATEGORIES;
		// A category that was deleted elsewhere falls back to "all".
		if (select.value !== (this.category ?? ALL_CATEGORIES)) {
			this.category = null;
			select.value = ALL_CATEGORIES;
		}
	}

	/**
	 * The Usage filter lists every tag found in the library. Tags are read from
	 * the notes and never edited here, so the list is whatever the notes say.
	 * It is hidden when no note carries a tag, keeping the toolbar unchanged
	 * for a library that does not use them.
	 */
	private fillUsageFilter(): void {
		const select = this.usageFilterEl;
		select.empty();
		const usages = allUsages(this.catalog.equations);
		const all = select.createEl("option", { text: "All usages" });
		all.value = ALL_USAGES;
		for (const usage of usages) {
			const option = select.createEl("option", { text: usage });
			option.value = usage;
		}
		select.value = this.usage ?? ALL_USAGES;
		if (select.value !== (this.usage ?? ALL_USAGES)) {
			this.usage = null;
			select.value = ALL_USAGES;
		}
		select.toggle(usages.length > 0);
	}

	private buildGenerator(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "eqlib-generator" });
		panel.createEl("h4", { text: "Generator", cls: "eqlib-panel-title" });

		const meta = panel.createDiv({ cls: "eqlib-generator-meta" });
		this.nameInput = meta.createEl("input", { cls: "eqlib-name", type: "text" });
		this.nameInput.placeholder = "Equation name";

		this.nameInput.addEventListener("input", () => this.refreshAddButton());

		this.symbolInput = meta.createEl("input", { cls: "eqlib-symbol", type: "text" });
		this.symbolInput.placeholder = "Symbol (LaTeX, optional)";
		this.symbolInput.spellcheck = false;
		// The preview renders `symbol = equation`, the same shape the tiles use,
		// so what is previewed is what the library will show.
		this.symbolInput.addEventListener("input", () => {
			this.syncPreview();
			this.refreshAddButton();
		});

		const categorySelect = meta.createEl("select", { cls: "dropdown eqlib-generator-category" });
		categorySelect.addEventListener("change", () => {
			this.generatorCategory = categorySelect.value;
			this.refreshAddButton();
		});
		this.generatorCategoryEl = categorySelect;

		this.noteInput = panel.createEl("textarea", { cls: "eqlib-note" });
		this.noteInput.placeholder = "Note (optional) — what this is for, where it came from";
		this.noteInput.rows = 2;
		this.noteInput.addEventListener("input", () => this.refreshAddButton());

		const fieldHeader = panel.createDiv({ cls: "eqlib-mathfield-header" });
		fieldHeader.createSpan({ cls: "eqlib-mathfield-label", text: "Preview" });
		new ButtonComponent(fieldHeader)
			.setIcon("image-down")
			.setTooltip("Copy the rendered equation as a PNG")
			.onClick(() => void this.onCopyPng());

		const fieldWrap = panel.createDiv({ cls: "eqlib-mathfield-wrap" });
		this.mathField = createMathField(fieldWrap, {
			initialLatex: "",
			// The on-screen math keyboard is for touch devices; on desktop the
			// hardware keyboard is used and the keyboard panel is in the way.
			virtualKeyboard: this.deps.isMobile,
			// The LaTeX source textarea is the only editable source of truth;
			// this field only ever previews it.
			readOnly: true,
		});

		this.latexInput = panel.createEl("textarea", { cls: "eqlib-latex" });
		this.latexInput.placeholder = "LaTeX source — $ signs optional";
		this.latexInput.spellcheck = false;
		this.latexInput.addEventListener("input", () => {
			this.latex = stripDelimiters(this.latexInput.value);
			this.syncPreview();
			this.refreshAddButton();
		});

		const buttons = panel.createDiv({ cls: "eqlib-buttons" });
		this.insertButtons = [];

		const insertButton = new ButtonComponent(buttons)
			.setButtonText("Insert at cursor")
			.setTooltip(`Insert the equation into the note (${this.modifierLabel()}+Return).`)
			.setCta()
			.onClick((event) => this.onInsert(event));
		this.addButton = new ButtonComponent(buttons)
			.setButtonText("Add to Library")
			.onClick(() => void this.onAddToLibrary());
		const addButton = this.addButton;
		const addInsertButton = new ButtonComponent(buttons)
			.setButtonText("Add & Insert")
			.setTooltip(`Save it and insert it (Shift+${this.modifierLabel()}+Return).`)
			.onClick((event) => void this.onAddAndInsert(event));
		this.insertButtons = [insertButton, addInsertButton];

		this.updateButton = new ButtonComponent(buttons)
			.setButtonText("Update")
			.setTooltip("Save these changes back to the equation loaded from the library.")
			.onClick(() => void this.onUpdateEquation());
		this.updateButton.buttonEl.hide();

		this.openNoteButton = new ButtonComponent(buttons)
			.setButtonText("Open note")
			.setIcon("file-text")
			.setTooltip("Open this equation's note.")
			.onClick(() => {
				if (this.editingEquationId !== null) void this.openEquationNote(this.editingEquationId);
			});
		this.openNoteButton.buttonEl.hide();

		new ButtonComponent(buttons)
			.setButtonText("New")
			.setTooltip("Clear the generator and start a fresh equation.")
			.onClick(() => this.clearGenerator());

		addButton.setTooltip("Save this equation to the library.");
		this.refreshAddButton();
	}

	/** What the preview renders: the symbol and the equation, as the tiles show them. */
	private syncPreview(): void {
		this.mathField?.setLatex(joinSymbol(this.symbolInput.value, this.latex));
	}

	/** The generator's fields right now, in the same shape as a saved equation. */
	private snapshot(): GeneratorSnapshot {
		return {
			name: this.nameInput.value.trim(),
			symbol: this.symbolInput.value.trim(),
			note: this.noteInput.value,
			latex: this.currentLatex(),
			category: this.generatorCategory,
		};
	}

	/**
	 * "Add to Library" is hidden while the generator holds a library equation
	 * exactly as it was loaded: adding it again cannot do anything but report
	 * that it is already there. Change any field and it comes back — that is
	 * the point at which adding means something (a new equation alongside the
	 * old one, where Update would overwrite it).
	 */
	private refreshAddButton(): void {
		const button = this.addButton;
		if (!button) return;
		const baseline = this.editingBaseline;
		const unchanged =
			this.editingEquationId !== null && baseline !== null && this.matchesBaseline(baseline, this.snapshot());
		button.buttonEl.toggle(!unchanged);
	}

	private matchesBaseline(baseline: GeneratorSnapshot, current: GeneratorSnapshot): boolean {
		return (
			baseline.name === current.name &&
			baseline.symbol === current.symbol &&
			baseline.note.trim() === current.note.trim() &&
			baseline.latex === current.latex &&
			baseline.category === current.category
		);
	}

	/**
	 * Empties the generator for a new equation: the fields, the identity of the
	 * equation being edited, and any pending edit-in-place — that range belongs
	 * to the equation just cleared. The category is left alone, since the next
	 * equation is usually filed with the last one.
	 */
	private clearGenerator(): void {
		this.latex = "";
		this.latexInput.value = "";
		this.nameInput.value = "";
		this.symbolInput.value = "";
		this.noteInput.value = "";
		this.editingEquationId = null;
		this.editingBaseline = null;
		this.replace = null;
		this.syncPreview();
		this.updateButton?.buttonEl.hide();
		this.openNoteButton?.buttonEl.hide();
		this.setPrimaryButton();
		this.refreshAddButton();
		this.refreshEditorState();
		this.latexInput.focus();
	}

	/** The modifier the platform actually uses, for tooltips. */
	private modifierLabel(): string {
		return Platform.isMacOS ? "Cmd" : "Ctrl";
	}

	/**
	 * Enables or disables the two insert actions for the note situation right
	 * now.
	 *
	 * "Add to Library" stays available with no note open; the two insert actions
	 * cannot work without one and say so. The modal decided this once, when it
	 * opened, and was then stuck with the answer — a panel that outlives the note
	 * it was opened next to has to keep asking.
	 */
	private refreshEditorState(): void {
		const hasEditor = this.deps.getEditor() !== null;
		for (const [index, button] of this.insertButtons.entries()) {
			button.setDisabled(!hasEditor);
			if (!hasEditor) {
				button.setTooltip("Open a markdown note to insert an equation.");
			} else if (index === 0) {
				button.setTooltip(
					this.replace
						? `Rewrite the equation where it sits in the note (${this.modifierLabel()}+Return).`
						: `Insert the equation into the note (${this.modifierLabel()}+Return).`,
				);
			} else {
				button.setTooltip(`Save it and insert it (Shift+${this.modifierLabel()}+Return).`);
			}
		}
	}

	/**
	 * Loads an equation found in the document into the generator.
	 *
	 * Called both when the panel is first opened on an equation and when it is
	 * already open and "Edit equation in Equation Library" is chosen again,
	 * which is now possible because the panel never closed.
	 */
	loadPrefill(prefill: GeneratorPrefill | undefined): void {
		if (!prefill || prefill.latex.length === 0) return;
		this.latex = stripDelimiters(prefill.latex);
		this.latexInput.value = this.latex;
		// A second prefill is a different equation: the fields and the identity
		// of the one before it must not linger.
		this.editingEquationId = null;
		this.editingBaseline = null;
		this.nameInput.value = "";
		this.symbolInput.value = "";
		this.noteInput.value = "";
		this.syncPreview();
		this.updateButton?.buttonEl.hide();
		this.openNoteButton?.buttonEl.hide();
		this.replace = prefill.range
			? { range: prefill.range, latex: this.latex, mode: prefill.mode, filePath: prefill.filePath }
			: null;
		this.setPrimaryButton();
		this.adoptPrefilledEquation();
		this.refreshAddButton();
		this.refreshEditorState();
	}

	/** The primary button says what it will do: replace in place, or insert. */
	private setPrimaryButton(): void {
		this.insertButtons[0]?.setButtonText(this.replace ? "Replace in note" : "Insert at cursor");
	}

	private buildFooter(parent: HTMLElement): void {
		const footer = parent.createDiv({ cls: "eqlib-footer" });
		footer.createDiv({ cls: "eqlib-version", text: `v${this.deps.version}` });
	}

	// ----------------------------------------------------------------- data

	private async refreshCatalog(): Promise<void> {
		this.catalog = await this.deps.loadCatalog();
		this.stale = false;
		this.syncCategorySelectors();
		this.fillUsageFilter();
		// Only the first load adopts: a reload triggered by a note changing on
		// disk must not reach into a generator the user is halfway through
		// filling in and overwrite the name they just typed.
		if (!this.loaded) {
			this.loaded = true;
			this.adoptPrefilledEquation();
		}
		this.refreshAddButton();
		this.renderGrid();
	}

	/**
	 * If the LaTeX in the generator is already in the library, adopt that
	 * equation's name, category and identity so Update saves back to it.
	 */
	private adoptPrefilledEquation(): void {
		if (this.editingEquationId !== null || this.latex.length === 0) return;
		const match = this.catalog.equations.find((equation) => equation.latex === this.latex);
		if (!match) return;
		this.adoptEquation(match);
	}

	/** Makes the generator edit `equation` in place: fields filled, Update shown. */
	private adoptEquation(equation: Equation): void {
		this.nameInput.value = equation.name;
		this.symbolInput.value = equation.symbol ?? "";
		this.noteInput.value = equation.note ?? "";
		this.generatorCategory = equation.category;
		this.generatorCategoryEl.value = equation.category;
		this.editingEquationId = equation.id;
		this.editingBaseline = {
			name: equation.name,
			symbol: equation.symbol?.trim() ?? "",
			note: equation.note ?? "",
			latex: equation.latex,
			category: equation.category,
		};
		this.syncPreview();
		this.updateButton?.buttonEl.show();
		this.openNoteButton?.buttonEl.show();
		this.refreshAddButton();
	}

	private syncCategorySelectors(): void {
		const filter = this.rootEl.querySelector<HTMLSelectElement>(".eqlib-category-filter");
		if (filter) this.fillCategoryFilter(filter);

		const select = this.generatorCategoryEl;
		select.empty();
		for (const category of orderedCategories(this.catalog)) {
			const option = select.createEl("option", { text: category });
			option.value = category;
		}
		if (!this.catalog.categories.includes(this.generatorCategory)) this.generatorCategory = UNCATEGORIZED;
		select.value = this.generatorCategory;
	}

	/**
	 * Writes an edited catalog to storage and adopts what storage read back.
	 *
	 * The re-read matters: a new equation's placeholder id becomes its note
	 * path, so a following Update or Delete addresses the right note. Returns
	 * the saved catalog, or null when the write failed (the notice is shown
	 * here, the in-memory catalog is left as it was).
	 */
	private async commit(catalog: Catalog): Promise<Catalog | null> {
		if (this.busy) {
			new Notice("Still saving the last change.");
			return null;
		}
		this.busy = true;
		try {
			this.catalog = await this.deps.saveCatalog(this.catalog, catalog);
		} catch (error) {
			new Notice(`Equation Library: could not save (${String(error)}).`);
			return null;
		} finally {
			this.busy = false;
		}
		this.syncCategorySelectors();
		this.fillUsageFilter();
		this.renderGrid();
		return this.catalog;
	}

	// ----------------------------------------------------------------- grid

	private renderGrid(): void {
		this.observer?.disconnect();
		this.pending.clear();
		this.gridEl.empty();

		const results = searchEquations(this.catalog.equations, {
			text: this.searchText,
			category: this.category,
			usage: this.usage,
			sort: this.sort,
		});

		if (results.length === 0) {
			this.gridEl.createDiv({
				cls: "eqlib-empty",
				text:
					this.catalog.equations.length === 0
						? "The library is empty. Build an equation below and choose Add to Library."
						: "No equations match this search.",
			});
			return;
		}

		for (const equation of results) {
			const tile = this.gridEl.createDiv({ cls: "eqlib-tile" });
			tile.setAttribute("aria-label", equation.name);
			const body = tile.createDiv({ cls: "eqlib-tile-body" });
			body.createDiv({ cls: "eqlib-tile-placeholder" });
			tile.createDiv({ cls: "eqlib-tile-label", text: equation.name });

			tile.addEventListener("click", () => this.loadIntoGenerator(equation));
			tile.addEventListener("dblclick", (event) => this.onTileInsert(equation, event));
			tile.addEventListener("contextmenu", (event) => this.showTileMenu(equation, event));

			this.pending.set(tile, equation);
			this.observer?.observe(tile);
		}
	}

	/**
	 * Tiles render only once they scroll into view, in whatever batch the
	 * observer hands over, and their markup is cached so scrolling back is free.
	 */
	private onIntersect(entries: IntersectionObserverEntry[]): void {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const tile = entry.target as HTMLElement;
			const equation = this.pending.get(tile);
			if (!equation) continue;
			this.pending.delete(tile);
			this.observer?.unobserve(tile);
			this.renderTile(tile, equation);
		}
	}

	private renderTile(tile: HTMLElement, equation: Equation): void {
		const body = tile.querySelector<HTMLElement>(".eqlib-tile-body");
		if (!body) return;
		body.empty();
		const shown = withSymbol(equation);
		const key = `${equation.id}:${shown}`;
		const cached = this.markupCache.get(key);
		if (cached !== undefined) {
			body.innerHTML = cached;
			return;
		}
		renderLatexInto(body, shown, "inline");
		this.markupCache.set(key, body.innerHTML);
	}

	// -------------------------------------------------------------- actions

	/**
	 * Picking an equation out of the library is a fresh insert, so it clears any
	 * pending edit-in-place: that range belongs to the equation loaded from the
	 * document, not to this one.
	 */
	private loadIntoGenerator(equation: Equation): void {
		this.latex = equation.latex;
		this.latexInput.value = equation.latex;
		this.adoptEquation(equation);
		this.replace = null;
		this.setPrimaryButton();
		this.refreshEditorState();
	}

	private currentLatex(): string {
		return stripDelimiters(this.latex.length > 0 ? this.latex : this.latexInput.value);
	}

	private insertMode(event: MouseEvent | KeyboardEvent | undefined): InsertMode {
		return resolveInsertMode(this.deps.getSettings().insertFormat, event?.shiftKey === true);
	}

	/**
	 * Writes the equation into the note, either over the span it came from or at
	 * the cursor.
	 *
	 * Inserting inside a `$...$` or `$$...$$` span already open at the cursor
	 * drops the delimiters — adding another pair would either break the existing
	 * equation or start a nested one.
	 */
	private insertIntoEditor(latex: string, event: MouseEvent | KeyboardEvent | undefined): boolean {
		const target = this.deps.getEditor();
		if (!target) {
			new Notice("Open a markdown note first — there is nowhere to insert.");
			return false;
		}

		// An equation opened from the document is rewritten where it sits, in the
		// delimiters it already had — but only where it *now* sits.
		const pending = this.replace;
		if (pending) {
			this.replace = null;
			this.setPrimaryButton();
			const range = this.resolveReplaceRange(target, pending);
			if (range) {
				target.editor.replaceRange(wrapDelimiters(latex, pending.mode), range.from, range.to);
				target.editor.setCursor(range.from);
				return true;
			}
			// Never overwrite a range that could not be re-confirmed: the text
			// there now is not the equation this panel was opened on.
			new Notice("Could not find that equation in this note any more — inserting at the cursor instead.");
		}

		const textBeforeCursor = target.editor.getRange({ line: 0, ch: 0 }, target.editor.getCursor());
		const insertText = isInsideMath(textBeforeCursor)
			? stripDelimiters(latex)
			: wrapDelimiters(latex, this.insertMode(event));
		target.editor.replaceSelection(insertText);
		return true;
	}

	/**
	 * Where the pending edit-in-place actually belongs in the live document.
	 *
	 * The positions captured when the panel opened describe the note as it was
	 * then; two paragraphs typed above the equation since have moved it, and
	 * replacing at the remembered range would silently delete whatever prose now
	 * sits there. So the note is rescanned and the equation found again — and if
	 * it cannot be found, or the note on screen is not the one it came from, the
	 * answer is `null` rather than a guess.
	 */
	private resolveReplaceRange(
		target: EditorTarget,
		pending: PendingReplace,
	): { from: EditorPosition; to: EditorPosition } | null {
		if (pending.filePath !== undefined && pending.filePath !== target.filePath) return null;
		const nearOffset = target.editor.posToOffset(pending.range.from);
		const span = relocateMathSpan(target.editor.getValue(), pending.latex, nearOffset);
		if (span === null) return null;
		return { from: target.editor.offsetToPos(span.start), to: target.editor.offsetToPos(span.end) };
	}

	private onInsert(event: MouseEvent | KeyboardEvent | undefined): void {
		const latex = this.currentLatex();
		if (latex.length === 0) {
			new Notice("Nothing to insert — the generator is empty.");
			return;
		}
		if (!this.insertIntoEditor(latex, event)) return;
		this.deps.log({ action: "insert-at-cursor", latex });
	}

	/**
	 * Double-click inserts the equation; shift makes it a block; alt (option)
	 * prefixes the symbol, `E_p = …`, when the equation has one.
	 */
	private onTileInsert(equation: Equation, event: MouseEvent, symbol = event.altKey): void {
		const latex = symbol ? withSymbol(equation) : equation.latex;
		if (!this.insertIntoEditor(latex, event)) return;
		this.deps.log({
			action: "insert-at-cursor",
			latex,
			name: equation.name,
			category: equation.category,
		});
	}

	/** Inserts a wikilink to the equation's note at the cursor. */
	private onTileInsertLink(equation: Equation): void {
		const target = this.deps.getEditor();
		if (!target) {
			new Notice("Open a markdown note first — there is nowhere to insert.");
			return;
		}
		target.editor.replaceSelection(this.deps.linkFor(equation.id));
		this.deps.log({
			action: "insert-at-cursor",
			latex: equation.latex,
			name: equation.name,
			category: equation.category,
		});
	}

	/** Copies what the preview shows, symbol and all. */
	private async onCopyPng(): Promise<void> {
		const latex = this.currentLatex();
		if (latex.length === 0) {
			new Notice("Nothing to copy — the generator is empty.");
			return;
		}
		try {
			await copyLatexAsPng(this.rootEl.ownerDocument, joinSymbol(this.symbolInput.value, latex), "block");
			new Notice("Copied the equation as a PNG.");
		} catch (error) {
			new Notice(`Could not copy the equation as a PNG: ${String(error)}`);
		}
	}

	private async addCurrentEquation(): Promise<Equation | null> {
		const latex = this.currentLatex();
		if (latex.length === 0) {
			new Notice("Nothing to add — the generator is empty.");
			return null;
		}
		const name = this.nameInput.value.trim();
		if (name.length === 0) {
			new Notice("Give the equation a name before adding it.");
			this.nameInput.focus();
			return null;
		}
		if (this.busy) {
			new Notice("Still saving the last change.");
			return null;
		}
		// A second click on Add to Library, or re-adding an equation that is
		// already saved, must not make a copy: the existing one is loaded for
		// editing instead, and the caller may still insert it.
		const existing = findByLatex(this.catalog, latex);
		if (existing) {
			this.adoptEquation(existing);
			new Notice(`Already in the library as "${existing.name}".`);
			return existing;
		}
		const result = addEquation(this.catalog, {
			id: this.deps.mintId(),
			name,
			latex,
			category: this.generatorCategory,
			note: this.noteInput.value,
			symbol: this.symbolInput.value,
			now: this.deps.now(),
		});
		if (!result.ok) {
			new Notice(result.error);
			return null;
		}
		const pending = result.value.equations[result.value.equations.length - 1];
		const saved = await this.commit(result.value);
		if (saved === null) return null;
		// Storage assigned the real id; find the saved equation by its LaTeX.
		const added = findByLatex(saved, pending.latex) ?? pending;
		if (added.name !== name) new Notice(`Saved as "${added.name}" — that name was taken.`);
		this.adoptEquation(added);
		return added;
	}

	private async onAddToLibrary(): Promise<void> {
		const added = await this.addCurrentEquation();
		if (!added) return;
		this.deps.log({
			action: "add-to-library",
			latex: added.latex,
			name: added.name,
			category: added.category,
		});
	}

	private async onAddAndInsert(event: MouseEvent | KeyboardEvent | undefined): Promise<void> {
		const added = await this.addCurrentEquation();
		if (!added) return;
		if (!this.insertIntoEditor(added.latex, event)) return;
		this.deps.log({
			action: "add-and-insert",
			latex: added.latex,
			name: added.name,
			category: added.category,
		});
	}

	private async onUpdateEquation(): Promise<void> {
		const id = this.editingEquationId;
		if (!id) return;
		const latex = this.currentLatex();
		if (latex.length === 0) {
			new Notice("Nothing to save — the generator is empty.");
			return;
		}
		const name = this.nameInput.value.trim();
		if (name.length === 0) {
			new Notice("Give the equation a name before updating it.");
			this.nameInput.focus();
			return;
		}
		const result = updateEquation(
			this.catalog,
			id,
			{ name, latex, category: this.generatorCategory, note: this.noteInput.value, symbol: this.symbolInput.value },
			this.deps.now(),
		);
		if (!result.ok) {
			new Notice(result.error);
			return;
		}
		if ((await this.commit(result.value)) === null) return;
		new Notice(`Updated "${name}".`);
		this.deps.log({ action: "update-equation", latex, name, category: this.generatorCategory });
		this.editingEquationId = null;
		this.editingBaseline = null;
		this.updateButton?.buttonEl.hide();
		this.openNoteButton?.buttonEl.hide();
		this.refreshAddButton();
	}

	// ------------------------------------------------------------ catalogue

	private showTileMenu(equation: Equation, event: MouseEvent): void {
		event.preventDefault();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Open note")
				.setIcon("file-text")
				.onClick(() => void this.openEquationNote(equation.id)),
		);
		// The insert entries are offered for the note that is open right now, not
		// for whatever was open when the panel was.
		if (this.deps.getEditor() !== null) {
			menu.addItem((item) =>
				item
					.setTitle(equation.symbol ? "Insert with symbol" : "Insert")
					.setIcon("sigma")
					.onClick((evt) => this.onTileInsert(equation, evt as MouseEvent, true)),
			);
			menu.addItem((item) =>
				item
					.setTitle("Insert as link")
					.setIcon("link")
					.onClick(() => this.onTileInsertLink(equation)),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(() => this.promptRenameEquation(equation)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Move to category")
				.setIcon("folder")
				.onClick(() => this.promptMoveEquation(equation, event)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Duplicate")
				.setIcon("copy")
				.onClick(() => void this.duplicateEquation(equation)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash-2")
				.onClick(() => {
					const result = deleteEquation(this.catalog, equation.id);
					if (!result.ok) {
						new Notice(result.error);
						return;
					}
					void this.commit(result.value);
					new Notice(`Deleted "${equation.name}".`);
				}),
		);
		menu.showAtMouseEvent(event);
	}

	/**
	 * The modal had to close itself to get out of the way of the note it opened;
	 * the panel simply stays where it is, beside it.
	 */
	private async openEquationNote(id: string): Promise<void> {
		if (!(await this.deps.openNote(id))) new Notice("That note no longer exists.");
	}

	private async duplicateEquation(equation: Equation): Promise<void> {
		const result = addEquation(this.catalog, {
			id: this.deps.mintId(),
			name: equation.name,
			latex: equation.latex,
			category: equation.category,
			note: equation.note,
			symbol: equation.symbol,
			now: this.deps.now(),
		});
		if (!result.ok) {
			new Notice(result.error);
			return;
		}
		const added = result.value.equations[result.value.equations.length - 1];
		if ((await this.commit(result.value)) === null) return;
		new Notice(`Duplicated as "${added.name}".`);
		this.deps.log({
			action: "duplicate-equation",
			latex: added.latex,
			name: added.name,
			category: added.category,
		});
	}

	private promptRenameEquation(equation: Equation): void {
		new PromptModal(
			this.app,
			{ title: "Rename equation", initialValue: equation.name, cta: "Rename" },
			(value) => {
				const result = updateEquation(this.catalog, equation.id, { name: value }, this.deps.now());
				if (!result.ok) {
					new Notice(result.error);
					return;
				}
				void this.commit(result.value);
			},
		).open();
	}

	private promptMoveEquation(equation: Equation, event: MouseEvent): void {
		const menu = new Menu();
		for (const category of orderedCategories(this.catalog)) {
			menu.addItem((item) =>
				item
					.setTitle(category)
					.setChecked(category === equation.category)
					.onClick(() => {
						const result = updateEquation(this.catalog, equation.id, { category }, this.deps.now());
						if (!result.ok) {
							new Notice(result.error);
							return;
						}
						void this.commit(result.value);
					}),
			);
		}
		menu.showAtMouseEvent(event);
	}

	private promptNewCategory(): void {
		new PromptModal(
			this.app,
			{ title: "New category", placeholder: "Category name", cta: "Create" },
			(value) => {
				const result = addCategory(this.catalog, value);
				if (!result.ok) {
					new Notice(result.error);
					return;
				}
				void this.commit(result.value);
			},
		).open();
	}

	private promptRenameCategory(): void {
		const current = this.category;
		if (current === null || current === UNCATEGORIZED) {
			new Notice(`Pick a category other than "${UNCATEGORIZED}" to rename.`);
			return;
		}
		new PromptModal(
			this.app,
			{ title: `Rename "${current}"`, initialValue: current, cta: "Rename" },
			(value) => {
				const result = renameCategory(this.catalog, current, value);
				if (!result.ok) {
					new Notice(result.error);
					return;
				}
				this.category = value.trim();
				void this.deps.saveSettings({ lastCategory: this.category });
				void this.commit(result.value);
			},
		).open();
	}

	private confirmDeleteCategory(): void {
		const current = this.category;
		if (current === null || current === UNCATEGORIZED) {
			new Notice(`Pick a category other than "${UNCATEGORIZED}" to delete.`);
			return;
		}
		const result = deleteCategory(this.catalog, current);
		if (!result.ok) {
			new Notice(result.error);
			return;
		}
		const moved = this.catalog.equations.filter((e) => e.category === current).length;
		this.category = null;
		void this.deps.saveSettings({ lastCategory: null });
		void this.commit(result.value);
		new Notice(
			moved === 0
				? `Deleted "${current}".`
				: `Deleted "${current}" — ${moved} equation${moved === 1 ? "" : "s"} moved to ${UNCATEGORIZED}.`,
		);
	}
}

/**
 * The workspace leaf the library lives in — a sidebar panel, or a popout
 * window when the same view type is opened through `openPopoutLeaf`.
 */
export class EquationLibraryView extends ItemView {
	private renderer: LibraryRenderer | null = null;
	/** Set before `onOpen` when the view is opened on an equation. */
	private prefill: GeneratorPrefill | undefined;

	constructor(leaf: WorkspaceLeaf, private readonly deps: LibraryViewDeps) {
		super(leaf);
	}

	getViewType(): string {
		return LIBRARY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Equation Library";
	}

	getIcon(): string {
		return "sigma";
	}

	/** Whether the leaf was on screen last time the workspace changed shape. */
	private wasShown = false;

	async onOpen(): Promise<void> {
		this.renderer = new LibraryRenderer(this.app, this.deps);
		this.renderer.mount(this.contentEl);
		this.renderer.loadPrefill(this.prefill);
		this.prefill = undefined;
		this.wasShown = this.containerEl.isShown();

		// A panel in a collapsed sidebar or a background tab defers the reloads
		// it was told about; coming back into view is when it catches up. Both
		// events are needed: expanding the sidebar is a layout change, switching
		// between stacked tabs is an active-leaf change.
		const check = () => this.checkShown();
		this.registerEvent(this.app.workspace.on("layout-change", check));
		this.registerEvent(this.app.workspace.on("active-leaf-change", check));
	}

	private checkShown(): void {
		const shown = this.containerEl.isShown();
		const appeared = shown && !this.wasShown;
		this.wasShown = shown;
		if (appeared) this.renderer?.viewShown();
	}

	async onClose(): Promise<void> {
		this.renderer?.unmount();
		this.renderer = null;
	}

	/**
	 * Loads an equation into the generator, whether or not the view has been
	 * drawn yet: a leaf restored from the last session builds its UI later, and
	 * an already-open panel is reused rather than replaced.
	 */
	setPrefill(prefill: GeneratorPrefill | undefined): void {
		if (prefill === undefined) return;
		if (this.renderer) this.renderer.loadPrefill(prefill);
		else this.prefill = prefill;
	}
}
