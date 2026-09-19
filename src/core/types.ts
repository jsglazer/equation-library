/**
 * Shared data types for the equation catalog and the action log.
 *
 * Pure module: nothing here imports from `obsidian`, from the DOM, or from
 * Node. It is imported by both the pure core and the plugin shell.
 *
 * Since 1.1.0 the catalog is not a file of its own: every equation is a
 * Markdown note in the library folder, and the catalog is the in-memory view
 * the plugin assembles from those notes' frontmatter. The `Catalog` shape is
 * kept because the pure core (search, edits, import) operates on it.
 */

/** Schema version written into an exported catalog. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Reserved category that always exists and can be neither renamed nor deleted. */
export const UNCATEGORIZED = "Uncategorized";

export interface Equation {
	/**
	 * Stable identity. For an equation read from the library this is the note's
	 * vault path; for one the modal has just built and not yet saved it is a
	 * placeholder the store replaces with the real path on save.
	 */
	readonly id: string;
	readonly name: string;
	/** Bare LaTeX: no surrounding `$` or `$$`. Delimiters are added at insert time. */
	readonly latex: string;
	readonly category: string;
	/**
	 * Free-text note about the equation — what it is for, where it came from.
	 * Absent on equations with an empty note; never an empty string.
	 */
	readonly note?: string;
	/** Bare LaTeX for the left-hand symbol (`E_p`, `\bar{x}`); absent when none. */
	readonly symbol?: string;
	/** Cross-cutting tags (the `Usage` list); empty when none. Never written by the plugin. */
	readonly usage?: readonly string[];
	/** Where the equation came from (the `Source` key); read for search only. */
	readonly source?: string;
	/**
	 * Extra searchable text the store attaches: the note body and any
	 * frontmatter values the plugin does not otherwise model. Never persisted.
	 */
	readonly text?: string;
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
	| "update-equation"
	| "duplicate-equation";

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
