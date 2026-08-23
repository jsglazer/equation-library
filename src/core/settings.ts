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
}

export const DEFAULT_SETTINGS: EquationLibrarySettings = {
	closeOnInsert: true,
	insertFormat: "inline",
	suggestEnabled: true,
	suggestTrigger: DEFAULT_TRIGGER,
	logCap: DEFAULT_LOG_CAP,
	sortOrder: "name",
	lastCategory: null,
};

const SORT_ORDERS: readonly SortOrder[] = ["name", "created", "modified"];
const INSERT_FORMATS: readonly InsertFormat[] = ["inline", "always-block"];

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
	};
}

/** How many suggestions the editor popup lists at once. */
export const SUGGEST_LIMIT = 20;
