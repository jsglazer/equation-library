/**
 * Shared data types for the equation catalog and the action log.
 *
 * Pure module: nothing here imports from `obsidian`, from the DOM, or from
 * Node. It is imported by both the pure core and the plugin shell.
 */

/** Schema version written into every catalog this build produces. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Reserved category that always exists and can be neither renamed nor deleted. */
export const UNCATEGORIZED = "Uncategorized";

export interface Equation {
	/** Stable identity, a UUID produced by the shell via `crypto.randomUUID()`. */
	readonly id: string;
	readonly name: string;
	/** Bare LaTeX: no surrounding `$` or `$$`. Delimiters are added at insert time. */
	readonly latex: string;
	readonly category: string;
	/** ISO-8601 timestamp supplied by the caller; core never reads the clock. */
	readonly created: string;
	readonly modified: string;
}

export interface Catalog {
	readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
	readonly categories: readonly string[];
	readonly equations: readonly Equation[];
}

/** Only committed user actions are logged; drafts and keystrokes never are. */
export type LogAction =
	| "insert-at-cursor"
	| "add-to-library"
	| "add-and-insert"
	| "autocomplete-accept"
	| "update-equation";

export interface LogEntry {
	readonly ts: string;
	readonly action: LogAction;
	readonly latex: string;
	readonly name?: string;
	readonly category?: string;
}

/** Result type used by every core operation that can legitimately fail. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export function ok<T>(value: T): Outcome<T> {
	return { ok: true, value };
}

export function fail<T>(error: string): Outcome<T> {
	return { ok: false, error };
}
