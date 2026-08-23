/**
 * Equation Library — plugin entry point.
 *
 * This file wires Obsidian to the pure core: it owns the catalog in memory,
 * serializes every write through `PluginStore`, and registers the command, the
 * settings tab and the editor suggester. All decision logic lives under
 * `src/core/`; nothing here reads Node's `fs` or `path`.
 */
import { Notice, Plugin, Platform } from "obsidian";
import { Catalog, LogAction } from "./core/types";
import { DEFAULT_SETTINGS, EquationLibrarySettings, normalizeSettings } from "./core/settings";
import { createLogEntry } from "./core/log";
import { serializeCatalog } from "./core/import-export";
import { PluginStore } from "./storage/plugin-store";
import { EquationSuggest } from "./editor/equation-suggest";
import { LibraryModal, LogRequest } from "./ui/library-modal";
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

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.store = new PluginStore(this.app.vault.adapter, this.app.vault.configDir, this.manifest.id);

		configureMathLive({ virtualKeyboard: Platform.isMobile });

		this.addCommand({
			id: "show-equation-library",
			name: "Show Equation Library",
			callback: () => this.openLibrary(),
		});

		this.addRibbonIcon("sigma", "Show Equation Library", () => this.openLibrary());

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

	private openLibrary(): void {
		new LibraryModal(this.app, {
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
