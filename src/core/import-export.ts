/**
 * Import and export of the catalog.
 *
 * `parseCatalog` validates a pasted JSON blob and returns a result object
 * carrying errors — it never throws. `mergeCatalog` folds an imported catalog
 * into the current one without losing anything.
 *
 * Pure module: no `obsidian`, DOM or Node imports.
 */
import { Catalog, Equation, Outcome, fail, ok } from "./types";
import { migrateCatalog } from "./migrate";
import { uniqueName } from "./catalog";

export interface ParsedCatalog {
	readonly catalog: Catalog;
	readonly warnings: readonly string[];
}

/**
 * Parses and validates catalog JSON. Malformed JSON is an error; a structurally
 * odd but readable catalog is accepted with warnings, exactly as a catalog read
 * from disk would be.
 */
export function parseCatalog(text: string): Outcome<ParsedCatalog> {
	const trimmed = text.trim();
	if (trimmed.length === 0) return fail("Nothing to import — the text is empty.");

	let raw: unknown;
	try {
		raw = JSON.parse(trimmed);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return fail(`That is not valid JSON: ${detail}`);
	}

	const result = migrateCatalog(raw);
	if (result.catalog.equations.length === 0) {
		return fail("No usable equations were found in that JSON.");
	}
	return ok({ catalog: result.catalog, warnings: result.warnings });
}

export interface MergeReport {
	readonly catalog: Catalog;
	readonly added: number;
	readonly renamed: number;
	readonly skipped: number;
}

/**
 * Merges `incoming` into `base`.
 *
 * An equation whose id already exists and whose LaTeX is identical is skipped;
 * anything else is added, with a fresh id from `mintId` when the id collides
 * and a disambiguated name when the name collides. Nothing in `base` is ever
 * overwritten or removed.
 */
export function mergeCatalog(
	base: Catalog,
	incoming: Catalog,
	mintId: (index: number) => string,
): MergeReport {
	const byId = new Map(base.equations.map((e) => [e.id, e]));
	const names = base.equations.map((e) => e.name);
	const categories = new Set(base.categories);
	const equations: Equation[] = base.equations.slice();

	let added = 0;
	let renamed = 0;
	let skipped = 0;

	incoming.equations.forEach((candidate, index) => {
		const existing = byId.get(candidate.id);
		if (existing && existing.latex === candidate.latex) {
			skipped += 1;
			return;
		}
		const id = existing ? mintId(index) : candidate.id;
		const name = uniqueName(names, candidate.name);
		if (name !== candidate.name) renamed += 1;
		names.push(name);
		categories.add(candidate.category);
		byId.set(id, { ...candidate, id, name });
		equations.push({ ...candidate, id, name });
		added += 1;
	});

	for (const category of incoming.categories) categories.add(category);

	return {
		catalog: { ...base, categories: [...categories], equations },
		added,
		renamed,
		skipped,
	};
}

/** Pretty-printed catalog JSON, which is what both save and export write. */
export function serializeCatalog(catalog: Catalog): string {
	return JSON.stringify(catalog, null, 2) + "\n";
}
