/**
 * The Equation Library popup: a grid of rendered equations on top, a live
 * generator underneath.
 *
 * All decision logic — search, sort, category filtering, catalog edits,
 * delimiter handling — lives in `src/core/`. This class reads the catalog,
 * draws it, and applies the results of those pure functions.
 */
import { App, ButtonComponent, Editor, EditorPosition, Menu, Modal, Notice, Platform, Setting } from "obsidian";
import { Catalog, Equation, LogAction, UNCATEGORIZED } from "../core/types";
import { EquationLibrarySettings } from "../core/settings";
import { InsertMode, isInsideMath, resolveInsertMode, stripDelimiters, wrapDelimiters } from "../core/latex";
import { SortOrder, searchEquations } from "../core/search";
import {
	addCategory,
	addEquation,
	deleteCategory,
	deleteEquation,
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
import { PromptModal } from "./prompt-modal";

export interface LogRequest {
	readonly action: LogAction;
	readonly latex: string;
	readonly name?: string;
	readonly category?: string;
}

/**
 * An equation the modal should open with already loaded in the generator.
 *
 * `range` is the span in the document the LaTeX came from: when it is present
 * an insert rewrites that span in place — editing an equation where it sits —
 * rather than adding a second copy at the cursor.
 */
export interface GeneratorPrefill {
	readonly latex: string;
	readonly mode: InsertMode;
	readonly range?: { readonly from: EditorPosition; readonly to: EditorPosition };
}

export interface LibraryModalDeps {
	readonly version: string;
	readonly getSettings: () => EquationLibrarySettings;
	readonly saveSettings: (patch: Partial<EquationLibrarySettings>) => Promise<void>;
	readonly loadCatalog: () => Promise<Catalog>;
	readonly saveCatalog: (catalog: Catalog) => Promise<void>;
	readonly log: (request: LogRequest) => void;
	readonly mintId: () => string;
	readonly now: () => string;
	readonly isMobile: boolean;
	/** Equation under the cursor, loaded into the generator on open. */
	readonly prefill?: GeneratorPrefill;
}

const ALL_CATEGORIES = "__all__";

export class LibraryModal extends Modal {
	private catalog: Catalog = { schemaVersion: 1, categories: [UNCATEGORIZED], equations: [] };
	private searchText = "";
	private category: string | null;
	private sort: SortOrder;

	/**
	 * The editor is resolved once, here, and held for the modal's lifetime: an
	 * open modal holds focus, so asking the workspace for the active editor at
	 * button-click time would find nothing.
	 */
	private readonly editor: Editor | null;

	private gridEl!: HTMLElement;
	private scrollEl!: HTMLElement;
	private observer: IntersectionObserver | null = null;
	private readonly pending = new Map<HTMLElement, Equation>();
	/** Rendered markup, cached for the modal's lifetime and keyed by content. */
	private readonly markupCache = new Map<string, string>();

	private mathField: MathFieldHandle | null = null;
	private latexInput!: HTMLTextAreaElement;
	private nameInput!: HTMLInputElement;
	private noteInput!: HTMLTextAreaElement;
	private generatorCategoryEl!: HTMLSelectElement;
	private generatorCategory = UNCATEGORIZED;
	private latex = "";
	private insertButtons: ButtonComponent[] = [];
	private updateButton: ButtonComponent | null = null;
	/** The equation the generator is editing, or null when building a fresh one. */
	private editingEquationId: string | null = null;
	/**
	 * The document span an insert should overwrite, taken from the prefill.
	 *
	 * Cleared after the first insert: the positions describe the document as it
	 * was when the modal opened, and rewriting the span invalidates them.
	 */
	private replaceRange: GeneratorPrefill["range"] | null = null;
	private replaceMode: InsertMode = "inline";

	constructor(app: App, private readonly deps: LibraryModalDeps) {
		super(app);
		const settings = deps.getSettings();
		this.category = settings.lastCategory;
		this.sort = settings.sortOrder;
		this.editor = app.workspace.activeEditor?.editor ?? null;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("eqlib-modal");
		contentEl.empty();
		contentEl.addClass("eqlib-content");

		this.buildToolbar(contentEl);
		this.scrollEl = contentEl.createDiv({ cls: "eqlib-grid-scroll" });
		this.gridEl = this.scrollEl.createDiv({ cls: "eqlib-grid" });
		this.buildGenerator(contentEl);
		this.buildFooter(contentEl);
		this.registerShortcuts(contentEl);
		this.focusLatexInput();

		const win = contentEl.win as Window & typeof globalThis;
		this.observer = new win.IntersectionObserver((entries) => this.onIntersect(entries), {
			root: this.scrollEl,
			rootMargin: "200px",
		});

		void this.refreshCatalog();
	}

	/**
	 * Puts the caret in the LaTeX source field, where typing belongs.
	 *
	 * Obsidian focuses the modal's first tabbable element — the search box —
	 * after `onOpen` returns, so focusing once here is undone a moment later.
	 * The deferred second call runs after that, and re-checks the field is
	 * still on screen in case the modal was closed in between.
	 */
	private focusLatexInput(): void {
		const focus = () => {
			if (!this.latexInput.isConnected) return;
			this.latexInput.focus();
			const end = this.latexInput.value.length;
			this.latexInput.setSelectionRange(end, end);
		};
		focus();
		const win = this.contentEl.win as Window & typeof globalThis;
		// Both deferrals fire inside the same frame; which one lands after
		// Obsidian's own focus call depends on the platform, so run both.
		win.setTimeout(focus, 0);
		win.requestAnimationFrame(focus);
	}

	/**
	 * Cmd/Ctrl+Return runs the primary action — Insert at cursor, or Replace in
	 * note when the modal was opened on an equation in the document — and
	 * Cmd/Ctrl+Shift+Return runs Add & Insert. They are bound on the modal
	 * content rather than per field so they fire from the LaTeX box, the name,
	 * the note or a focused button alike.
	 *
	 * Neither fires without an editor to insert into, which is the same
	 * condition that disables the two buttons.
	 */
	private registerShortcuts(contentEl: HTMLElement): void {
		contentEl.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
			if (this.editor === null) {
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

	onClose(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.pending.clear();
		this.mathField?.destroy();
		this.mathField = null;
		this.insertButtons = [];
		this.updateButton = null;
		hideVirtualKeyboard();
		this.contentEl.empty();
	}

	// ---------------------------------------------------------------- chrome

	private buildToolbar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "eqlib-toolbar" });

		const search = bar.createEl("input", { cls: "eqlib-search", type: "search" });
		search.placeholder = "Search equations";
		search.addEventListener("input", () => {
			this.searchText = search.value;
			this.renderGrid();
		});

		const categorySelect = bar.createEl("select", { cls: "dropdown eqlib-category-filter" });
		this.fillCategoryFilter(categorySelect);
		categorySelect.addEventListener("change", () => {
			this.category = categorySelect.value === ALL_CATEGORIES ? null : categorySelect.value;
			void this.deps.saveSettings({ lastCategory: this.category });
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

	private buildGenerator(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "eqlib-generator" });
		panel.createEl("h4", { text: "Generator", cls: "eqlib-panel-title" });

		const meta = panel.createDiv({ cls: "eqlib-generator-meta" });
		this.nameInput = meta.createEl("input", { cls: "eqlib-name", type: "text" });
		this.nameInput.placeholder = "Equation name";

		const categorySelect = meta.createEl("select", { cls: "dropdown eqlib-generator-category" });
		categorySelect.addEventListener("change", () => {
			this.generatorCategory = categorySelect.value;
		});
		this.generatorCategoryEl = categorySelect;

		this.noteInput = panel.createEl("textarea", { cls: "eqlib-note" });
		this.noteInput.placeholder = "Note (optional) — what this is for, where it came from";
		this.noteInput.rows = 2;

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
			this.mathField?.setLatex(this.latex);
		});

		const buttons = panel.createDiv({ cls: "eqlib-buttons" });
		this.insertButtons = [];

		const insertButton = new ButtonComponent(buttons)
			.setButtonText("Insert at cursor")
			.setTooltip(`Insert the equation into the note (${this.modifierLabel()}+Return).`)
			.setCta()
			.onClick((event) => this.onInsert(event));
		const addButton = new ButtonComponent(buttons)
			.setButtonText("Add to Library")
			.onClick(() => void this.onAddToLibrary());
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

		// "Add to Library" stays available with no editor open; the two insert
		// actions cannot work without one and say so.
		if (this.editor === null) {
			for (const button of this.insertButtons) {
				button.setDisabled(true);
				button.setTooltip("Open a markdown note to insert an equation.");
			}
		}
		addButton.setTooltip("Save this equation to the library.");

		this.applyPrefill();
	}

	/**
	 * Loads the equation the cursor was sitting in, if the caller found one.
	 *
	 * The name and category stay empty until `refreshCatalog` finds a library
	 * equation with the same LaTeX, which is what turns this into an edit of a
	 * saved equation rather than a fresh one.
	 */
	/** The modifier the platform actually uses, for tooltips. */
	private modifierLabel(): string {
		return Platform.isMacOS ? "Cmd" : "Ctrl";
	}

	private applyPrefill(): void {
		const prefill = this.deps.prefill;
		if (!prefill || prefill.latex.length === 0) return;
		this.latex = stripDelimiters(prefill.latex);
		this.latexInput.value = this.latex;
		this.mathField?.setLatex(this.latex);
		this.replaceRange = prefill.range ?? null;
		this.replaceMode = prefill.mode;
		// The primary action is no longer "add a copy at the cursor".
		if (this.replaceRange) {
			this.insertButtons[0]
				?.setButtonText("Replace in note")
				.setTooltip(`Rewrite the equation where it sits in the note (${this.modifierLabel()}+Return).`);
		}
	}

	private buildFooter(parent: HTMLElement): void {
		const footer = parent.createDiv({ cls: "eqlib-footer" });
		new Setting(footer)
			.setName("Close after inserting")
			.setClass("eqlib-close-setting")
			.addToggle((toggle) =>
				toggle.setValue(this.deps.getSettings().closeOnInsert).onChange((value) => {
					void this.deps.saveSettings({ closeOnInsert: value });
				}),
			);
		footer.createDiv({ cls: "eqlib-version", text: `v${this.deps.version}` });
	}

	// ----------------------------------------------------------------- data

	private async refreshCatalog(): Promise<void> {
		this.catalog = await this.deps.loadCatalog();
		this.syncCategorySelectors();
		this.adoptPrefilledEquation();
		this.renderGrid();
	}

	/**
	 * If the prefilled LaTeX is already in the library, adopt that equation's
	 * name, category and identity so Update saves back to it.
	 */
	private adoptPrefilledEquation(): void {
		if (this.editingEquationId !== null || this.latex.length === 0) return;
		if (this.deps.prefill === undefined) return;
		const match = this.catalog.equations.find((equation) => equation.latex === this.latex);
		if (!match) return;
		this.nameInput.value = match.name;
		this.noteInput.value = match.note ?? "";
		this.generatorCategory = match.category;
		this.generatorCategoryEl.value = match.category;
		this.editingEquationId = match.id;
		this.updateButton?.buttonEl.show();
	}

	private syncCategorySelectors(): void {
		const filter = this.contentEl.querySelector<HTMLSelectElement>(".eqlib-category-filter");
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

	private async commit(catalog: Catalog): Promise<void> {
		this.catalog = catalog;
		await this.deps.saveCatalog(catalog);
		this.syncCategorySelectors();
		this.renderGrid();
	}

	// ----------------------------------------------------------------- grid

	private renderGrid(): void {
		this.observer?.disconnect();
		this.pending.clear();
		this.gridEl.empty();

		const results = searchEquations(this.catalog.equations, {
			text: this.searchText,
			category: this.category,
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
		const key = `${equation.id}:${equation.latex}`;
		const cached = this.markupCache.get(key);
		if (cached !== undefined) {
			body.innerHTML = cached;
			return;
		}
		renderLatexInto(body, equation.latex, "inline");
		this.markupCache.set(key, body.innerHTML);
	}

	// -------------------------------------------------------------- actions

	private loadIntoGenerator(equation: Equation): void {
		this.latex = equation.latex;
		this.latexInput.value = equation.latex;
		this.mathField?.setLatex(equation.latex);
		this.nameInput.value = equation.name;
		this.noteInput.value = equation.note ?? "";
		this.generatorCategory = equation.category;
		this.generatorCategoryEl.value = equation.category;
		this.editingEquationId = equation.id;
		this.updateButton?.buttonEl.show();
	}

	private currentLatex(): string {
		return stripDelimiters(this.latex.length > 0 ? this.latex : this.latexInput.value);
	}

	private insertMode(event: MouseEvent | KeyboardEvent | undefined): InsertMode {
		return resolveInsertMode(this.deps.getSettings().insertFormat, event?.shiftKey === true);
	}

	/**
	 * Inserting inside a `$...$` or `$$...$$` span already open at the cursor
	 * drops the delimiters — adding another pair would either break the
	 * existing equation or start a nested one.
	 */
	private insertIntoEditor(latex: string, event: MouseEvent | KeyboardEvent | undefined): boolean {
		if (!this.editor) {
			new Notice("Open a markdown note first — there is nowhere to insert.");
			return false;
		}
		// An equation opened from the document is rewritten where it sits, in the
		// delimiters it already had; the positions are good for one insert only.
		const range = this.replaceRange;
		if (range) {
			this.replaceRange = null;
			this.editor.replaceRange(wrapDelimiters(latex, this.replaceMode), range.from, range.to);
			this.editor.setCursor(range.from);
			return true;
		}
		const textBeforeCursor = this.editor.getRange({ line: 0, ch: 0 }, this.editor.getCursor());
		const insertText = isInsideMath(textBeforeCursor)
			? stripDelimiters(latex)
			: wrapDelimiters(latex, this.insertMode(event));
		this.editor.replaceSelection(insertText);
		return true;
	}

	private finishInsert(): void {
		if (this.deps.getSettings().closeOnInsert) this.close();
	}

	private onInsert(event: MouseEvent | KeyboardEvent | undefined): void {
		const latex = this.currentLatex();
		if (latex.length === 0) {
			new Notice("Nothing to insert — the generator is empty.");
			return;
		}
		if (!this.insertIntoEditor(latex, event)) return;
		this.deps.log({ action: "insert-at-cursor", latex });
		this.finishInsert();
	}

	private onTileInsert(equation: Equation, event: MouseEvent): void {
		if (!this.insertIntoEditor(equation.latex, event)) return;
		this.deps.log({
			action: "insert-at-cursor",
			latex: equation.latex,
			name: equation.name,
			category: equation.category,
		});
		this.finishInsert();
	}

	private async onCopyPng(): Promise<void> {
		const latex = this.currentLatex();
		if (latex.length === 0) {
			new Notice("Nothing to copy — the generator is empty.");
			return;
		}
		try {
			await copyLatexAsPng(this.contentEl.ownerDocument, latex, "block");
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
		const result = addEquation(this.catalog, {
			id: this.deps.mintId(),
			name,
			latex,
			category: this.generatorCategory,
			note: this.noteInput.value,
			now: this.deps.now(),
		});
		if (!result.ok) {
			new Notice(result.error);
			return null;
		}
		const added = result.value.equations[result.value.equations.length - 1];
		await this.commit(result.value);
		if (added.name !== name) new Notice(`Saved as "${added.name}" — that name was taken.`);
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
		this.finishInsert();
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
			{ name, latex, category: this.generatorCategory, note: this.noteInput.value },
			this.deps.now(),
		);
		if (!result.ok) {
			new Notice(result.error);
			return;
		}
		await this.commit(result.value);
		new Notice(`Updated "${name}".`);
		this.deps.log({ action: "update-equation", latex, name, category: this.generatorCategory });
		this.editingEquationId = null;
		this.updateButton?.buttonEl.hide();
	}

	// ------------------------------------------------------------ catalogue

	private showTileMenu(equation: Equation, event: MouseEvent): void {
		event.preventDefault();
		const menu = new Menu();
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
