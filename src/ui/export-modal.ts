/**
 * Export dialog: what to export (the whole library or one category) and in
 * which format. The format starts at the one chosen in settings; choosing a
 * different one here applies to this export only. Where the file goes is the
 * caller's job — it asks for a save location once this dialog is confirmed.
 */
import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { Catalog } from "../core/types";
import { categoryCounts, orderedCategories } from "../core/catalog";
import { EXPORT_FORMAT_LABELS, ExportFormat } from "../core/export";

const ALL = "__all__";

export interface ExportChoice {
	/** The category to export, or null for every equation. */
	readonly category: string | null;
	readonly format: ExportFormat;
}

export interface ExportModalOptions {
	readonly catalog: Catalog;
	readonly format: ExportFormat;
	/** Category selected when the dialog opens; null selects All. */
	readonly category: string | null;
}

export class ExportModal extends Modal {
	private category: string | null;
	private format: ExportFormat;

	constructor(
		app: App,
		private readonly options: ExportModalOptions,
		private readonly onChoose: (choice: ExportChoice) => void,
	) {
		super(app);
		this.format = options.format;
		const known = orderedCategories(options.catalog);
		this.category = options.category !== null && known.includes(options.category) ? options.category : null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Export equations" });

		const { catalog } = this.options;
		const counts = categoryCounts(catalog);
		let exportButton: ButtonComponent | undefined;
		const summary = contentEl.createEl("p", { cls: "setting-item-description" });
		const syncSummary = (): void => {
			const count = this.category === null ? catalog.equations.length : (counts[this.category] ?? 0);
			summary.setText(`${count} equation${count === 1 ? "" : "s"} will be exported.`);
			exportButton?.setDisabled(count === 0);
		};

		new Setting(contentEl)
			.setName("Equations")
			.setDesc("Export the whole library, or only one category.")
			.addDropdown((dropdown) => {
				dropdown.addOption(ALL, `All (${catalog.equations.length})`);
				for (const category of orderedCategories(catalog)) {
					dropdown.addOption(category, `${category} (${counts[category] ?? 0})`);
				}
				dropdown.setValue(this.category ?? ALL).onChange((value) => {
					this.category = value === ALL ? null : value;
					syncSummary();
				});
			});

		new Setting(contentEl)
			.setName("Format")
			.setDesc("The default is set in Settings → Equation Library → Import and export.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(EXPORT_FORMAT_LABELS)
					.setValue(this.format)
					.onChange((value) => {
						this.format = value as ExportFormat;
					}),
			);

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => {
				exportButton = button;
				button
					.setButtonText("Choose location…")
					.setCta()
					.onClick(() => {
						this.close();
						this.onChoose({ category: this.category, format: this.format });
					});
			});
		syncSummary();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
