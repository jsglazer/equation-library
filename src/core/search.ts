/**
 * Search, sorting and category filtering over the catalog, plus the matcher
 * the editor autocomplete uses.
 *
 * Pure module: no `obsidian`, DOM or Node imports, no clock, no I/O. Ranking
 * is fully deterministic — every comparison ends in a total order, so the same
 * inputs always produce the same list.
 */
import { Equation } from "./types";

export type SortOrder = "name" | "created" | "modified";

export interface SearchQuery {
	/** Free text; empty matches everything. */
	readonly text: string;
	/** `null` means "all categories". */
	readonly category: string | null;
	readonly sort: SortOrder;
}

export const DEFAULT_QUERY: SearchQuery = { text: "", category: null, sort: "name" };

/** Lowercases and drops everything that is not a letter or a digit. */
export function normalize(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Ranks one equation against a query. Lower is better; `null` means no match.
 *
 * The tiers are, in order: exact name, name prefix, word-start inside the
 * name, name substring, normalized-name substring (so "quadform" finds
 * "Quadratic Formula"), then a LaTeX substring match as the last resort.
 */
export function scoreEquation(equation: Equation, query: string): number | null {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return 0;

	const name = equation.name.toLowerCase();
	if (name === q) return 0;
	if (name.startsWith(q)) return 1;
	if (name.split(/\s+/).some((word) => word.startsWith(q))) return 2;
	if (name.includes(q)) return 3;

	const nq = normalize(query);
	if (nq.length > 0 && normalize(equation.name).includes(nq)) return 4;
	if (equation.latex.toLowerCase().includes(q)) return 5;
	return null;
}

function compareBy(order: SortOrder, a: Equation, b: Equation): number {
	if (order === "name") return a.name.localeCompare(b.name);
	const field = order === "created" ? "created" : "modified";
	// Most recent first for the time-based orders.
	const diff = b[field].localeCompare(a[field]);
	return diff !== 0 ? diff : a.name.localeCompare(b.name);
}

/** Sorts a copy of `equations`; ties break on id so the order is total. */
export function sortEquations(equations: readonly Equation[], order: SortOrder): Equation[] {
	return equations.slice().sort((a, b) => {
		const primary = compareBy(order, a, b);
		return primary !== 0 ? primary : a.id.localeCompare(b.id);
	});
}

/** Applies the category filter alone. */
export function filterByCategory(equations: readonly Equation[], category: string | null): Equation[] {
	if (category === null) return equations.slice();
	return equations.filter((e) => e.category === category);
}

/**
 * The library grid's query: category filter, then text ranking, then the
 * chosen sort order. With empty text the ranking tier is constant, so the
 * result is exactly the chosen sort.
 */
export function searchEquations(equations: readonly Equation[], query: SearchQuery): Equation[] {
	const scoped = filterByCategory(equations, query.category);
	const scored: Array<{ equation: Equation; score: number }> = [];
	for (const equation of scoped) {
		const score = scoreEquation(equation, query.text);
		if (score !== null) scored.push({ equation, score });
	}
	return scored
		.sort((a, b) => {
			if (a.score !== b.score) return a.score - b.score;
			const primary = compareBy(query.sort, a.equation, b.equation);
			return primary !== 0 ? primary : a.equation.id.localeCompare(b.equation.id);
		})
		.map((entry) => entry.equation);
}

/**
 * The autocomplete matcher. Ranked like the grid search but capped, and always
 * name-ordered within a tier so the popup list is stable as the user types.
 */
export function matchSuggestions(
	equations: readonly Equation[],
	query: string,
	limit: number,
): Equation[] {
	const results = searchEquations(equations, { text: query, category: null, sort: "name" });
	return limit > 0 ? results.slice(0, limit) : results;
}
