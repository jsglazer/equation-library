/**
 * Import: paste a catalog JSON blob, validate it, merge it into the current
 * catalog. Validation runs in the pure core (`parseCatalog`), which returns a
 * result object carrying errors rather than throwing, so a bad paste produces a
 * message instead of an exception.
 */
import { App, Modal, Setting } from "obsidian";
import { Catalog } from "../core/types";
import { mergeCatalog, parseCatalog } from "../core/import-export";

export interface ImportResultSummary {
	readonly catalog: Catalog;
	readonly added: number;
	readonly renamed: number;
	readonly skipped: number;
	readonly warnings: readonly string[];
}

export class ImportModal extends Modal {
	private text = "";

	constructor(
		app: App,
		private readonly current: Catalog,
		private readonly mintId: () => string,
		private readonly onImport: (summary: ImportResultSummary) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("eqlib-view-modal");
		contentEl.empty();
		contentEl.createEl("h2", { text: "Import equations" });
		contentEl.createEl("p", {
			text: "Paste an exported catalog below. Existing equations are never overwritten: a clashing name is suffixed, and an equation that is already present unchanged is skipped.",
		});

		const error = contentEl.createEl("p", { cls: "eqlib-error" });
		error.hide();

		const textarea = contentEl.createEl("textarea", { cls: "eqlib-file-view" });
		textarea.placeholder = '{ "schemaVersion": 1, "categories": [], "equations": [] }';
		textarea.spellcheck = false;
		textarea.addEventListener("input", () => {
			this.text = textarea.value;
			error.hide();
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Import")
					.setCta()
					.onClick(() => {
						const parsed = parseCatalog(this.text);
						if (!parsed.ok) {
							error.setText(parsed.error);
							error.show();
							return;
						}
						const report = mergeCatalog(this.current, parsed.value.catalog, () => this.mintId());
						this.close();
						this.onImport({
							catalog: report.catalog,
							added: report.added,
							renamed: report.renamed,
							skipped: report.skipped,
							warnings: parsed.value.warnings,
						});
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
