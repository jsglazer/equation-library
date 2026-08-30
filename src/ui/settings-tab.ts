/**
 * The settings panel: the autocomplete controls, the insert format, the log
 * cap, links to the plugin's own data files, and import/export.
 */
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type EquationLibraryPlugin from "../main";
import { DEFAULT_TRIGGER } from "../core/suggest";
import { LogCap } from "../core/log";
import { InsertFormat } from "../core/latex";
import { CatalogLocation, DEFAULT_CATALOG_PATH } from "../core/settings";

const GITHUB_URL = "https://github.com/jsglazer/equation-library";

export class EquationLibrarySettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: EquationLibraryPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Library").setHeading();

		new Setting(containerEl)
			.setName("Close after inserting")
			.setDesc("Close the library popup once an equation has been inserted.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.closeOnInsert)
					.onChange((value) => void this.plugin.updateSettings({ closeOnInsert: value })),
			);

		new Setting(containerEl)
			.setName("Insert format")
			.setDesc("Which delimiters an unmodified insert uses. Holding shift always inserts a block equation.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ inline: "Inline — $…$", "always-block": "Always block — $$…$$" })
					.setValue(this.plugin.settings.insertFormat)
					.onChange((value) => void this.plugin.updateSettings({ insertFormat: value as InsertFormat })),
			);

		new Setting(containerEl).setName("Editor autocomplete").setHeading();

		new Setting(containerEl)
			.setName("Enable autocomplete")
			.setDesc("Suggest library equations in the editor. Always off on phones, where the popup fights the on-screen keyboard.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.suggestEnabled)
					.onChange((value) => void this.plugin.updateSettings({ suggestEnabled: value })),
			);

		new Setting(containerEl)
			.setName("Trigger")
			.setDesc(`The characters that open the suggester. Default ${DEFAULT_TRIGGER}. A single $ is never a trigger, so ordinary math typing is untouched.`)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_TRIGGER)
					.setValue(this.plugin.settings.suggestTrigger)
					.onChange((value) => {
						const trigger = value.trim();
						if (trigger.length === 0) return;
						void this.plugin.updateSettings({ suggestTrigger: trigger });
					}),
			);

		new Setting(containerEl).setName("Log").setHeading();

		new Setting(containerEl)
			.setName("Log size limit")
			.setDesc("Entries kept in the log file. The oldest are dropped first; a smaller limit keeps mobile memory use low.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ "100": "100 entries", "500": "500 entries", "1000": "1000 entries", off: "No limit" })
					.setValue(String(this.plugin.settings.logCap))
					.onChange((value) => {
						const cap: LogCap = value === "off" ? "off" : (Number(value) as LogCap);
						void this.plugin.updateSettings({ logCap: cap }).then(() => this.plugin.recapLog());
					}),
			);

		new Setting(containerEl).setName("Storage").setHeading();

		new Setting(containerEl)
			.setName("Catalog location")
			.setDesc(
				"Where equations.json is kept. A file inside the vault is replicated by Obsidian Sync, iCloud and Dropbox alike; " +
					"the plugin folder is not, which is why the same vault can show a different library on two machines. " +
					"Switching copies the current equations to the new location.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						vault: "In the vault — syncs between machines",
						plugin: "Plugin folder — this machine only",
					})
					.setValue(this.plugin.settings.catalogLocation)
					.onChange((value) => {
						void this.plugin
							.moveCatalog(value as CatalogLocation, this.plugin.settings.catalogPath)
							.then(() => this.display());
					}),
			);

		new Setting(containerEl)
			.setName("Catalog path")
			.setDesc(`Vault-relative path used when the catalog lives in the vault. Default ${DEFAULT_CATALOG_PATH}.`)
			.addText((text) => {
				text.setPlaceholder(DEFAULT_CATALOG_PATH).setValue(this.plugin.settings.catalogPath);
				text.inputEl.disabled = this.plugin.settings.catalogLocation !== "vault";
				// Committed on blur or Enter rather than per keystroke: every
				// intermediate path would otherwise get a file of its own.
				const commit = () => {
					const value = text.getValue().trim();
					if (value.length === 0 || value === this.plugin.settings.catalogPath) return;
					void this.plugin.moveCatalog("vault", value).then(() => this.display());
				};
				text.inputEl.addEventListener("blur", commit);
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") commit();
				});
				return text;
			});

		new Setting(containerEl).setName("Files").setHeading();

		new Setting(containerEl)
			.setName("Equation library")
			.setDesc(this.plugin.store.catalogPath)
			.addButton((button) => button.setButtonText("View JSON").onClick(() => void this.plugin.showCatalogFile()));

		new Setting(containerEl)
			.setName("Equation log")
			.setDesc(this.plugin.store.logPath)
			.addButton((button) => button.setButtonText("View log").onClick(() => void this.plugin.showLogFile()));

		new Setting(containerEl)
			.setName("Export catalog")
			.setDesc("Write a copy of the catalog to a path in this vault.")
			.addButton((button) => button.setButtonText("Export").onClick(() => this.plugin.promptExport()));

		new Setting(containerEl)
			.setName("Import catalog")
			.setDesc("Paste an exported catalog. Existing equations are never overwritten.")
			.addButton((button) => button.setButtonText("Import").onClick(() => void this.plugin.promptImport()));

		new Setting(containerEl).setName("About").setHeading();

		new Setting(containerEl)
			.setName("Equation Library")
			.setDesc(`Version ${this.plugin.manifest.version}`)
			.addButton((button) =>
				button
					.setButtonText("GitHub")
					.setTooltip(GITHUB_URL)
					.onClick(() => {
						window.open(GITHUB_URL, "_blank");
						new Notice("Opened the plugin page in your browser.");
					}),
			);
	}
}
