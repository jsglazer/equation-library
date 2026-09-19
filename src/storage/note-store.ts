/**
 * The library as a folder of Markdown notes.
 *
 * Every equation is one note under the configured library folder; its
 * frontmatter carries the fields and its body is the user's own. Reading goes
 * through the metadata cache, which has every note's frontmatter parsed and in
 * memory, so listing the library is synchronous and costs nothing. Writing
 * edits only the plugin-owned keys, line by line (`core/frontmatter.ts`), so a
 * hand-written note is never reformatted, reordered or stripped of anything.
 *
 * The rest of the plugin still works on a `Catalog`: `loadCatalog` assembles
 * one from the notes, and `applyCatalog` takes the catalog the pure core
 * produced and turns the difference into note creates, edits and deletions.
 * That is what lets the modal and the core stay unchanged by the move away
 * from JSON.
 *
 * All file access is through the `Vault` API, which behaves identically on
 * desktop, iOS and Android. Every write is funnelled through one promise
 * chain so concurrent callers can never interleave a read-modify-write.
 */
import { App, TFile, TFolder, normalizePath } from "obsidian";
import { Catalog, CURRENT_SCHEMA_VERSION, Equation, UNCATEGORIZED } from "../core/types";
import { EquationLibrarySettings } from "../core/settings";
import { buildNoteText, setFrontmatterFields, splitNote } from "../core/frontmatter";
import {
	WritableFields,
	changedFields,
	fieldsToWrite,
	fileStem,
	readEquationNote,
	uniqueStem,
} from "../core/note-schema";
import { ensureUncategorized } from "../core/catalog";

export interface NoteStoreDeps {
	readonly getSettings: () => EquationLibrarySettings;
	/** Persists the stored category list when the catalog's categories change. */
	readonly saveCategories: (categories: readonly string[]) => Promise<void>;
}

export class NoteStore {
	private queue: Promise<unknown> = Promise.resolve();
	/** Frontmatter-only listing, rebuilt lazily after any change under the folder. */
	private listing: Equation[] | null = null;

	constructor(
		private readonly app: App,
		private readonly deps: NoteStoreDeps,
	) {}

	get folder(): string {
		return normalizePath(this.deps.getSettings().libraryFolder);
	}

	/** Whether a vault path is a Markdown note inside the library folder. */
	isLibraryPath(path: string): boolean {
		return path.startsWith(`${this.folder}/`) && path.endsWith(".md");
	}

	/** Forgets the cached listing; the next read rebuilds it from the cache. */
	invalidate(): void {
		this.listing = null;
	}

	/** Serializes an operation onto the single queue shared by all writes. */
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.queue.then(operation, operation);
		this.queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private libraryFiles(): TFile[] {
		const folder = this.app.vault.getFolderByPath(this.folder);
		if (!folder) return [];
		const files: TFile[] = [];
		const walk = (dir: TFolder) => {
			for (const child of dir.children) {
				if (child instanceof TFile && child.extension === "md") files.push(child);
				else if (child instanceof TFolder) walk(child);
			}
		};
		walk(folder);
		return files;
	}

	private readFile(file: TFile, body?: string): Equation | null {
		return readEquationNote(
			{
				path: file.path,
				basename: file.basename,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter,
				body,
			},
			this.deps.getSettings().keys,
		);
	}

	/**
	 * Every equation in the library, from frontmatter alone. Synchronous, so
	 * the editor autocomplete can call it on each keystroke; the result is
	 * cached until something under the folder changes.
	 */
	listEquations(): readonly Equation[] {
		if (this.listing !== null) return this.listing;
		const equations: Equation[] = [];
		for (const file of this.libraryFiles()) {
			const equation = this.readFile(file);
			if (equation) equations.push(equation);
		}
		this.listing = equations;
		return equations;
	}

	private categoriesFor(equations: readonly Equation[]): string[] {
		const set = new Set<string>(this.deps.getSettings().categories);
		for (const equation of equations) set.add(equation.category);
		set.delete(UNCATEGORIZED);
		return [UNCATEGORIZED, ...[...set].sort((a, b) => a.localeCompare(b))];
	}

