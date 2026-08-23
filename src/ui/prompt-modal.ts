/**
 * A one-field text prompt, used for category names, equation names and the
 * export path. Obsidian has no built-in text prompt, and the alternative —
 * `window.prompt` — is unavailable on mobile.
 */
import { App, Modal, Setting } from "obsidian";

export interface PromptOptions {
	readonly title: string;
	readonly placeholder?: string;
	readonly initialValue?: string;
	readonly cta?: string;
	/** Return an error string to keep the modal open and show the message. */
	readonly validate?: (value: string) => string | null;
}

export class PromptModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private readonly options: PromptOptions,
		private readonly onSubmit: (value: string) => void,
	) {
		super(app);
		this.value = options.initialValue ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.options.title });
		const error = contentEl.createEl("p", { cls: "eqlib-error" });
		error.hide();

		const submit = (): void => {
			const message = this.options.validate?.(this.value) ?? null;
			if (message !== null) {
				error.setText(message);
				error.show();
				return;
			}
			this.close();
			this.onSubmit(this.value);
		};

		new Setting(contentEl).addText((text) => {
			text.setPlaceholder(this.options.placeholder ?? "")
				.setValue(this.value)
				.onChange((value) => {
					this.value = value;
					error.hide();
				});
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					submit();
				}
			});
			text.inputEl.focus();
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText(this.options.cta ?? "OK").setCta().onClick(submit));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
