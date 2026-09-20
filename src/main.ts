/**
 * Equation Library — plugin entry point.
 *
 * This file wires Obsidian to the pure core: it owns the note store that reads
 * and writes the library folder, the log store, and registers the command,
 * the settings tab and the editor suggester. All decision logic lives under
 * `src/core/`; nothing here reads Node's `fs` or `path`.
 */
import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	Platform,
	TAbstractFile,
	WorkspaceLeaf,
} from "obsidian";
import { Catalog, LogAction } from "./core/types";
import { DEFAULT_SETTINGS, EquationLibrarySettings, normalizeSettings } from "./core/settings";
import { findMathSpanAt } from "./core/latex";
import { createLogEntry } from "./core/log";
import { planImport, serializeCatalog } from "./core/import-export";
import { LogStore } from "./storage/log-store";
import { NoteStore } from "./storage/note-store";
import { EquationSuggest } from "./editor/equation-suggest";
import {
	EquationLibraryView,
	GeneratorPrefill,
	LIBRARY_VIEW_TYPE,
	LibraryViewDeps,
	LogRequest,
} from "./ui/library-view";
import { EditorTracker } from "./ui/editor-tracker";
import { ViewFileModal } from "./ui/view-file-modal";
import { PromptModal } from "./ui/prompt-modal";
import { ImportModal } from "./ui/import-modal";
import { EquationLibrarySettingTab } from "./ui/settings-tab";
import { configureMathLive, removeMathLiveStyles } from "./ui/mathlive-adapter";

const DEFAULT_EXPORT_PATH = "equation-library-export.json";

export default class EquationLibraryPlugin extends Plugin {
	settings: EquationLibrarySettings = DEFAULT_SETTINGS;
	noteStore!: NoteStore;
	logStore!: LogStore;

	/**
	 * The most recent right-click, used to find the equation under the pointer.
	 *
	 * Chromium moves the caret to the click point before showing a context menu
	 * but WebKit does not, so the click coordinates are the reliable source and
	 * the caret is only the fallback.
	 */
	private lastContextMenu: MouseEvent | null = null;

	/** The note the panel inserts into, resolved fresh on every insert. */
	private editors!: EditorTracker;

