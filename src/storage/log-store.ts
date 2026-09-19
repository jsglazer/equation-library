/**
 * File access for the plugin's own storage directory, which now holds only
 * the action log. (The equation catalog is the library folder of notes; see
 * `note-store.ts`.)
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
 * can never interleave a read-modify-write.
 */
import { DataAdapter, normalizePath } from "obsidian";
import { LogCap, appendWithCap, applyCap, parseLog, serializeLog } from "../core/log";
import { LogEntry } from "../core/types";

export const LOG_FILE = "equation-log.jsonl";

export class LogStore {
	private readonly dir: string;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly adapter: DataAdapter,
		configDir: string,
		manifestId: string,
	) {
		this.dir = normalizePath(`${configDir}/plugins/${manifestId}`);
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
			await this.adapter.write(this.logPath, serializeLog(appendWithCap(existing, entry, cap)));
		});
	}

	/** Re-applies the cap to the log on disk, used when the setting changes. */
	async recapLog(cap: LogCap): Promise<void> {
		await this.enqueue(async () => {
			const text = await this.readIfPresent(this.logPath);
			if (text === null) return;
			await this.adapter.write(this.logPath, serializeLog(applyCap(parseLog(text), cap)));
		});
	}

	/** Writes text to an arbitrary vault-relative path (export). */
	async writeVaultFile(vaultPath: string, contents: string): Promise<string> {
		return this.enqueue(async () => {
			const path = normalizePath(vaultPath);
			const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			if (parent.length > 0) {
				const segments = parent.split("/");
				for (let i = 0; i < segments.length; i += 1) {
					const folder = segments.slice(0, i + 1).join("/");
					if (!(await this.adapter.exists(folder))) await this.adapter.mkdir(folder);
				}
			}
			await this.adapter.write(path, contents);
			return path;
		});
	}
}
