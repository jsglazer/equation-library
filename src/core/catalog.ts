/**
 * Catalog model operations: equations and categories.
 *
 * Every function is pure — it takes a catalog and returns a new catalog, never
 * mutating its input and never reading the clock, the filesystem or the DOM.
 * Timestamps and ids are supplied by the caller so that tests are deterministic.
 */
import {
	Catalog,
	CURRENT_SCHEMA_VERSION,
	Equation,
	Outcome,
	UNCATEGORIZED,
	fail,
	ok,
} from "./types";
import { stripDelimiters } from "./latex";

export interface NewEquation {
	readonly id: string;
	readonly name: string;
	readonly latex: string;
	readonly category: string;
	/** ISO timestamp; used for both `created` and `modified`. */
	readonly now: string;
}

/** An empty catalog containing only the reserved category. */
export function createCatalog(): Catalog {
	return { schemaVersion: CURRENT_SCHEMA_VERSION, categories: [UNCATEGORIZED], equations: [] };
}

/**
 * Disambiguates a name against names already in use by suffixing " (2)",
 * " (3)" and so on. Names are never silently overwritten.
 */
export function uniqueName(existing: readonly string[], desired: string): string {
	const taken = new Set(existing);
	const base = desired.trim();
	if (!taken.has(base)) return base;
	for (let n = 2; ; n += 1) {
		const candidate = `${base} (${n})`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Guarantees the reserved category exists and sits first in the list. */
export function ensureUncategorized(catalog: Catalog): Catalog {
	const rest = catalog.categories.filter((c) => c !== UNCATEGORIZED);
	return { ...catalog, categories: [UNCATEGORIZED, ...rest] };
}

export function addEquation(catalog: Catalog, input: NewEquation): Outcome<Catalog> {
	const latex = stripDelimiters(input.latex);
	if (latex.length === 0) return fail("An equation needs some LaTeX.");
	const name = input.name.trim();
	if (name.length === 0) return fail("An equation needs a name.");

	const category = input.category.trim() || UNCATEGORIZED;
	const equation: Equation = {
		id: input.id,
		name: uniqueName(catalog.equations.map((e) => e.name), name),
		latex,
		category,
		created: input.now,
		modified: input.now,
	};
	const categories = catalog.categories.includes(category)
		? catalog.categories
		: [...catalog.categories, category];
	return ok(ensureUncategorized({ ...catalog, categories, equations: [...catalog.equations, equation] }));
}

export function updateEquation(
	catalog: Catalog,
	id: string,
	patch: Partial<Pick<Equation, "name" | "latex" | "category">>,
	now: string,
): Outcome<Catalog> {
	const target = catalog.equations.find((e) => e.id === id);
	if (!target) return fail(`No equation with id ${id}.`);

	const name = patch.name === undefined ? target.name : patch.name.trim();
	if (name.length === 0) return fail("An equation needs a name.");
	const latex = patch.latex === undefined ? target.latex : stripDelimiters(patch.latex);
	if (latex.length === 0) return fail("An equation needs some LaTeX.");
	const category = (patch.category === undefined ? target.category : patch.category.trim()) || UNCATEGORIZED;

	const otherNames = catalog.equations.filter((e) => e.id !== id).map((e) => e.name);
	const updated: Equation = {
		...target,
		name: uniqueName(otherNames, name),
		latex,
		category,
		modified: now,
	};
	const categories = catalog.categories.includes(category)
		? catalog.categories
		: [...catalog.categories, category];
	return ok(
		ensureUncategorized({
			...catalog,
			categories,
			equations: catalog.equations.map((e) => (e.id === id ? updated : e)),
		}),
	);
}

export function deleteEquation(catalog: Catalog, id: string): Outcome<Catalog> {
	if (!catalog.equations.some((e) => e.id === id)) return fail(`No equation with id ${id}.`);
	return ok({ ...catalog, equations: catalog.equations.filter((e) => e.id !== id) });
}

export function addCategory(catalog: Catalog, name: string): Outcome<Catalog> {
	const category = name.trim();
	if (category.length === 0) return fail("A category needs a name.");
	if (catalog.categories.includes(category)) return fail(`The category "${category}" already exists.`);
	return ok(ensureUncategorized({ ...catalog, categories: [...catalog.categories, category] }));
}

/**
 * Renames a category and rewrites the `category` field on every member
 * equation in the same operation. The reserved category cannot be renamed.
 */
export function renameCategory(catalog: Catalog, from: string, to: string): Outcome<Catalog> {
	if (from === UNCATEGORIZED) return fail(`"${UNCATEGORIZED}" cannot be renamed.`);
	if (!catalog.categories.includes(from)) return fail(`No category named "${from}".`);
	const target = to.trim();
	if (target.length === 0) return fail("A category needs a name.");
	if (target === from) return ok(catalog);
	if (catalog.categories.includes(target)) return fail(`The category "${target}" already exists.`);

	return ok(
		ensureUncategorized({
			...catalog,
			categories: catalog.categories.map((c) => (c === from ? target : c)),
			equations: catalog.equations.map((e) => (e.category === from ? { ...e, category: target } : e)),
		}),
	);
}

/**
 * Deletes a category and reassigns its equations to the reserved category.
 * Equations are never deleted as a side effect of deleting a category.
 */
export function deleteCategory(catalog: Catalog, name: string): Outcome<Catalog> {
	if (name === UNCATEGORIZED) return fail(`"${UNCATEGORIZED}" cannot be deleted.`);
	if (!catalog.categories.includes(name)) return fail(`No category named "${name}".`);
	return ok(
		ensureUncategorized({
			...catalog,
			categories: catalog.categories.filter((c) => c !== name),
			equations: catalog.equations.map((e) =>
				e.category === name ? { ...e, category: UNCATEGORIZED } : e,
			),
		}),
	);
}

/** Categories in display order: the reserved one first, then the rest sorted. */
export function orderedCategories(catalog: Catalog): string[] {
	const rest = catalog.categories.filter((c) => c !== UNCATEGORIZED).slice().sort((a, b) => a.localeCompare(b));
	return [UNCATEGORIZED, ...rest];
}

/** How many equations sit in each category, keyed by category name. */
export function categoryCounts(catalog: Catalog): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const category of catalog.categories) counts[category] = 0;
	for (const equation of catalog.equations) {
		counts[equation.category] = (counts[equation.category] ?? 0) + 1;
	}
	return counts;
}
