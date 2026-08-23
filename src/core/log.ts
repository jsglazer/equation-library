/**
 * The action log: entry construction, JSONL serialization and the entry cap.
 *
 * Pure module: no `obsidian`, DOM or Node imports and no clock — the caller
 * supplies the timestamp. Only committed user actions reach this module;
 * generator keystrokes and drafts that were never inserted are not logged.
 */
import { LogAction, LogEntry } from "./types";
import { stripDelimiters } from "./latex";

/** The cap is a setting; `"off"` keeps every entry. */
export type LogCap = 100 | 500 | 1000 | "off";

export const LOG_CAPS: readonly LogCap[] = [100, 500, 1000, "off"];
export const DEFAULT_LOG_CAP: LogCap = 500;

export interface LogInput {
	readonly action: LogAction;
	readonly latex: string;
	readonly name?: string;
	readonly category?: string;
	/** ISO timestamp supplied by the shell. */
	readonly now: string;
}

/** Builds one log entry, storing the LaTeX bare as the catalog does. */
export function createLogEntry(input: LogInput): LogEntry {
	const entry: LogEntry = {
		ts: input.now,
		action: input.action,
		latex: stripDelimiters(input.latex),
	};
	const name = input.name?.trim();
	const category = input.category?.trim();
	return {
		...entry,
		...(name ? { name } : {}),
		...(category ? { category } : {}),
	};
}

function isLogEntry(value: unknown): value is LogEntry {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.ts === "string" && typeof record.action === "string" && typeof record.latex === "string";
}

/** Parses JSONL, skipping blank and malformed lines rather than throwing. */
export function parseLog(text: string): LogEntry[] {
	const entries: LogEntry[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (isLogEntry(parsed)) entries.push(parsed);
		} catch {
			// A truncated or hand-edited line is dropped; the rest of the log stands.
		}
	}
	return entries;
}

/** One JSON object per line, with a trailing newline when non-empty. */
export function serializeLog(entries: readonly LogEntry[]): string {
	if (entries.length === 0) return "";
	return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

/** Enforces the cap by dropping the oldest entries from the head. */
export function applyCap(entries: readonly LogEntry[], cap: LogCap): LogEntry[] {
	if (cap === "off" || entries.length <= cap) return entries.slice();
	return entries.slice(entries.length - cap);
}

/** Appends one entry and re-applies the cap, which is enforced at write time. */
export function appendWithCap(
	existing: readonly LogEntry[],
	entry: LogEntry,
	cap: LogCap,
): LogEntry[] {
	return applyCap([...existing, entry], cap);
}
