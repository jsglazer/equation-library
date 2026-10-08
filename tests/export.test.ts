import { describe, expect, it } from "vitest";
import {
	defaultExportFileName,
	selectForExport,
	serializeExport,
	serializeMarkdown,
} from "../src/core/export";
import { parseCatalog } from "../src/core/import-export";
import { normalizeSettings } from "../src/core/settings";
import { UNCATEGORIZED } from "../src/core/types";
import { equation, expectOk, mockCatalog } from "./fixtures";

describe("selectForExport", () => {
	it("returns the whole catalog for All", () => {
		const catalog = mockCatalog();
		expect(selectForExport(catalog, null)).toBe(catalog);
	});

	it("narrows the equations and the category list to one category", () => {
		const selected = selectForExport(mockCatalog(), "Algebra");
		expect(selected.equations.map((e) => e.name)).toEqual(["Quadratic Formula", "Euler Identity"]);
		expect(selected.categories).toEqual(["Algebra"]);
	});
});

describe("serializeMarkdown", () => {
	it("writes a heading per category and per equation, with the LaTeX in a $$ block", () => {
		const markdown = serializeMarkdown(mockCatalog());
		expect(markdown).toContain("# Algebra\n\n## Euler Identity\n\n$$\ne^{i\\pi} + 1 = 0\n$$");
		expect(markdown).toContain("# Calculus\n\n## Power Rule");
	});

	it("orders categories Uncategorized first then A–Z, and equations by name", () => {
		const markdown = serializeMarkdown(mockCatalog());
		const headings = markdown.split("\n").filter((line) => line.startsWith("#"));
		expect(headings).toEqual([
			`# ${UNCATEGORIZED}`,
			"## Scratch Note",
			"# Algebra",
			"## Euler Identity",
			"## Quadratic Formula",
			"# Calculus",
			"## Power Rule",
		]);
	});

	it("leaves out empty categories", () => {
		const catalog = { ...mockCatalog(), categories: [UNCATEGORIZED, "Algebra", "Calculus", "Empty"] };
		expect(serializeMarkdown(catalog)).not.toContain("# Empty");
	});

	it("puts the symbol in front of the equation and the note below it", () => {
		const catalog = {
			...mockCatalog(),
			categories: ["Statistics"],
			equations: [
				equation({
					id: "a",
					name: "Bayes Theorem",
					symbol: "P(A|B)",
					latex: "\\frac{P(B|A)P(A)}{P(B)}",
					category: "Statistics",
					note: "Posterior from likelihood and prior.\nSecond line.",
				}),
			],
		};
		expect(serializeMarkdown(catalog)).toBe(
			"# Statistics\n\n## Bayes Theorem\n\n$$\nP(A|B) = \\frac{P(B|A)P(A)}{P(B)}\n$$\n\nPosterior from likelihood and prior.\nSecond line.\n",
		);
	});

	it("still exports an equation whose category is not in the list", () => {
		const catalog = {
			...mockCatalog(),
			equations: [equation({ id: "x", name: "Stray", category: "Physics" })],
		};
		expect(serializeMarkdown(catalog)).toContain("# Physics\n\n## Stray");
	});
});

describe("serializeExport", () => {
	it("writes JSON that imports back", () => {
		const json = serializeExport(selectForExport(mockCatalog(), "Calculus"), "json");
		const parsed = expectOk(parseCatalog(json));
		expect(parsed.catalog.equations.map((e) => e.name)).toEqual(["Power Rule"]);
	});

	it("writes Markdown for the markdown format", () => {
		expect(serializeExport(mockCatalog(), "markdown").startsWith("# ")).toBe(true);
	});
});

describe("defaultExportFileName", () => {
	it("names the whole library and a single category", () => {
		expect(defaultExportFileName("markdown", null)).toBe("Equation Library.md");
		expect(defaultExportFileName("json", "Statistics")).toBe("Equation Library - Statistics.json");
	});

	it("replaces characters a file name cannot hold", () => {
		expect(defaultExportFileName("markdown", "Prob/Stats: #1")).toBe("Equation Library - Prob-Stats- -1.md");
	});
});

describe("exportFormat setting", () => {
	it("defaults to Markdown and rejects an unknown format", () => {
		expect(normalizeSettings({}).exportFormat).toBe("markdown");
		expect(normalizeSettings({ exportFormat: "json" }).exportFormat).toBe("json");
		expect(normalizeSettings({ exportFormat: "pdf" }).exportFormat).toBe("markdown");
	});
});
