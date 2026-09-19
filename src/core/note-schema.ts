/**
 * The mapping between an equation note and an `Equation`.
 *
 * Reading takes the frontmatter object the metadata cache already parsed and
 * the file's stat; writing produces the frontmatter fields the plugin owns.
 * Nothing else in a note is modelled, and nothing else is ever written.
 *
 * Pure module: no `obsidian`, DOM or Node imports.
 */
import { FieldValue } from "./frontmatter";
import { stripDelimiters } from "./latex";
import { FrontmatterKeys } from "./settings";
import { Equation, UNCATEGORIZED } from "./types";

export interface NoteInfo {
	/** Vault path of the note; becomes the equation's id. */
	readonly path: string;
	/** File name without extension; the fallback display name. */
	readonly basename: string;
	/** Epoch milliseconds from the file stat. */
	readonly ctime: number;
	readonly mtime: number;
	/** Parsed frontmatter, or null/undefined when the note has none. */
	readonly frontmatter: Readonly<Record<string, unknown>> | null | undefined;
	/** Note body (after the frontmatter) when the caller loaded it; used for search only. */
	readonly body?: string;
}

/** A scalar frontmatter value as trimmed text; lists join with a space. */
export function asText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) return value.map(asText).filter((v) => v.length > 0).join(" ");
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

/** A list-valued frontmatter value; a scalar becomes a one-item list. */
export function asList(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	const items = Array.isArray(value) ? value : [value];
	return items.map(asText).filter((v) => v.length > 0);
}

function isoFromEpoch(ms: number): string {
	return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

/**
 * Reads an equation from a note. Returns null when the note is not an
 * equation, which is decided by one thing only: its frontmatter has the LaTeX
 * key with something in it. A folder index, a template or a scratch note in
 * the library folder is therefore left alone.
 */
export function readEquationNote(info: NoteInfo, keys: FrontmatterKeys): Equation | null {
	const fm = info.frontmatter;
	if (!fm) return null;
	const latex = stripDelimiters(asText(fm[keys.latex]));
	if (latex.length === 0) return null;

	const name = asText(fm[keys.name]) || info.basename;
	const category = asText(fm[keys.category]) || UNCATEGORIZED;
	const note = asText(fm[keys.note]);
	const symbol = stripDelimiters(asText(fm[keys.symbol]));
	const usage = asList(fm[keys.usage]);
	const source = asText(fm[keys.source]);
	const text = extraText(fm, keys, info.body);

	return {
		id: info.path,
		name,
		latex,
		category,
		...(note.length > 0 ? { note } : {}),
		...(symbol.length > 0 ? { symbol } : {}),
		...(usage.length > 0 ? { usage } : {}),
		...(source.length > 0 ? { source } : {}),
		...(text.length > 0 ? { text } : {}),
		created: isoFromEpoch(info.ctime),
		modified: isoFromEpoch(info.mtime),
	};
}

/**
 * Text the search should see beyond the modelled fields: every other
 * frontmatter value (AltName, Function, Cond …) and the note body. Keys the
 * plugin models are excluded so they are not matched twice at a lower tier.
 */
export function extraText(
	fm: Readonly<Record<string, unknown>>,
	keys: FrontmatterKeys,
	body: string | undefined,
): string {
	const owned = new Set<string>(Object.values(keys));
	const parts: string[] = [];
	for (const [key, value] of Object.entries(fm)) {
		if (owned.has(key) || key === "position") continue;
		const text = asText(value);
		if (text.length > 0) parts.push(text);
	}
	if (body !== undefined && body.trim().length > 0) parts.push(body.trim());
	return parts.join("\n");
}

/** The fields the plugin may write, in the order a fresh note lists them. */
export interface WritableFields {
	readonly name?: string;
	readonly latex?: string;
	readonly symbol?: string;
	readonly category?: string;
	readonly note?: string;
}

/**
 * Frontmatter values for the plugin-owned fields. LaTeX and the symbol are
 * stored `$…$`-wrapped so an inline Dataview field renders them as math; the
 * reserved category is stored as a blank so a note never says "Uncategorized".
 */
export function fieldsToWrite(fields: WritableFields, keys: FrontmatterKeys): Array<readonly [string, FieldValue]> {
	const out: Array<readonly [string, FieldValue]> = [];
	if (fields.name !== undefined) out.push([keys.name, fields.name.trim()]);
	if (fields.symbol !== undefined) {
		const symbol = stripDelimiters(fields.symbol);
		out.push([keys.symbol, symbol.length > 0 ? `$${symbol}$` : ""]);
	}
	if (fields.latex !== undefined) {
		const latex = stripDelimiters(fields.latex);
		out.push([keys.latex, latex.length > 0 ? `$${latex}$` : ""]);
	}
	if (fields.category !== undefined) {
		const category = fields.category.trim();
		out.push([keys.category, category === UNCATEGORIZED ? "" : category]);
	}
	if (fields.note !== undefined) out.push([keys.note, fields.note.trim()]);
	return out;
}

/**
 * Which of an equation's writable fields differ between two readings, so a
 * save touches only the keys that changed. Absent optional fields compare as
 * empty strings.
 */
export function changedFields(before: Equation, after: Equation): WritableFields {
	const patch: { -readonly [K in keyof WritableFields]: WritableFields[K] } = {};
	if (before.name !== after.name) patch.name = after.name;
	if (before.latex !== after.latex) patch.latex = after.latex;
	if ((before.symbol ?? "") !== (after.symbol ?? "")) patch.symbol = after.symbol ?? "";
	if (before.category !== after.category) patch.category = after.category;
	if ((before.note ?? "") !== (after.note ?? "")) patch.note = after.note ?? "";
	return patch;
}

/** Characters that cannot appear in a file name or would break a wikilink. */
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;

/**
 * A file name for a new equation note: prefix, then the name with runs of
 * whitespace and unsafe characters collapsed to single hyphens, so
 * "Bayes' Theorem (2)" with prefix `eq-` gives `eq-Bayes'-Theorem-2`.
 */
export function fileStem(prefix: string, name: string): string {
	const cleaned = name
		.replace(UNSAFE, " ")
		.replace(/[()]/g, " ")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${prefix}${cleaned.length > 0 ? cleaned : "equation"}`;
}

/** The first of `stem`, `stem-2`, `stem-3` … that `exists` does not know. */
export function uniqueStem(stem: string, exists: (candidate: string) => boolean): string {
	if (!exists(stem)) return stem;
	for (let n = 2; ; n += 1) {
		const candidate = `${stem}-${n}`;
		if (!exists(candidate)) return candidate;
	}
}
