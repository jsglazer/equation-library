/**
 * Plugin settings: shape, defaults and normalization.
 *
 * Settings live in `data.json` and are read and written exclusively through
 * Obsidian's `loadData()` / `saveData()`. `normalizeSettings` is pure so that a
 * hand-edited or partially written `data.json` can never leave the plugin in a
 * broken state.
 *
 * Pure module: no `obsidian`, DOM or Node imports.
 */
import { InsertFormat } from "./latex";
import { DEFAULT_LOG_CAP, LOG_CAPS, LogCap } from "./log";
import { SortOrder } from "./search";
import { DEFAULT_TRIGGER } from "./suggest";
import { UNCATEGORIZED } from "./types";

/**
 * The frontmatter keys the plugin reads and writes in an equation note. Every
 * other key in the note is left exactly as it was.
 */
export interface FrontmatterKeys {
	/** The display name. Falls back to the file name when absent. */
	readonly name: string;
	/** The LaTeX, stored `$…$`-wrapped so inline Dataview fields render it. */
	readonly latex: string;
	/** The left-hand symbol, also `$…$`-wrapped. */
	readonly symbol: string;
	/** Single-valued category. Missing or blank means Uncategorized. */
	readonly category: string;
	/** The free-text note shown in the generator. */
	readonly note: string;
	/** Multi-valued tags; read for the Usage filter, never written. */
	readonly usage: string;
	/** Where the equation came from; read for search, never written. */
	readonly source: string;
}

export const DEFAULT_KEYS: FrontmatterKeys = {
	name: "Name",
	latex: "Eq",
	symbol: "Smb",
	category: "Category",
	note: "Note",
	usage: "Usage",
	source: "Source",
};

export interface EquationLibrarySettings {
	/** Close the library popup after an insert. */
	readonly closeOnInsert: boolean;
	/** Delimiters used by an unmodified insert. */
	readonly insertFormat: InsertFormat;
	/** Master enable/disable toggle for the editor autocomplete. */
	readonly suggestEnabled: boolean;
	/** Characters that open the suggester; a bare `$` must never do so. */
	readonly suggestTrigger: string;
	readonly logCap: LogCap;
	/** Sort order remembered between library sessions. */
	readonly sortOrder: SortOrder;
	/** Category filter remembered between library sessions; `null` is "all". */
	readonly lastCategory: string | null;
	/**
	 * Vault-relative folder whose Markdown notes make up the library. A note
	 * counts as an equation when its frontmatter has the LaTeX key.
	 */
	readonly libraryFolder: string;
	/**
	 * Optional vault-relative path of a note used as the scaffold for new
	 * equation notes: its frontmatter keys are copied (blank where the value is
	 * a Templater tag) and its body becomes the new note's body.
	 */
	readonly templatePath: string;
	/** Prefix for new note file names, e.g. `eq-` gives `eq-Bayes-Theorem.md`. */
	readonly filePrefix: string;
	readonly keys: FrontmatterKeys;
	/**
	 * Categories that exist even when no note carries them, so a category can
	 * be created before its first equation. The reserved one is never stored.
	 */
	readonly categories: readonly string[];
}

export const DEFAULT_LIBRARY_FOLDER = "Equation Library";
export const DEFAULT_FILE_PREFIX = "eq-";

export const DEFAULT_SETTINGS: EquationLibrarySettings = {
	closeOnInsert: true,
	insertFormat: "inline",
	suggestEnabled: true,
	suggestTrigger: DEFAULT_TRIGGER,
	logCap: DEFAULT_LOG_CAP,
	sortOrder: "name",
	lastCategory: null,
	libraryFolder: DEFAULT_LIBRARY_FOLDER,
	templatePath: "",
	filePrefix: DEFAULT_FILE_PREFIX,
	keys: DEFAULT_KEYS,
	categories: [],
};

