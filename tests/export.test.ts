import { describe, expect, it } from "vitest";
import {
	DEFAULT_MARKDOWN_LAYOUT,
	defaultExportFileName,
	renderTemplate,
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

describe("renderTemplate", () => {
	it("fills placeholders, tolerating spaces inside the braces", () => {
		expect(renderTemplate("## {{name}} ({{ category }})", { name: "Mean", category: "Stats" })).toBe("## Mean (Stats)");
	});

	it("drops a line whose placeholders are all empty, and keeps one with any filled", () => {
		const template = "{{name}}\nSource: {{source}}\n{{symbol}} {{name}}";
		expect(renderTemplate(template, { name: "Mean", source: "", symbol: "" })).toBe("Mean\n Mean");
	});

	it("keeps plain lines, blank lines included", () => {
		expect(renderTemplate("a\n\nb", {})).toBe("a\n\nb");
	});

	it("leaves an unknown placeholder as written", () => {
		expect(renderTemplate("{{nmae}}", { name: "Mean" })).toBe("{{nmae}}");
	});

	it("inserts values containing $ literally", () => {
		expect(renderTemplate("${{latex}}$", { latex: "$$x$$" })).toBe("$$$x$$$");
	});
});

describe("serializeMarkdown with a custom layout", () => {
	const catalog = {
		...mockCatalog(),
		categories: ["Statistics"],
		equations: [
			equation({
				id: "b",
				name: "Sample Mean",
				symbol: "\\bar{x}",
				latex: "\\frac{1}{n}\\sum x_i",
				category: "Statistics",
				usage: ["Moments", "Estimators"],
			}),
			equation({ id: "a", name: "Bayes", latex: "P(A|B)", category: "Statistics", source: "OpenStax" }),
		],
	};

	it("writes a bulleted list with no category headings", () => {
		const layout = { category: "", equation: "- **{{name}}**: ${{equation}}$" };
		expect(serializeMarkdown(catalog, layout)).toBe(
			"- **Bayes**: $P(A|B)$\n\n- **Sample Mean**: $\\bar{x} = \\frac{1}{n}\\sum x_i$\n",
		);
	});

	it("drops empty optional lines and collapses the blank lines they leave", () => {
		const layout = {
			category: "## {{category}}",
			equation: "### {{name}}\n\nSource: {{source}}\n\nUsage: {{usage}}\n\n$${{latex}}$$",
		};
		expect(serializeMarkdown(catalog, layout)).toBe(
			"## Statistics\n\n### Bayes\n\nSource: OpenStax\n\n$$P(A|B)$$\n\n" +
				"### Sample Mean\n\nUsage: Moments, Estimators\n\n$$\\frac{1}{n}\\sum x_i$$\n",
		);
	});

	it("matches the default layout when none is given", () => {
		expect(serializeMarkdown(catalog)).toBe(serializeMarkdown(catalog, DEFAULT_MARKDOWN_LAYOUT));
	});
});

describe("markdownLayout setting", () => {
	it("defaults both templates", () => {
		expect(normalizeSettings({}).markdownLayout).toEqual(DEFAULT_MARKDOWN_LAYOUT);
	});

	it("keeps an empty category template but restores a blank equation template", () => {
		const layout = normalizeSettings({ markdownLayout: { category: "", equation: "   " } }).markdownLayout;
		expect(layout).toEqual({ category: "", equation: DEFAULT_MARKDOWN_LAYOUT.equation });
	});

	it("discards templates of the wrong type", () => {
		expect(normalizeSettings({ markdownLayout: { category: 3, equation: null } }).markdownLayout).toEqual(
			DEFAULT_MARKDOWN_LAYOUT,
		);
	});
});
