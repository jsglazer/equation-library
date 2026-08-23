/**
 * File access for the plugin's own storage directory.
 *
 * Everything goes through `vault.adapter`, which works identically on desktop,
 * iOS and Android — no Node `fs` or `path` module is imported anywhere in this
 * plugin. Paths are built from `vault.configDir` and the manifest id, so a
 * vault with a renamed config directory is handled without configuration.
 *
 * `data.json` is deliberately absent from this module: plugin settings are read
 * and written exclusively through Obsidian's `loadData()` / `saveData()` and
 * are never hand-written through the adapter.
 *
 * Every write is funnelled through one promise chain, so concurrent callers
 * (a rapid double-click, an autocomplete accept landing while a save is in
 * flight) can never interleave a read-modify-write.
 */
import { DataAdapter, normalizePath } from "obsidian";
import { Catalog } from "../core/types";
import { LogCap, appendWithCap, applyCap, parseLog, serializeLog } from "../core/log";
import { LogEntry } from "../core/types";
import { migrateCatalog } from "../core/migrate";
import { serializeCatalog } from "../core/import-export";

export const CATALOG_FILE = "equations.json";
export const LOG_FILE = "equation-log.jsonl";

export interface CatalogLoad {
	readonly catalog: Catalog;
	readonly warnings: readonly string[];
	/** True when the file was missing and a fresh catalog was returned. */
	readonly created: boolean;
}

export class PluginStore {
	private readonly dir: string;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly adapter: DataAdapter,
		configDir: string,
		manifestId: string,
	) {
		this.dir = normalizePath(`${configDir}/plugins/${manifestId}`);
	}

	get catalogPath(): string {
		return normalizePath(`${this.dir}/${CATALOG_FILE}`);
	}

	get logPath(): string {
		return normalizePath(`${this.dir}/${LOG_FILE}`);
	}

	/** Serializes an operation onto the single queue shared by all writes. */
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.queue.then(operation, operation);
		// Keep the chain alive even if this operation rejects.
		this.queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private async readIfPresent(path: string): Promise<string | null> {
		return (await this.adapter.exists(path)) ? await this.adapter.read(path) : null;
	}

	private async writeFile(path: string, contents: string): Promise<void> {
		if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
		await this.adapter.write(path, contents);
	}

	/** Reads the catalog from disk, repairing anything unreadable in memory. */
	async loadCatalog(): Promise<CatalogLoad> {
		return this.enqueue(async () => {
			const text = await this.readIfPresent(this.catalogPath);
			if (text === null) {
				const fresh = migrateCatalog(null);
				return { catalog: fresh.catalog, warnings: fresh.warnings, created: true };
			}
			let raw: unknown = null;
			const warnings: string[] = [];
			try {
				raw = JSON.parse(text);
			} catch (error) {
				warnings.push(`${CATALOG_FILE} is not valid JSON (${String(error)}); starting from an empty catalog.`);
			}
			const result = migrateCatalog(raw);
			return { catalog: result.catalog, warnings: [...warnings, ...result.warnings], created: false };
		});
	}

	async saveCatalog(catalog: Catalog): Promise<void> {
		await this.enqueue(async () => {
			await this.writeFile(this.catalogPath, serializeCatalog(catalog));
		});
	}

	/** Raw catalog file text, for the read-only viewer. */
	async readCatalogText(): Promise<string> {
		return this.enqueue(async () => (await this.readIfPresent(this.catalogPath)) ?? "");
	}

	/** Raw log file text, for the read-only viewer. */
	async readLogText(): Promise<string> {
		return this.enqueue(async () => (await this.readIfPresent(this.logPath)) ?? "");
	}

	/**
	 * Appends one entry and re-applies the cap in the same queued operation, so
	 * the file can never grow past the cap even under rapid-fire inserts.
	 */
	async appendLog(entry: LogEntry, cap: LogCap): Promise<void> {
		await this.enqueue(async () => {
			const existing = parseLog((await this.readIfPresent(this.logPath)) ?? "");
			await this.writeFile(this.logPath, serializeLog(appendWithCap(existing, entry, cap)));
		});
	}

	/** Re-applies the cap to the log on disk, used when the setting changes. */
	async recapLog(cap: LogCap): Promise<void> {
		await this.enqueue(async () => {
			const text = await this.readIfPresent(this.logPath);
			if (text === null) return;
			const capped = applyCap(parseLog(text), cap);
			await this.writeFile(this.logPath, serializeLog(capped));
		});
	}

	/** Writes a catalog copy to an arbitrary vault-relative path (export). */
	async writeVaultFile(vaultPath: string, contents: string): Promise<string> {
		return this.enqueue(async () => {
			const path = normalizePath(vaultPath);
			const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			if (parent.length > 0 && !(await this.adapter.exists(parent))) await this.adapter.mkdir(parent);
			await this.adapter.write(path, contents);
			return path;
		});
	}
}