	/**
	 * The full catalog, with each note's body attached as searchable text.
	 * Bodies come from the vault's read cache, so this is a few milliseconds
	 * even for a large library.
	 */
	async loadCatalog(): Promise<Catalog> {
		const equations: Equation[] = [];
		for (const file of this.libraryFiles()) {
			if (!this.readFile(file)) continue;
			const text = await this.app.vault.cachedRead(file);
			const equation = this.readFile(file, splitNote(text).body);
			if (equation) equations.push(equation);
		}
		return ensureUncategorized({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			categories: this.categoriesFor(equations),
			equations,
		});
	}

	/**
	 * Applies the difference between two catalogs to the notes: equations
	 * with an unknown id are created, changed ones have only their changed
	 * fields rewritten, missing ones are moved to the trash, and the category
	 * list is stored. Returns the catalog re-read from the notes so callers
	 * see real paths and timestamps.
	 */
	async applyCatalog(prev: Catalog, next: Catalog): Promise<Catalog> {
		await this.enqueue(async () => {
			const before = new Map(prev.equations.map((e) => [e.id, e]));
			const after = new Set(next.equations.map((e) => e.id));

			for (const equation of next.equations) {
				const previous = before.get(equation.id);
				if (!previous) {
					await this.createNoteFile(equation);
					continue;
				}
				const patch = changedFields(previous, equation);
				if (Object.keys(patch).length > 0) await this.writeFields(equation.id, patch);
			}
			for (const equation of prev.equations) {
				if (!after.has(equation.id)) await this.trashNote(equation.id);
			}

			const stored = next.categories.filter((c) => c !== UNCATEGORIZED);
			const current = this.deps.getSettings().categories;
			if (stored.length !== current.length || stored.some((c, i) => c !== current[i])) {
				await this.deps.saveCategories(stored);
			}
		});
		this.invalidate();
		return this.loadCatalog();
	}

	/** Creates the notes for equations that have no LaTeX match yet (import). */
	async createNotes(equations: readonly Equation[]): Promise<number> {
		let created = 0;
		await this.enqueue(async () => {
			for (const equation of equations) {
				await this.createNoteFile(equation);
				created += 1;
			}
		});
		this.invalidate();
		return created;
	}

	private async ensureFolder(path: string): Promise<void> {
		if (this.app.vault.getFolderByPath(path)) return;
		const segments = path.split("/");
		for (let i = 0; i < segments.length; i += 1) {
			const partial = segments.slice(0, i + 1).join("/");
			if (!this.app.vault.getFolderByPath(partial)) await this.app.vault.createFolder(partial);
		}
	}

	private async templateText(): Promise<string | null> {
		const path = this.deps.getSettings().templatePath;
		if (path.length === 0) return null;
		const file = this.app.vault.getFileByPath(normalizePath(path));
		if (!file) return null;
		return this.app.vault.cachedRead(file);
	}

	private async createNoteFile(equation: Equation): Promise<string> {
		const settings = this.deps.getSettings();
		await this.ensureFolder(this.folder);
		const stem = uniqueStem(
			fileStem(settings.filePrefix, equation.name),
			(candidate) => this.app.vault.getFileByPath(`${this.folder}/${candidate}.md`) !== null,
		);
		const path = normalizePath(`${this.folder}/${stem}.md`);
		const fields = fieldsToWrite(
			{
				name: equation.name,
				symbol: equation.symbol ?? "",
				latex: equation.latex,
				category: equation.category,
				note: equation.note ?? "",
			},
			settings.keys,
		);
		const text = buildNoteText({ fields, template: await this.templateText() });
		await this.app.vault.create(path, text);
		return path;
	}

	private async writeFields(path: string, patch: WritableFields): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) throw new Error(`The note ${path} no longer exists.`);
		const fields = fieldsToWrite(patch, this.deps.getSettings().keys);
		if (fields.length === 0) return;
		const record: Record<string, string | readonly string[]> = {};
		for (const [key, value] of fields) record[key] = value;
		await this.app.vault.process(file, (data) => setFrontmatterFields(data, record));
	}

	private async trashNote(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		await this.app.fileManager.trashFile(file);
	}

	/** Opens an equation's note in the workspace. */
	async openNote(path: string, newLeaf: boolean): Promise<boolean> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return false;
		await this.app.workspace.getLeaf(newLeaf).openFile(file);
		return true;
	}

	/** The `[[link]]` text for an equation, resolved the way Obsidian would write it. */
	linkFor(path: string, fromPath: string): string {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return `[[${path.replace(/\.md$/, "")}]]`;
		return this.app.fileManager.generateMarkdownLink(file, fromPath);
	}
}
