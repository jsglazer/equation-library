import { describe, expect, it } from "vitest";
import {
	addCategory,
	addEquation,
	categoryCounts,
	createCatalog,
	deleteCategory,
	deleteEquation,
	orderedCategories,
	renameCategory,
	uniqueName,
	updateEquation,
} from "../src/core/catalog";
import { UNCATEGORIZED } from "../src/core/types";
import { expectOk, mockCatalog } from "./fixtures";

const NOW = "2026-02-01T12:00:00.000Z";

describe("uniqueName", () => {
	it("keeps a free name", () => {
		expect(uniqueName(["a", "b"], "c")).toBe("c");
	});

	it("suffixes (2) then (3) rather than overwriting", () => {
		expect(uniqueName(["Euler"], "Euler")).toBe("Euler (2)");
		expect(uniqueName(["Euler", "Euler (2)"], "Euler")).toBe("Euler (3)");
	});
});

describe("addEquation", () => {
	it("adds an equation with bare LaTeX and both timestamps", () => {
		const catalog = expectOk(
			addEquation(createCatalog(), {
				id: "id-1",
				name: "  Pythagoras  ",
				latex: "$a^2 + b^2 = c^2$",
				category: "Geometry",
				now: NOW,
			}),
		);
		expect(catalog.equations).toHaveLength(1);
		expect(catalog.equations[0]).toEqual({
			id: "id-1",
			name: "Pythagoras",
			latex: "a^2 + b^2 = c^2",
			category: "Geometry",
			created: NOW,
			modified: NOW,
		});
		expect(catalog.categories).toContain("Geometry");
	});

	it("disambiguates a duplicate name instead of overwriting", () => {
		const base = mockCatalog();
		const catalog = expectOk(
			addEquation(base, { id: "id-2", name: "Euler Identity", latex: "e^{i\\tau} = 1", category: "Algebra", now: NOW }),
		);
		expect(catalog.equations).toHaveLength(base.equations.length + 1);
		expect(catalog.equations[catalog.equations.length - 1].name).toBe("Euler Identity (2)");
		expect(catalog.equations.find((e) => e.id === "eq-euler")?.latex).toBe("e^{i\\pi} + 1 = 0");
	});

	it("falls back to the reserved category when none is given", () => {
		const catalog = expectOk(addEquation(createCatalog(), { id: "id-3", name: "Loose", latex: "x", category: "  ", now: NOW }));
		expect(catalog.equations[0].category).toBe(UNCATEGORIZED);
	});

	it("rejects an empty name or empty LaTeX", () => {
		expect(addEquation(createCatalog(), { id: "a", name: " ", latex: "x", category: "", now: NOW }).ok).toBe(false);
		expect(addEquation(createCatalog(), { id: "a", name: "n", latex: " $$ ", category: "", now: NOW }).ok).toBe(false);
	});

	it("does not mutate its input", () => {
		const base = createCatalog();
		const snapshot = JSON.stringify(base);
		expectOk(addEquation(base, { id: "id-4", name: "N", latex: "x", category: "C", now: NOW }));
		expect(JSON.stringify(base)).toBe(snapshot);
	});
});

describe("updateEquation", () => {
	it("patches fields and bumps modified but not created", () => {
		const catalog = expectOk(updateEquation(mockCatalog(), "eq-euler", { latex: "$$e^{i\\pi} = -1$$" }, NOW));
		const updated = catalog.equations.find((e) => e.id === "eq-euler");
		expect(updated?.latex).toBe("e^{i\\pi} = -1");
		expect(updated?.modified).toBe(NOW);
		expect(updated?.created).toBe("2026-01-02T00:00:00.000Z");
	});

	it("keeps its own name when nothing else changes", () => {
		const catalog = expectOk(updateEquation(mockCatalog(), "eq-euler", { name: "Euler Identity" }, NOW));
		expect(catalog.equations.find((e) => e.id === "eq-euler")?.name).toBe("Euler Identity");
	});

	it("disambiguates against other equations", () => {
		const catalog = expectOk(updateEquation(mockCatalog(), "eq-euler", { name: "Power Rule" }, NOW));
		expect(catalog.equations.find((e) => e.id === "eq-euler")?.name).toBe("Power Rule (2)");
	});

	it("reports an unknown id", () => {
		expect(updateEquation(mockCatalog(), "nope", { name: "x" }, NOW).ok).toBe(false);
	});
});

