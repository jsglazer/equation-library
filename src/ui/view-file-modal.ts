/**
 * A read-only viewer for the plugin's own data files.
 *
 * The catalog and log live inside the hidden plugin configuration directory,
 * which Obsidian will not open in a normal tab, and which has no representation
 * at all on mobile. Showing the contents in a scrollable, read-only textarea
 * with a copy button is what makes "open the JSON library" and "open the log"
 * work identically on every platform.
 */
import { App, Modal, Notice, Setting } from "obsidian";

export interface ViewFileModalOptions {
	readonly title: string;
	/** Shown under the title so the user knows what they are looking at. */
	readonly path: string;
	readonly contents: string;
	/** Shown in place of the textarea when the file is empty. */
	readonly emptyMessage: string;
}

export class ViewFileModal extends Modal {
	constructor(app: App, private readonly options: ViewFileModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("eqlib-view-modal");
		contentEl.empty();
		contentEl.createEl("h2", { text: this.options.title });
		contentEl.createEl("p", { text: this.options.path, cls: "eqlib-file-path" });

		if (this.options.contents.trim().length === 0) {
			contentEl.createEl("p", { text: this.options.emptyMessage, cls: "eqlib-empty" });
			return;
		}

		const textarea = contentEl.createEl("textarea", { cls: "eqlib-file-view" });
		textarea.value = this.options.contents;
		textarea.readOnly = true;
		textarea.spellcheck = false;

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText("Copy to clipboard")
				.setCta()
				.onClick(async () => {
					await navigator.clipboard.writeText(this.options.contents);
					new Notice("Copied to clipboard.");
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
