/**
 * Asking where an export goes.
 *
 * On desktop this is the operating system's own Save As dialog, through the
 * browser File System Access API that Obsidian's Electron shell provides, so a
 * file can go anywhere on disk without this plugin importing Node's `fs`. On
 * mobile, where there is no such dialog, the user picks a vault folder instead.
 */
import { App, FuzzySuggestModal, TFolder } from "obsidian";

/** The slice of `window.showSaveFilePicker` this plugin uses; not in TypeScript's DOM lib. */
interface SaveFilePickerOptions {
	suggestedName?: string;
	types?: Array<{ description: string; accept: Record<string, string[]> }>;
}

interface WritableFileStream {
	write(data: string): Promise<void>;
	close(): Promise<void>;
}

interface SaveFileHandle {
	readonly name: string;
	createWritable(): Promise<WritableFileStream>;
}

type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

export interface SaveRequest {
	readonly fileName: string;
	readonly extension: string;
	readonly mimeType: string;
	readonly description: string;
	readonly contents: string;
}

/**
 * The outcome of the OS dialog: the saved file's name, `null` when the user
 * cancelled, or `undefined` when no such dialog exists on this platform.
 */
export type OsSaveResult = string | null | undefined;

function picker(): ShowSaveFilePicker | undefined {
	const candidate = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
	return typeof candidate === "function" ? candidate.bind(window) : undefined;
}

/** True when the native Save As dialog is available (desktop). */
export function hasOsSaveDialog(isMobile: boolean): boolean {
	return !isMobile && picker() !== undefined;
}

/** Shows the native Save As dialog and writes the file where the user chose. */
export async function saveWithOsDialog(request: SaveRequest): Promise<OsSaveResult> {
	const show = picker();
	if (!show) return undefined;
	let handle: SaveFileHandle;
	try {
		handle = await show({
			suggestedName: request.fileName,
			types: [{ description: request.description, accept: { [request.mimeType]: [`.${request.extension}`] } }],
		});
	} catch (error) {
		// The user closing the dialog is an AbortError, not a failure.
		if (error instanceof DOMException && error.name === "AbortError") return null;
		throw error;
	}
	const stream = await handle.createWritable();
	await stream.write(request.contents);
	await stream.close();
	return handle.name;
}

/** A searchable list of every folder in the vault, the vault root first. */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly onPick: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a vault folder to save the export in");
	}

	getItems(): TFolder[] {
		const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
		return folders.sort((a, b) => (a.isRoot() ? -1 : b.isRoot() ? 1 : a.path.localeCompare(b.path)));
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? "/ (vault root)" : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onPick(folder);
	}
}
