/**
 * The settings panel: the autocomplete controls, the insert format, the log
 * cap, where the library notes live and which frontmatter keys they use, the
 * log viewer, and import/export.
 */
import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import type EquationLibraryPlugin from "../main";
import { DEFAULT_TRIGGER } from "../core/suggest";
import { LogCap } from "../core/log";
import { InsertFormat } from "../core/latex";
import { DEFAULT_FILE_PREFIX, DEFAULT_KEYS, DEFAULT_LIBRARY_FOLDER, FrontmatterKeys } from "../core/settings";

const GITHUB_URL = "https://github.com/jsglazer/equation-library";

export class EquationLibrarySettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: EquationLibraryPlugin) {
		super(app, plugin);
	}

	/**
	 * Commits a text setting on blur or Enter rather than per keystroke, so a
	 * half-typed path is never acted on.
	 */
	private commitOnBlur(text: TextComponent, commit: (value: string) => void): void {
		const run = () => commit(text.getValue());
		text.inputEl.addEventListener("blur", run);
		text.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") run();
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Library").setHeading();

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

		new Setting(containerEl).setName("Storage").setHeading();

		new Setting(containerEl)
			.setName("Library folder")
			.setDesc(
				`Vault folder whose notes make up the library. A note is an equation when its frontmatter has the LaTeX key; anything else in the folder is ignored. Default ${DEFAULT_LIBRARY_FOLDER}.`,
			)
			.addText((text) => {
				text.setPlaceholder(DEFAULT_LIBRARY_FOLDER).setValue(this.plugin.settings.libraryFolder);
				this.commitOnBlur(text, (value) => {
					const folder = value.trim();
					if (folder.length === 0 || folder === this.plugin.settings.libraryFolder) return;
					void this.plugin.updateSettings({ libraryFolder: folder }).then(() => {
						this.plugin.noteStore.invalidate();
						this.display();
					});
				});
			});

		new Setting(containerEl)
			.setName("Template note")
			.setDesc(
				"Optional. A note whose frontmatter keys and body are copied into every new equation note, so your own fields and boilerplate appear alongside the plugin's. Template tags such as <% … %> are blanked.",
			)
			.addText((text) => {
				text.setPlaceholder("Templates/equation.md").setValue(this.plugin.settings.templatePath);
				this.commitOnBlur(text, (value) => {
					if (value.trim() === this.plugin.settings.templatePath) return;
					void this.plugin.updateSettings({ templatePath: value.trim() });
				});
			});

		new Setting(containerEl)
			.setName("New note file name prefix")
			.setDesc(`Prepended to the equation's name to make the file name, so "Bayes Theorem" becomes ${DEFAULT_FILE_PREFIX}Bayes-Theorem.md. May be empty.`)
			.addText((text) => {
				text.setPlaceholder(DEFAULT_FILE_PREFIX).setValue(this.plugin.settings.filePrefix);
				this.commitOnBlur(text, (value) => {
					if (value.trim() === this.plugin.settings.filePrefix) return;
					void this.plugin.updateSettings({ filePrefix: value.trim() });
				});
			});

		new Setting(containerEl).setName("Frontmatter keys").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "The keys the plugin reads and writes in an equation note. Every other key, and the whole body, is left exactly as you wrote it. The name, LaTeX, symbol, category and note keys are written; usage and source are only read, for the filter and the search.",
		});

		const keyRows: Array<[keyof FrontmatterKeys, string, string]> = [
			["name", "Name", "The display name. Falls back to the file name."],
			["latex", "LaTeX", "The equation, stored $…$-wrapped so an inline Dataview field renders it."],
			["symbol", "Symbol", "The left-hand symbol, also $…$-wrapped. Tiles show it as symbol = equation."],
			["category", "Category", "Single-valued. Missing or blank means Uncategorized."],
			["note", "Note", "The free-text note shown in the generator."],
			["usage", "Usage", "List of tags. Read only, for the Usage filter."],
			["source", "Source", "Where it came from. Read only, for the search."],
		];
		for (const [field, label, desc] of keyRows) {
			new Setting(containerEl)
				.setName(label)
				.setDesc(`${desc} Default ${DEFAULT_KEYS[field]}.`)
				.addText((text) => {
					text.setPlaceholder(DEFAULT_KEYS[field]).setValue(this.plugin.settings.keys[field]);
					this.commitOnBlur(text, (value) => {
						const key = value.trim();
						if (key.length === 0 || key === this.plugin.settings.keys[field]) return;
						void this.plugin
							.updateSettings({ keys: { ...this.plugin.settings.keys, [field]: key } })
							.then(() => this.plugin.noteStore.invalidate());
					});
				});
		}

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

		new Setting(containerEl)
			.setName("Equation log")
			.setDesc(this.plugin.logStore.logPath)
			.addButton((button) => button.setButtonText("View log").onClick(() => void this.plugin.showLogFile()));

		new Setting(containerEl).setName("Import and export").setHeading();

		new Setting(containerEl)
			.setName("Export library")
			.setDesc("Write a JSON snapshot of every equation to a path in this vault.")
			.addButton((button) => button.setButtonText("Export").onClick(() => this.plugin.promptExport()));

		new Setting(containerEl)
			.setName("Import equations")
			.setDesc("Paste an exported catalog, including an equations.json from before version 1.1. Each equation becomes a note; LaTeX already in the library is skipped.")
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
