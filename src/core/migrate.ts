/**
 * Catalog migration and validation.
 *
 * `migrateCatalog` accepts anything that came off disk — including a corrupt
 * or hand-edited file — and always returns a usable catalog plus a list of
 * warnings. It never throws.
 *
 * Pure module: no `obsidian`, DOM or Node imports.
 */
import { Catalog, CURRENT_SCHEMA_VERSION, Equation, UNCATEGORIZED } from "./types";
import { createCatalog, ensureUncategorized, uniqueName } from "./catalog";
import { stripDelimiters } from "./latex";

export interface MigrationResult {
	readonly catalog: Catalog;
	/** True when the input differed from what was written back. */
	readonly migrated: boolean;
	readonly warnings: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readEquation(value: unknown, index: number, warnings: string[]): Equation | null {
	const record = asRecord(value);
	if (!record) {
		warnings.push(`Entry ${index} is not an object and was dropped.`);
		return null;
	}
	const latexSource = typeof record.latex === "string" ? record.latex : "";
	const latex = stripDelimiters(latexSource);
	if (latex.length === 0) {
		warnings.push(`Entry ${index} has no LaTeX and was dropped.`);
		return null;
	}
	const name = typeof record.name === "string" && record.name.trim().length > 0
		? record.name.trim()
		: `Equation ${index + 1}`;
	const id = typeof record.id === "string" && record.id.length > 0 ? record.id : `legacy-${index}`;
	const category = typeof record.category === "string" && record.category.trim().length > 0
		? record.category.trim()
		: UNCATEGORIZED;
	const created = typeof record.created === "string" ? record.created : "";
	const modified = typeof record.modified === "string" ? record.modified : created;
	// A blank or non-string note is simply absent; the field is optional.
	const note = typeof record.note === "string" && record.note.trim().length > 0
		? record.note.trim()
		: undefined;
	return { id, name, latex, category, ...(note !== undefined ? { note } : {}), created, modified };
}

/**
 * Upgrades a raw parsed catalog to the current schema.
 *
 * Recognised shapes: the current object form, a bare array of equations (the
 * pre-schemaVersion layout), and anything else, which yields an empty catalog
 * with a warning. Duplicate names and ids are disambiguated rather than
 * dropped, and every category referenced by an equation is added to the
 * category list.
 */
export function migrateCatalog(raw: unknown): MigrationResult {
	const warnings: string[] = [];

	if (raw === null || raw === undefined) {
		return { catalog: createCatalog(), migrated: false, warnings };
	}

	let rawEquations: unknown[] = [];
	let rawCategories: string[] = [];
	let version = 0;

	if (Array.isArray(raw)) {
		warnings.push("Catalog was a bare array; wrapped in the current schema.");
		rawEquations = raw;
	} else {
		const record = asRecord(raw);
		if (!record) {
			warnings.push("Catalog was not an object; started an empty catalog.");
			return { catalog: createCatalog(), migrated: true, warnings };
		}
		version = typeof record.schemaVersion === "number" ? record.schemaVersion : 0;
		if (version > CURRENT_SCHEMA_VERSION) {
			warnings.push(
				`Catalog schemaVersion ${version} is newer than this plugin understands (${CURRENT_SCHEMA_VERSION}); reading it as best we can.`,
			);
		}
		rawEquations = Array.isArray(record.equations) ? record.equations : [];
		rawCategories = Array.isArray(record.categories)
			? record.categories.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim())
			: [];
		if (!Array.isArray(record.equations)) {
			warnings.push("Catalog had no equations array; started an empty list.");
		}
	}

	const usedNames: string[] = [];
	const usedIds = new Set<string>();
	const equations: Equation[] = [];
	rawEquations.forEach((value, index) => {
		const parsed = readEquation(value, index, warnings);
		if (!parsed) return;
		let id = parsed.id;
		if (usedIds.has(id)) {
			id = `${parsed.id}-${index}`;
			warnings.push(`Entry ${index} had a duplicate id; re-keyed as ${id}.`);
		}
		usedIds.add(id);
		const name = uniqueName(usedNames, parsed.name);
		if (name !== parsed.name) warnings.push(`Renamed duplicate "${parsed.name}" to "${name}".`);
		usedNames.push(name);
		equations.push({ ...parsed, id, name });
	});

	const categories = new Set<string>([UNCATEGORIZED, ...rawCategories]);
	for (const equation of equations) categories.add(equation.category);

	const catalog = ensureUncategorized({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		categories: [...categories],
		equations,
	});
	const migrated = version !== CURRENT_SCHEMA_VERSION || warnings.length > 0;
	return { catalog, migrated, warnings };
}