	async onload(): Promise<void> {
		const raw: unknown = await this.loadData();
		this.settings = normalizeSettings(raw);
		this.logStore = new LogStore(this.app.vault.adapter, this.app.vault.configDir, this.manifest.id);
		this.noteStore = new NoteStore(this.app, {
			getSettings: () => this.settings,
			saveCategories: (categories) => this.updateSettings({ categories }),
		});
		this.noticeLegacyCatalog(raw);

		configureMathLive({ virtualKeyboard: Platform.isMobile });

		// The panel is not modal, so focus genuinely moves between it and the
		// note; a leaf showing the library must never be mistaken for the note to
		// insert into.
		this.editors = new EditorTracker(this.app, (leaf) => leaf.view instanceof EquationLibraryView);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => this.editors.handleActiveLeafChange(leaf)),
		);
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.editors.handleFileOpen(file)));

		this.registerView(LIBRARY_VIEW_TYPE, (leaf) => new EquationLibraryView(leaf, this.viewDeps()));

		this.addCommand({
			id: "show-equation-library",
			name: "Show Equation Library",
			// Opening from inside an equation loads that equation, so the command
			// doubles as "edit this equation".
			callback: () => void this.openLibrary(this.prefillFromActiveEditor()),
		});

		this.addCommand({
			id: "show-equation-library-window",
			name: "Show Equation Library in a new window",
			callback: () => void this.openLibrary(this.prefillFromActiveEditor(), true),
		});

		this.addRibbonIcon("sigma", "Show Equation Library", () => void this.openLibrary());

		this.registerDomEvent(document, "contextmenu", (event) => {
			this.lastContextMenu = event;
		}, { capture: true });

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				const prefill = this.prefillFromEditor(editor, info.file?.path ?? null, this.lastContextMenu);
				if (prefill === undefined) return;
				menu.addItem((item) =>
					item
						.setTitle("Edit equation in Equation Library")
						.setIcon("sigma")
						.onClick(() => void this.openLibrary(prefill)),
				);
			}),
		);

		// The library is whatever the notes say right now. Any change under the
		// folder — an edit, a sync, a rename, a deletion — drops the cached
		// listing so the autocomplete never serves a stale one.
		const touched = (file: TAbstractFile, oldPath?: string) => {
			if (this.noteStore.isLibraryPath(file.path) || (oldPath !== undefined && this.noteStore.isLibraryPath(oldPath))) {
				this.noteStore.invalidate();
			}
		};
		this.registerEvent(this.app.metadataCache.on("changed", (file) => touched(file)));
		this.registerEvent(this.app.metadataCache.on("deleted", (file) => touched(file)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => touched(file, oldPath)));
		this.registerEvent(this.app.vault.on("create", (file) => touched(file)));

		this.registerEditorSuggest(
			new EquationSuggest(this.app, {
				getSettings: () => this.settings,
				getEquations: () => this.noteStore.listEquations(),
				onAccept: (equation) => {
					this.log({
						action: "autocomplete-accept",
						latex: equation.latex,
						name: equation.name,
						category: equation.category,
					});
				},
			}),
		);

		this.addSettingTab(new EquationLibrarySettingTab(this.app, this));

		// The tracker needs the note that is already open at startup; it does not
		// wait for the first leaf change.
		this.app.workspace.onLayoutReady(() => this.editors.syncFromWorkspace());
	}

	onunload(): void {
		// Commands, the ribbon icon, the settings tab and the editor suggest are
		// all removed by Obsidian because they were registered through the Plugin
		// API. Two things it does not know about: the MathLive stylesheet this
		// plugin injected into each open window, and the panels still on screen,
		// whose view type is about to stop existing.
		this.editors.dispose();
		for (const leaf of this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE)) leaf.detach();
		removeMathLiveStyles();
	}

	/**
	 * An install upgraded from 1.0.x still has its `equations.json`. It is not
	 * read any more; the user is told once where the import lives, and the old
	 * settings keys are dropped on the next save.
	 */
	private noticeLegacyCatalog(raw: unknown): void {
		if (typeof raw !== "object" || raw === null) return;
		const record = raw as Record<string, unknown>;
		if (!("catalogPath" in record) && !("catalogLocation" in record)) return;
		const path = typeof record.catalogPath === "string" ? record.catalogPath : "equations.json";
		new Notice(
			`Equation Library now keeps equations as notes in "${this.settings.libraryFolder}". Your old ${path} is no longer read — paste it into Settings → Import to turn it into notes.`,
			15000,
		);
		void this.saveData(this.settings);
	}

	async updateSettings(patch: Partial<EquationLibrarySettings>): Promise<void> {
		this.settings = normalizeSettings({ ...this.settings, ...patch });
		// Settings live in data.json and go through saveData only; the vault
		// adapter never touches that file.
		await this.saveData(this.settings);
	}

	async recapLog(): Promise<void> {
		await this.logStore.recapLog(this.settings.logCap);
	}

	/**
	 * The equation the cursor sits in, ready to load into the generator.
	 *
	 * The whole document is scanned rather than just the current line, because a
	 * `$$…$$` block spans lines and a fenced code block above the cursor changes
	 * what counts as math below it.
	 */
	private prefillFromEditor(
		editor: Editor | null,
		filePath: string | null,
		event: MouseEvent | null = null,
	): GeneratorPrefill | undefined {
		if (!editor) return undefined;
		const span = findMathSpanAt(editor.getValue(), this.offsetAt(editor, event));
		if (span === null) return undefined;
		return {
			latex: span.latex,
			mode: span.mode,
			range: { from: editor.offsetToPos(span.start), to: editor.offsetToPos(span.end) },
			// The panel stays open across note switches, so an edit-in-place has to
			// remember which note its coordinates belong to.
			filePath: filePath ?? undefined,
		};
	}

	/** The equation under the caret in the note that has focus right now. */
	private prefillFromActiveEditor(): GeneratorPrefill | undefined {
		const active = this.app.workspace.activeEditor;
		return this.prefillFromEditor(active?.editor ?? null, active?.file?.path ?? null);
	}

	/** The document offset a click landed on, falling back to the caret. */
	private offsetAt(editor: Editor, event: MouseEvent | null): number {
		const view = (editor as unknown as {
			cm?: { posAtCoords?: (coords: { x: number; y: number }) => number | null };
		}).cm;
		if (event && view?.posAtCoords) {
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (typeof pos === "number") return pos;
		}
		return editor.posToOffset(editor.getCursor());
	}

	private viewDeps(): LibraryViewDeps {
		return {
			version: this.manifest.version,
			getSettings: () => this.settings,
			saveSettings: (patch) => this.updateSettings(patch),
			// Re-read from the notes on every open, so a note changed by hand or
			// by sync is picked up. Conflicts are last-write-wins.
			loadCatalog: () => this.noteStore.loadCatalog(),
			saveCatalog: (previous, next) => this.noteStore.applyCatalog(previous, next),
			openNote: (id) => this.noteStore.openNote(id, false),
			// Resolved per link, not per open: a link is relative to the note it is
			// being written into, and with a panel that note changes underneath.
			linkFor: (id) => this.noteStore.linkFor(id, this.editors.resolve()?.filePath ?? ""),
			log: (request) => this.log(request),
			mintId: () => `new:${crypto.randomUUID()}`,
			now: () => new Date().toISOString(),
			isMobile: Platform.isMobile,
			getEditor: () => this.editors.resolve(),
			onEditorChange: (listener) => this.editors.subscribe(listener),
		};
	}

	/**
	 * Shows the library panel, reusing the one already open rather than stacking
	 * a second copy, and loads `prefill` into it either way.
	 *
	 * The panel is revealed but never focused: the user asked for the library
	 * while typing in a note, and taking the caret out of that note is exactly
	 * what the move away from a modal was meant to stop. A popout is the one
	 * exception — a window the user just asked for should come to the front.
	 */
	private async openLibrary(prefill?: GeneratorPrefill, popout = false): Promise<void> {
		const leaf = popout ? this.app.workspace.openPopoutLeaf() : this.libraryLeaf();
		// Re-running `setViewState` on a leaf that already holds the library would
		// rebuild the view and throw away whatever is half-typed in the generator.
		if (!(leaf.view instanceof EquationLibraryView)) {
			await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: popout });
		}
		if (!popout) this.app.workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof EquationLibraryView) view.setPrefill(prefill);
	}

	/** The open library panel, or a fresh leaf in the right sidebar. */
	private libraryLeaf(): WorkspaceLeaf {
		const open = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
		if (open.length > 0) return open[0];
		return this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
	}

	/** Queues one log entry. Fire-and-forget: a log failure never blocks an edit. */
	private log(request: LogRequest & { action: LogAction }): void {
		const entry = createLogEntry({ ...request, now: new Date().toISOString() });
		void this.logStore.appendLog(entry, this.settings.logCap).catch((error: unknown) => {
			new Notice(`Equation Library: could not write the log (${String(error)}).`);
		});
	}

	async showLogFile(): Promise<void> {
		const contents = await this.logStore.readLogText();
		new ViewFileModal(this.app, {
			title: "Equation log",
			path: this.logStore.logPath,
			contents,
			emptyMessage: "Nothing has been inserted or saved yet, so the log is empty.",
		}).open();
	}

	promptExport(): void {
		new PromptModal(
			this.app,
			{
				title: "Export library",
				placeholder: DEFAULT_EXPORT_PATH,
				initialValue: DEFAULT_EXPORT_PATH,
				cta: "Export",
				validate: (value) => (value.trim().length === 0 ? "Enter a path inside this vault." : null),
			},
			(value) => {
				void (async () => {
					const catalog: Catalog = await this.noteStore.loadCatalog();
					const path = await this.logStore.writeVaultFile(value.trim(), serializeCatalog(catalog));
					new Notice(`Exported ${catalog.equations.length} equations to ${path}.`);
				})();
			},
		).open();
	}

	async promptImport(): Promise<void> {
		new ImportModal(this.app, (parsed) => {
			void (async () => {
				const existing = await this.noteStore.loadCatalog();
				const plan = planImport(existing, parsed.catalog);
				const created = await this.noteStore.createNotes(plan.toCreate);
				for (const warning of parsed.warnings) new Notice(`Equation Library: ${warning}`);
				new Notice(
					`Imported ${created} equation${created === 1 ? "" : "s"} as notes` +
						(plan.skipped.length > 0 ? `, ${plan.skipped.length} already in the library` : "") +
						".",
				);
			})();
		}).open();
	}
}
