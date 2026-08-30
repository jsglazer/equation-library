import { describe, expect, it } from "vitest";
import { migrateCatalog } from "../src/core/migrate";
import { CURRENT_SCHEMA_VERSION, UNCATEGORIZED } from "../src/core/types";
import { mockCatalog } from "./fixtures";

describe("migrateCatalog", () => {
	it("carries a note across and drops a blank or non-string one", () => {
		const result = migrateCatalog({
			schemaVersion: 1,
			categories: ["Algebra"],
			equations: [
				{ id: "a", name: "Kept", latex: "x", category: "Algebra", note: "  keep me  " },
				{ id: "b", name: "Blank", latex: "y", category: "Algebra", note: "   " },
				{ id: "c", name: "Wrong type", latex: "z", category: "Algebra", note: 7 },
			],
		});
		expect(result.catalog.equations[0].note).toBe("keep me");
		expect(result.catalog.equations[1]).not.toHaveProperty("note");
		expect(result.catalog.equations[2]).not.toHaveProperty("note");
	});

	it("passes a current catalog through unchanged", () => {
		const before = mockCatalog();
		const result = migrateCatalog(JSON.parse(JSON.stringify(before)));
		expect(result.catalog.equations).toEqual(before.equations);
		expect(result.warnings).toEqual([]);
		expect(result.migrated).toBe(false);
	});

	it("returns an empty catalog for null or undefined", () => {
		for (const input of [null, undefined]) {
			const result = migrateCatalog(input);
			expect(result.catalog.equations).toEqual([]);
			expect(result.catalog.categories).toEqual([UNCATEGORIZED]);
		}
	});

	it("wraps a bare array of equations, which is the pre-schema layout", () => {
		const result = migrateCatalog([{ id: "a", name: "Old", latex: "$x^2$", category: "Legacy" }]);
		expect(result.catalog.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(result.catalog.equations).toHaveLength(1);
		expect(result.catalog.equations[0].latex).toBe("x^2");
		expect(result.catalog.categories).toContain("Legacy");
		expect(result.migrated).toBe(true);
	});

	it("starts fresh on a non-object catalog", () => {
		const result = migrateCatalog("nonsense");
		expect(result.catalog.equations).toEqual([]);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("drops entries with no usable LaTeX and keeps the rest", () => {
		const result = migrateCatalog({
			schemaVersion: 1,
			categories: [],
			equations: [{ id: "a", name: "Good", latex: "x" }, { id: "b", name: "Bad" }, "junk"],
		});
		expect(result.catalog.equations.map((e) => e.id)).toEqual(["a"]);
		expect(result.warnings).toHaveLength(2);
	});

	it("names an unnamed equation and files it under the reserved category", () => {
		const result = migrateCatalog({ schemaVersion: 1, equations: [{ id: "a", latex: "x" }] });
		expect(result.catalog.equations[0].name).toBe("Equation 1");
		expect(result.catalog.equations[0].category).toBe(UNCATEGORIZED);
	});

	it("disambiguates duplicate names and re-keys duplicate ids", () => {
		const result = migrateCatalog({
			schemaVersion: 1,
			equations: [
				{ id: "dup", name: "Same", latex: "a" },
				{ id: "dup", name: "Same", latex: "b" },
			],
		});
		expect(result.catalog.equations.map((e) => e.name)).toEqual(["Same", "Same (2)"]);
		expect(new Set(result.catalog.equations.map((e) => e.id)).size).toBe(2);
	});

	it("adds every category an equation references", () => {
		const result = migrateCatalog({ schemaVersion: 1, categories: [], equations: [{ id: "a", name: "N", latex: "x", category: "Ghost" }] });
		expect(result.catalog.categories).toEqual([UNCATEGORIZED, "Ghost"]);
	});

	it("warns but still reads a catalog from a future schema version", () => {
		const result = migrateCatalog({ schemaVersion: 99, categories: ["X"], equations: [{ id: "a", name: "N", latex: "x", category: "X" }] });
		expect(result.catalog.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(result.catalog.equations).toHaveLength(1);
		expect(result.warnings.some((w) => w.includes("99"))).toBe(true);
	});

	it("always puts the reserved category first", () => {
		const result = migrateCatalog({ schemaVersion: 1, categories: ["Zeta", "Alpha"], equations: [] });
		expect(result.catalog.categories[0]).toBe(UNCATEGORIZED);
	});
});
