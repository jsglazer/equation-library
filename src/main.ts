/**
 * Equation Library — plugin entry point.
 *
 * This file wires Obsidian to the pure core: it owns the catalog in memory,
 * serializes every write through `PluginStore`, and registers the command, the
 * settings tab and the editor suggester. All decision logic lives under
 * `src/core/`; nothing here reads Node's `fs` or `path`.
 */
import { Editor, MarkdownFileInfo, MarkdownView, Menu, Notice, Plugin, Platform, TFile } from "obsidian";
import { Catalog, LogAction } from "./core/types";
import { CatalogLocation, DEFAULT_SETTINGS, EquationLibrarySettings, normalizeCatalogPath, normalizeSettings } from "./core/settings";
import { findMathSpanAt } from "./core/latex";
import { createLogEntry } from "./core/log";
import { serializeCatalog } from "./core/import-export";
import { PluginStore } from "./storage/plugin-store";
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
	store!: PluginStore;

	/** The catalog as last read from disk, re-read whenever the modal opens. */
	private catalog: Catalog | null = null;

	/**
	 * The most recent right-click, used to find the equation under the pointer.
	 *
	 * Chromium moves the caret to the click point before showing a context menu
	 * but WebKit does not, so the click coordinates are the reliable source and
	 * the caret is only the fallback.
	 */
	private lastContextMenu: MouseEvent | null = null;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.store = new PluginStore(this.app.vault.adapter, this.app.vault.configDir, this.manifest.id);
		this.store.setCatalogTarget({
			location: this.settings.catalogLocation,
			vaultPath: this.settings.catalogPath,
		});
		// An install that predates the vault-relative catalog still has its
		// equations under `.obsidian/plugins/`; lift them out so sync sees them.
		const migrated = await this.store.migrateCatalogToTarget();
		if (migrated !== null) new Notice(`Equation Library: moved the catalog to ${migrated} so it syncs with the vault.`);

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

		// A catalog kept in the vault is replaced wholesale by sync; re-read it so
		// the autocomplete does not keep serving the pre-sync list.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile) || file.path !== this.store.catalogPath) return;
				void this.reloadCatalog();
			}),
		);

		this.registerEditorSuggest(
			new EquationSuggest(this.app, {
				getSettings: () => this.settings,
				getEquations: () => this.catalog?.equations ?? [],
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

		// The suggester needs a catalog before the modal has ever been opened.
		void this.reloadCatalog();
	}

	onunload(): void {
		// Commands, the ribbon icon, the settings tab and the editor suggest are
		// all removed by Obsidian because they were registered through the Plugin
		// API. The one thing it does not know about is the MathLive stylesheet
		// this plugin injected into each open window.
		removeMathLiveStyles();
	}

	async updateSettings(patch: Partial<EquationLibrarySettings>): Promise<void> {
		this.settings = normalizeSettings({ ...this.settings, ...patch });
		// Settings live in data.json and go through saveData only; the vault
		// adapter never touches that file.
		await this.saveData(this.settings);
	}

	async recapLog(): Promise<void> {
		await this.store.recapLog(this.settings.logCap);
	}

	private async reloadCatalog(): Promise<Catalog> {
		const load = await this.store.loadCatalog();
		this.catalog = load.catalog;
		for (const warning of load.warnings) new Notice(`Equation Library: ${warning}`);
		return load.catalog;
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

	/** Repoints the catalog at a new location, carrying the equations across. */
	async moveCatalog(location: CatalogLocation, rawPath: string): Promise<void> {
		const catalogPath = normalizeCatalogPath(rawPath);
		const current = this.catalog ?? (await this.reloadCatalog());
		await this.updateSettings({ catalogLocation: location, catalogPath });
		this.store.setCatalogTarget({ location, vaultPath: catalogPath });
		await this.store.saveCatalog(current);
		new Notice(`Equation Library: catalog now at ${this.store.catalogPath}.`);
	}

	private openLibrary(prefill?: GeneratorPrefill): void {
		new LibraryModal(this.app, {
			prefill,
			version: this.manifest.version,
			getSettings: () => this.settings,
			saveSettings: (patch) => this.updateSettings(patch),
			// Re-read from disk on every open, so a catalog changed by Obsidian
			// Sync or by hand is picked up. Conflicts are last-write-wins.
			loadCatalog: () => this.reloadCatalog(),
			saveCatalog: async (catalog) => {
				this.catalog = catalog;
				await this.store.saveCatalog(catalog);
			},
			log: (request) => this.log(request),
			mintId: () => crypto.randomUUID(),
			now: () => new Date().toISOString(),
			isMobile: Platform.isMobile,
		}).open();
	}

	/** Queues one log entry. Fire-and-forget: a log failure never blocks an edit. */
	private log(request: LogRequest & { action: LogAction }): void {
		const entry = createLogEntry({ ...request, now: new Date().toISOString() });
		void this.store.appendLog(entry, this.settings.logCap).catch((error: unknown) => {
			new Notice(`Equation Library: could not write the log (${String(error)}).`);
		});
	}

	async showCatalogFile(): Promise<void> {
		const contents = await this.store.readCatalogText();
		new ViewFileModal(this.app, {
			title: "Equation library",
			path: this.store.catalogPath,
			contents,
			emptyMessage: "No equations have been saved yet, so this file does not exist.",
		}).open();
	}

	async showLogFile(): Promise<void> {
		const contents = await this.store.readLogText();
		new ViewFileModal(this.app, {
			title: "Equation log",
			path: this.store.logPath,
			contents,
			emptyMessage: "Nothing has been inserted or saved yet, so the log is empty.",
		}).open();
	}

	promptExport(): void {
		new PromptModal(
			this.app,
			{
				title: "Export catalog",
				placeholder: DEFAULT_EXPORT_PATH,
				initialValue: DEFAULT_EXPORT_PATH,
				cta: "Export",
				validate: (value) => (value.trim().length === 0 ? "Enter a path inside this vault." : null),
			},
			(value) => {
				void (async () => {
					const catalog = this.catalog ?? (await this.reloadCatalog());
					const path = await this.store.writeVaultFile(value.trim(), serializeCatalog(catalog));
					new Notice(`Exported ${catalog.equations.length} equations to ${path}.`);
				})();
			},
		).open();
	}

	async promptImport(): Promise<void> {
		const catalog = await this.reloadCatalog();
		new ImportModal(
			this.app,
			catalog,
			() => crypto.randomUUID(),
			(summary) => {
				void (async () => {
					this.catalog = summary.catalog;
					await this.store.saveCatalog(summary.catalog);
					for (const warning of summary.warnings) new Notice(`Equation Library: ${warning}`);
					new Notice(
						`Imported ${summary.added} equation${summary.added === 1 ? "" : "s"}` +
							(summary.renamed > 0 ? `, ${summary.renamed} renamed` : "") +
							(summary.skipped > 0 ? `, ${summary.skipped} already present` : "") +
							".",
					);
				})();
			},
		).open();
	}
}