describe("deleteEquation", () => {
	it("removes one equation and leaves the rest", () => {
		const catalog = expectOk(deleteEquation(mockCatalog(), "eq-euler"));
		expect(catalog.equations.map((e) => e.id)).toEqual(["eq-quadratic", "eq-derivative", "eq-loose"]);
	});

	it("reports an unknown id", () => {
		expect(deleteEquation(mockCatalog(), "nope").ok).toBe(false);
	});
});

describe("addCategory", () => {
	it("adds a trimmed category", () => {
		const catalog = expectOk(addCategory(mockCatalog(), "  Statistics "));
		expect(catalog.categories).toContain("Statistics");
	});

	it("rejects a blank or duplicate name", () => {
		expect(addCategory(mockCatalog(), "   ").ok).toBe(false);
		expect(addCategory(mockCatalog(), "Algebra").ok).toBe(false);
	});
});

describe("renameCategory", () => {
	it("rewrites the category on every member equation", () => {
		const catalog = expectOk(renameCategory(mockCatalog(), "Algebra", "Classic Algebra"));
		expect(catalog.categories).toContain("Classic Algebra");
		expect(catalog.categories).not.toContain("Algebra");
		expect(catalog.equations.filter((e) => e.category === "Classic Algebra").map((e) => e.id)).toEqual([
			"eq-quadratic",
			"eq-euler",
		]);
		expect(catalog.equations.some((e) => e.category === "Algebra")).toBe(false);
	});

	it("leaves non-member equations alone", () => {
		const catalog = expectOk(renameCategory(mockCatalog(), "Algebra", "Classic Algebra"));
		expect(catalog.equations.find((e) => e.id === "eq-derivative")?.category).toBe("Calculus");
	});

	it("refuses to rename the reserved category", () => {
		expect(renameCategory(mockCatalog(), UNCATEGORIZED, "Misc").ok).toBe(false);
	});

	it("refuses a collision and an unknown source", () => {
		expect(renameCategory(mockCatalog(), "Algebra", "Calculus").ok).toBe(false);
		expect(renameCategory(mockCatalog(), "Nope", "New").ok).toBe(false);
	});

	it("is a no-op when the name is unchanged", () => {
		const before = mockCatalog();
		expect(expectOk(renameCategory(before, "Algebra", "Algebra"))).toEqual(before);
	});
});

describe("deleteCategory", () => {
	it("reassigns members to the reserved category and deletes no equations", () => {
		const before = mockCatalog();
		const catalog = expectOk(deleteCategory(before, "Algebra"));
		expect(catalog.categories).not.toContain("Algebra");
		expect(catalog.equations).toHaveLength(before.equations.length);
		expect(catalog.equations.find((e) => e.id === "eq-quadratic")?.category).toBe(UNCATEGORIZED);
		expect(catalog.equations.find((e) => e.id === "eq-euler")?.category).toBe(UNCATEGORIZED);
		expect(catalog.equations.find((e) => e.id === "eq-derivative")?.category).toBe("Calculus");
	});

	it("refuses to delete the reserved category", () => {
		expect(deleteCategory(mockCatalog(), UNCATEGORIZED).ok).toBe(false);
	});

	it("reports an unknown category", () => {
		expect(deleteCategory(mockCatalog(), "Nope").ok).toBe(false);
	});
});

describe("category listing", () => {
	it("always puts the reserved category first, then sorts", () => {
		const catalog = expectOk(addCategory(mockCatalog(), "Analysis"));
		expect(orderedCategories(catalog)).toEqual([UNCATEGORIZED, "Algebra", "Analysis", "Calculus"]);
	});

	it("counts members per category, including empty ones", () => {
		const catalog = expectOk(addCategory(mockCatalog(), "Empty"));
		expect(categoryCounts(catalog)).toEqual({ [UNCATEGORIZED]: 1, Algebra: 2, Calculus: 1, Empty: 0 });
	});
});