const SORT_ORDERS: readonly SortOrder[] = ["name", "created", "modified"];
const INSERT_FORMATS: readonly InsertFormat[] = ["inline", "always-block"];

/**
 * Trims a user-supplied vault path and rejects anything that would escape the
 * vault; `fallback` stands in for an empty or unsafe value.
 */
export function normalizeVaultPath(raw: unknown, fallback: string): string {
	if (typeof raw !== "string") return fallback;
	const path = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
	if (path.length === 0 || path.split("/").includes("..")) return fallback;
	return path;
}

/** A frontmatter key: trimmed, no colon, non-empty; else the default. */
function normalizeKey(raw: unknown, fallback: string): string {
	if (typeof raw !== "string") return fallback;
	const key = raw.trim();
	if (key.length === 0 || key.includes(":") || /^\s|\s$/.test(key)) return fallback;
	return key;
}

export function normalizeKeys(raw: unknown): FrontmatterKeys {
	const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	return {
		name: normalizeKey(record.name, DEFAULT_KEYS.name),
		latex: normalizeKey(record.latex, DEFAULT_KEYS.latex),
		symbol: normalizeKey(record.symbol, DEFAULT_KEYS.symbol),
		category: normalizeKey(record.category, DEFAULT_KEYS.category),
		note: normalizeKey(record.note, DEFAULT_KEYS.note),
		usage: normalizeKey(record.usage, DEFAULT_KEYS.usage),
		source: normalizeKey(record.source, DEFAULT_KEYS.source),
	};
}

/** Stored categories: strings only, trimmed, deduplicated, never the reserved one. */
export function normalizeCategories(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	for (const value of raw) {
		if (typeof value !== "string") continue;
		const category = value.trim();
		if (category.length === 0 || category === UNCATEGORIZED) continue;
		seen.add(category);
	}
	return [...seen];
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function pickFrom<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Folds a raw `data.json` payload onto the defaults, discarding anything of
 * the wrong type. An empty or unreadable payload yields the defaults.
 */
export function normalizeSettings(raw: unknown): EquationLibrarySettings {
	if (typeof raw !== "object" || raw === null) return DEFAULT_SETTINGS;
	const record = raw as Record<string, unknown>;

	const trigger = typeof record.suggestTrigger === "string" ? record.suggestTrigger.trim() : "";
	const prefix = typeof record.filePrefix === "string" ? record.filePrefix.trim() : DEFAULT_FILE_PREFIX;
	return {
		closeOnInsert: pickBoolean(record.closeOnInsert, DEFAULT_SETTINGS.closeOnInsert),
		insertFormat: pickFrom(record.insertFormat, INSERT_FORMATS, DEFAULT_SETTINGS.insertFormat),
		suggestEnabled: pickBoolean(record.suggestEnabled, DEFAULT_SETTINGS.suggestEnabled),
		// An empty trigger would make every keystroke a trigger, so it falls back.
		suggestTrigger: trigger.length > 0 ? trigger : DEFAULT_SETTINGS.suggestTrigger,
		logCap: pickFrom(record.logCap, LOG_CAPS, DEFAULT_SETTINGS.logCap),
		sortOrder: pickFrom(record.sortOrder, SORT_ORDERS, DEFAULT_SETTINGS.sortOrder),
		lastCategory: typeof record.lastCategory === "string" && record.lastCategory.length > 0
			? record.lastCategory
			: null,
		libraryFolder: normalizeVaultPath(record.libraryFolder, DEFAULT_LIBRARY_FOLDER),
		templatePath: normalizeVaultPath(record.templatePath, ""),
		// An empty prefix is a legitimate choice; only a path separator is refused.
		filePrefix: prefix.includes("/") ? DEFAULT_FILE_PREFIX : prefix,
		keys: normalizeKeys(record.keys),
		categories: normalizeCategories(record.categories),
	};
}

/** How many suggestions the editor popup lists at once. */
export const SUGGEST_LIMIT = 20;
