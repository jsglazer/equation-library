/**
 * Import: paste a catalog JSON blob and validate it. Validation runs in the
 * pure core (`parseCatalog`), which returns a result object carrying errors
 * rather than throwing, so a bad paste produces a message instead of an
 * exception. Deciding which equations become notes is the caller's job.
 */
import { App, Modal, Setting } from "obsidian";
import { Catalog } from "../core/types";
import { parseCatalog } from "../core/import-export";

export interface ParsedImport {
	readonly catalog: Catalog;
	readonly warnings: readonly string[];
}

export class ImportModal extends Modal {
	private text = "";

	constructor(
		app: App,
		private readonly onParsed: (parsed: ParsedImport) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("eqlib-view-modal");
		contentEl.empty();
		contentEl.createEl("h2", { text: "Import equations" });
		contentEl.createEl("p", {
			text: "Paste an exported catalog below. Each equation becomes a note in the library folder. Nothing is overwritten: an equation whose LaTeX is already in the library is skipped, and a clashing name is suffixed.",
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
						this.close();
						this.onParsed({ catalog: parsed.value.catalog, warnings: parsed.value.warnings });
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
