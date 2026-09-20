/**
 * Tracks the Markdown note the library panel should write into.
 *
 * The library used to be a modal, which froze the workspace: capturing the
 * active `Editor` when it opened was safe because nothing could change while it
 * was open. A docked panel has no such guarantee — the note can be edited,
 * switched, or closed while the panel stays open — so the editor is resolved at
 * click time instead, from the last Markdown leaf that had focus.
 *
 * Nothing here holds an `Editor` object: those are owned by a `MarkdownView`
 * and Obsidian reuses both when a tab changes file, so a held `Editor` can
 * silently come to mean a different note. A leaf plus the path it was showing
 * is checked against the live workspace on every resolve instead.
 */
import { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

/** A note that is open, on screen, and safe to write to right now. */
export interface EditorTarget {
	readonly editor: MarkdownView["editor"];
	readonly filePath: string;
}

export class EditorTracker {
	private leaf: WorkspaceLeaf | null = null;
	private filePath: string | null = null;
	private readonly listeners = new Set<() => void>();

	/**
	 * `isIgnored` marks leaves whose focus must not change the target — the
	 * library panel itself, above all: clicking into it would otherwise clear
	 * the very note the click is about to insert into.
	 */
	constructor(
		private readonly app: App,
		private readonly isIgnored: (leaf: WorkspaceLeaf) => boolean,
	) {}

	/** Seeds the target from whatever note is open now, at load or on demand. */
	syncFromWorkspace(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) this.remember(view.leaf, view);
		this.notify();
	}

	/** `workspace.on("active-leaf-change")`. */
	handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
		if (leaf !== null && !this.isIgnored(leaf) && leaf.view instanceof MarkdownView) {
			this.remember(leaf, leaf.view);
		}
		// Focus moving to a non-Markdown leaf leaves the target alone — the user
		// is in the panel, the file explorer or a settings tab and still means the
		// note they were last in — but the buttons are refreshed either way, since
		// that note may have just been closed.
		this.notify();
	}

	/**
	 * `workspace.on("file-open")`.
	 *
	 * Opening a note inside a tab that already had focus does not fire
	 * `active-leaf-change`, so without this the tracker would keep naming the
	 * file that tab used to show and every insert would be refused.
	 */
	handleFileOpen(file: TFile | null): void {
		if (file !== null) {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view && !this.isIgnored(view.leaf)) this.remember(view.leaf, view);
		}
		this.notify();
	}

	/**
	 * The editor to write into, or `null` when there is nowhere safe to write.
	 *
	 * Both checks matter: a leaf closed since it was tracked is detached, and
	 * writing to it edits a view nobody can see, while a tab that has since
	 * changed file is a different note than the one that was pointed at.
	 */
	resolve(): EditorTarget | null {
		const leaf = this.leaf;
		const filePath = this.filePath;
		if (leaf === null || filePath === null) return null;
		if (!this.isAttached(leaf)) {
			this.forget();
			return null;
		}
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return null;
		if ((view.file?.path ?? null) !== filePath) return null;
		return { editor: view.editor, filePath };
	}

	/** Whether an insert is possible at all, for the buttons' enabled state. */
	hasTarget(): boolean {
		return this.resolve() !== null;
	}

	/** Subscribes to target changes; the returned function unsubscribes. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	dispose(): void {
		this.listeners.clear();
		this.forget();
	}

	private remember(leaf: WorkspaceLeaf, view: MarkdownView): void {
		const path = view.file?.path ?? null;
		if (path === null) return;
		this.leaf = leaf;
		this.filePath = path;
	}

	private forget(): void {
		this.leaf = null;
		this.filePath = null;
	}

	/**
	 * `getLeavesOfType` walks every window, so a note in a popout counts as
	 * attached; a leaf the user closed is in no window and does not.
	 */
	private isAttached(leaf: WorkspaceLeaf): boolean {
		return this.app.workspace.getLeavesOfType("markdown").includes(leaf);
	}

	private notify(): void {
		// A detached leaf is dropped here rather than held until the next insert,
		// so a closed note's view is not kept alive by this reference.
		if (this.leaf !== null && !this.isAttached(this.leaf)) this.forget();
		for (const listener of [...this.listeners]) listener();
	}
}
