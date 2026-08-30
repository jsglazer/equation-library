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
import { CatalogLocation } from "../core/settings";
import { Catalog } from "../core/types";
import { LogCap, appendWithCap, applyCap, parseLog, serializeLog } from "../core/log";
import { LogEntry } from "../core/types";
import { migrateCatalog } from "../core/migrate";
import { serializeCatalog } from "../core/import-export";

export const CATALOG_FILE = "equations.json";
export const LOG_FILE = "equation-log.jsonl";

export interface CatalogTarget {
	readonly location: CatalogLocation;
	/** Vault-relative path, used only when `location` is `vault`. */
	readonly vaultPath: string;
}

export interface CatalogLoad {
	readonly catalog: Catalog;
	readonly warnings: readonly string[];
	/** True when the file was missing and a fresh catalog was returned. */
	readonly created: boolean;
}

export class PluginStore {
	private readonly dir: string;
	private queue: Promise<unknown> = Promise.resolve();
	/** Where the catalog is read and written; retargeted from the settings. */
	private target: CatalogTarget = { location: "plugin", vaultPath: "" };

	constructor(
		private readonly adapter: DataAdapter,
		configDir: string,
		manifestId: string,
	) {
		this.dir = normalizePath(`${configDir}/plugins/${manifestId}`);
	}

	/** Points the catalog at the location the settings ask for. */
	setCatalogTarget(target: CatalogTarget): void {
		this.target = target;
	}

	/** The original location, under the plugin's own folder. */
	get pluginCatalogPath(): string {
		return normalizePath(`${this.dir}/${CATALOG_FILE}`);
	}

	get catalogPath(): string {
		return this.target.location === "vault" && this.target.vaultPath.length > 0
			? normalizePath(this.target.vaultPath)
			: this.pluginCatalogPath;
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
		await this.ensureParent(path);
		await this.adapter.write(path, contents);
	}

	/**
	 * Creates the folder a file is about to be written into.
	 *
	 * A vault-relative catalog can sit any number of folders deep, and the
	 * adapter will not create intermediate folders on its own, so every missing
	 * ancestor is made in turn.
	 */
	private async ensureParent(path: string): Promise<void> {
		const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (parent.length === 0) return;
		const segments = parent.split("/");
		for (let i = 0; i < segments.length; i += 1) {
			const folder = segments.slice(0, i + 1).join("/");
			if (!(await this.adapter.exists(folder))) await this.adapter.mkdir(folder);
		}
	}

	/**
	 * Copies the catalog from the plugin folder to the configured location the
	 * first time that location is used, so an existing library is not lost when
	 * the storage setting changes (or defaults to `vault` on upgrade).
	 *
	 * The original is left in place as a backup — nothing reads it once the
	 * target has moved.
	 */
	async migrateCatalogToTarget(): Promise<string | null> {
		return this.enqueue(async () => {
			const destination = this.catalogPath;
			if (destination === this.pluginCatalogPath) return null;
			if (await this.adapter.exists(destination)) return null;
			const source = await this.readIfPresent(this.pluginCatalogPath);
			if (source === null) return null;
			await this.ensureParent(destination);
			await this.adapter.write(destination, source);
			return destination;
		});
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
			await this.ensureParent(path);
			await this.adapter.write(path, contents);
			return path;
		});
	}
}
