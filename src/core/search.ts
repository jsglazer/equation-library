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
	/** A `Usage` tag every result must carry; `null` or absent means "any". */
	readonly usage?: string | null;
	readonly sort: SortOrder;
	/**
	 * Whether note text counts as a match. The library grid searches notes;
	 * the editor autocomplete does not, so typing a word that happens to sit
	 * in someone's note does not fill the popup with unrelated equations.
	 */
	readonly searchNotes?: boolean;
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
 * "Quadratic Formula"), the note text, a LaTeX substring match, the symbol,
 * usage tags and source, and finally the note's other text (body and
 * unmodelled frontmatter) as the last resort. Pass `searchNotes: false` to
 * skip the note tier and everything below the LaTeX tier, which is what the
 * autocomplete does so a common word in a note body never floods the popup.
 */
export function scoreEquation(equation: Equation, query: string, searchNotes = true): number | null {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return 0;

	const name = equation.name.toLowerCase();
	if (name === q) return 0;
	if (name.startsWith(q)) return 1;
	if (name.split(/\s+/).some((word) => word.startsWith(q))) return 2;
	if (name.includes(q)) return 3;

	const nq = normalize(query);
	if (nq.length > 0 && normalize(equation.name).includes(nq)) return 4;
	if (searchNotes && (equation.note ?? "").toLowerCase().includes(q)) return 5;
	if (equation.latex.toLowerCase().includes(q)) return 6;
	if (!searchNotes) return null;
	if ((equation.symbol ?? "").toLowerCase().includes(q)) return 7;
	if ((equation.usage ?? []).some((tag) => tag.toLowerCase().includes(q))) return 7;
	if ((equation.source ?? "").toLowerCase().includes(q)) return 7;
	if ((equation.text ?? "").toLowerCase().includes(q)) return 8;
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

/** Applies the usage-tag filter alone; the comparison ignores case. */
export function filterByUsage(equations: readonly Equation[], usage: string | null | undefined): Equation[] {
	if (usage === null || usage === undefined) return equations.slice();
	const wanted = usage.toLowerCase();
	return equations.filter((e) => (e.usage ?? []).some((tag) => tag.toLowerCase() === wanted));
}

/** Every distinct usage tag in the library, sorted, first spelling wins. */
export function allUsages(equations: readonly Equation[]): string[] {
	const seen = new Map<string, string>();
	for (const equation of equations) {
		for (const tag of equation.usage ?? []) {
			const key = tag.toLowerCase();
			if (!seen.has(key)) seen.set(key, tag);
		}
	}
	return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The library grid's query: category filter, then text ranking, then the
 * chosen sort order. With empty text the ranking tier is constant, so the
 * result is exactly the chosen sort.
 */
export function searchEquations(equations: readonly Equation[], query: SearchQuery): Equation[] {
	const scoped = filterByUsage(filterByCategory(equations, query.category), query.usage);
	const scored: Array<{ equation: Equation; score: number }> = [];
	for (const equation of scoped) {
		const score = scoreEquation(equation, query.text, query.searchNotes !== false);
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
	const results = searchEquations(equations, {
		text: query,
		category: null,
		sort: "name",
		searchNotes: false,
	});
	return limit > 0 ? results.slice(0, limit) : results;
}
