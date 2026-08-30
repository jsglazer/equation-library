import { describe, expect, it } from "vitest";
import {
	filterByCategory,
	matchSuggestions,
	normalize,
	scoreEquation,
	searchEquations,
	sortEquations,
} from "../src/core/search";
import { UNCATEGORIZED } from "../src/core/types";
import { equation, mockCatalog } from "./fixtures";

const CATALOG = mockCatalog();

describe("normalize", () => {
	it("lowercases and drops non-alphanumerics", () => {
		expect(normalize("Quadratic Formula!")).toBe("quadraticformula");
	});
});

describe("scoreEquation", () => {
	const target = equation({ id: "e", name: "Quadratic Formula", latex: "\\frac{-b}{2a}" });

	it("scores an empty query as a neutral match", () => {
		expect(scoreEquation(target, "  ")).toBe(0);
	});

	it("ranks exact, prefix, word-start and substring in that order", () => {
		expect(scoreEquation(target, "quadratic formula")).toBe(0);
		expect(scoreEquation(target, "quad")).toBe(1);
		expect(scoreEquation(target, "form")).toBe(2);
		expect(scoreEquation(target, "ratic")).toBe(3);
	});

	it("falls back to the normalized name, then the note, then the LaTeX", () => {
		expect(scoreEquation(target, "quadraticfor")).toBe(4);
		expect(scoreEquation(target, "\\frac")).toBe(6);
		const noted = equation({ id: "n", name: "Roots", latex: "x", note: "Solves ax^2 + bx + c" });
		expect(scoreEquation(noted, "solves")).toBe(5);
	});

	it("skips the note tier when notes are excluded", () => {
		const noted = equation({ id: "n", name: "Roots", latex: "x", note: "Solves ax^2 + bx + c" });
		expect(scoreEquation(noted, "solves", false)).toBeNull();
	});

	it("returns null when nothing matches", () => {
		expect(scoreEquation(target, "zzz")).toBeNull();
	});
});

describe("filterByCategory", () => {
	it("returns everything for a null category", () => {
		expect(filterByCategory(CATALOG.equations, null)).toHaveLength(4);
	});

	it("returns only members of the named category", () => {
		expect(filterByCategory(CATALOG.equations, "Algebra").map((e) => e.id)).toEqual(["eq-quadratic", "eq-euler"]);
		expect(filterByCategory(CATALOG.equations, UNCATEGORIZED).map((e) => e.id)).toEqual(["eq-loose"]);
	});

	it("returns an empty list for an unknown category", () => {
		expect(filterByCategory(CATALOG.equations, "Nope")).toEqual([]);
	});
});

describe("sortEquations", () => {
	it("sorts by name", () => {
		expect(sortEquations(CATALOG.equations, "name").map((e) => e.name)).toEqual([
			"Euler Identity",
			"Power Rule",
			"Quadratic Formula",
			"Scratch Note",
		]);
	});

	it("sorts newest-first by created and by modified", () => {
		expect(sortEquations(CATALOG.equations, "created").map((e) => e.id)).toEqual([
			"eq-loose",
			"eq-derivative",
			"eq-euler",
			"eq-quadratic",
		]);
		expect(sortEquations(CATALOG.equations, "modified").map((e) => e.id)).toEqual([
			"eq-derivative",
			"eq-quadratic",
			"eq-loose",
			"eq-euler",
		]);
	});

	it("breaks ties on id so the order is total", () => {
		const tied = [
			equation({ id: "b", name: "Same" }),
			equation({ id: "a", name: "Same" }),
		];
		expect(sortEquations(tied, "name").map((e) => e.id)).toEqual(["a", "b"]);
		expect(sortEquations(tied.slice().reverse(), "name").map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("does not mutate its input", () => {
		const before = CATALOG.equations.map((e) => e.id);
		sortEquations(CATALOG.equations, "created");
		expect(CATALOG.equations.map((e) => e.id)).toEqual(before);
	});
});

describe("searchEquations", () => {
	it("with no text is exactly the chosen sort", () => {
		const result = searchEquations(CATALOG.equations, { text: "", category: null, sort: "name" });
		expect(result.map((e) => e.name)).toEqual(sortEquations(CATALOG.equations, "name").map((e) => e.name));
	});

	it("applies the category filter before ranking", () => {
		const result = searchEquations(CATALOG.equations, { text: "e", category: "Calculus", sort: "name" });
		expect(result.map((e) => e.id)).toEqual(["eq-derivative"]);
	});

	it("puts the better-ranked match first regardless of alphabetical order", () => {
		const result = searchEquations(CATALOG.equations, { text: "power", category: null, sort: "name" });
		expect(result[0].id).toBe("eq-derivative");
	});

	it("drops non-matches", () => {
		expect(searchEquations(CATALOG.equations, { text: "zzzz", category: null, sort: "name" })).toEqual([]);
	});

	it("is deterministic across repeated calls", () => {
		const query = { text: "e", category: null, sort: "name" } as const;
		expect(searchEquations(CATALOG.equations, query)).toEqual(searchEquations(CATALOG.equations, query));
	});
});

describe("matchSuggestions", () => {
	it("lists everything for an empty query, capped by the limit", () => {
		expect(matchSuggestions(CATALOG.equations, "", 2).map((e) => e.name)).toEqual(["Euler Identity", "Power Rule"]);
	});

	it("matches a query that runs the words together, which is what the trigger charset forces", () => {
		expect(matchSuggestions(CATALOG.equations, "quadraticfor", 10).map((e) => e.id)).toEqual(["eq-quadratic"]);
	});

	it("returns everything when the limit is zero or negative", () => {
		expect(matchSuggestions(CATALOG.equations, "", 0)).toHaveLength(4);
	});
});
