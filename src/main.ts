/**
 * Equation Library — plugin entry point.
 *
 * This file wires Obsidian to the pure core: it owns the note store that reads
 * and writes the library folder, the log store, and registers the command,
 * the settings tab and the editor suggester. All decision logic lives under
 * `src/core/`; nothing here reads Node's `fs` or `path`.
 */
import { Editor, MarkdownFileInfo, MarkdownView, Menu, Notice, Plugin, Platform, TAbstractFile } from "obsidian";
import { Catalog, LogAction } from "./core/types";
import { DEFAULT_SETTINGS, EquationLibrarySettings, normalizeSettings } from "./core/settings";
import { findMathSpanAt } from "./core/latex";
import { createLogEntry } from "./core/log";
import { planImport, serializeCatalog } from "./core/import-export";
import { LogStore } from "./storage/log-store";
import { NoteStore } from "./storage/note-store";
import { EquationSuggest } from "./editor/equation-suggest";
import { GeneratorPrefill, LibraryModal, LogRequest } from "./ui/library-modal";
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

		this.addCommand({
			id: "show-equation-library",
			name: "Show Equation Library",
			// Opening from inside an equation loads that equation, so the command
			// doubles as "edit this equation".
			callback: () => this.openLibrary(this.prefillFromEditor(this.app.workspace.activeEditor?.editor ?? null)),
		});

		this.addRibbonIcon("sigma", "Show Equation Library", () => this.openLibrary());

		this.registerDomEvent(document, "contextmenu", (event) => {
			this.lastContextMenu = event;
		}, { capture: true });

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				void info;
				const prefill = this.prefillFromEditor(editor, this.lastContextMenu);
				if (prefill === undefined) return;
				menu.addItem((item) =>
					item
						.setTitle("Edit equation in Equation Library")
						.setIcon("sigma")
						.onClick(() => this.openLibrary(prefill)),
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
	}

	onunload(): void {
		// Commands, the ribbon icon, the settings tab and the editor suggest are
		// all removed by Obsidian because they were registered through the Plugin
		// API. The one thing it does not know about is the MathLive stylesheet
		// this plugin injected into each open window.
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
	private prefillFromEditor(editor: Editor | null, event: MouseEvent | null = null): GeneratorPrefill | undefined {
		if (!editor) return undefined;
		const span = findMathSpanAt(editor.getValue(), this.offsetAt(editor, event));
		if (span === null) return undefined;
		return {
			latex: span.latex,
			mode: span.mode,
			range: { from: editor.offsetToPos(span.start), to: editor.offsetToPos(span.end) },
		};
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

	private openLibrary(prefill?: GeneratorPrefill): void {
		const fromPath = this.app.workspace.getActiveFile()?.path ?? "";
		new LibraryModal(this.app, {
			prefill,
			version: this.manifest.version,
			getSettings: () => this.settings,
			saveSettings: (patch) => this.updateSettings(patch),
			// Re-read from the notes on every open, so a note changed by hand or
			// by sync is picked up. Conflicts are last-write-wins.
			loadCatalog: () => this.noteStore.loadCatalog(),
			saveCatalog: (previous, next) => this.noteStore.applyCatalog(previous, next),
			openNote: (id) => this.noteStore.openNote(id, false),
			linkFor: (id) => this.noteStore.linkFor(id, fromPath),
			log: (request) => this.log(request),
			mintId: () => `new:${crypto.randomUUID()}`,
			now: () => new Date().toISOString(),
			isMobile: Platform.isMobile,
		}).open();
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
