/**
 * Export of the library to a file: which equations go out, in which format,
 * and under what default file name.
 *
 * The JSON format is the re-importable catalog (`serializeCatalog`); Markdown
 * is a readable document with one heading per category and one per equation.
 *
 * Pure module: no `obsidian`, DOM or Node imports.
 */
import { Catalog, Equation } from "./types";
import { orderedCategories } from "./catalog";
import { serializeCatalog } from "./import-export";

export type ExportFormat = "markdown" | "json";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["markdown", "json"];

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
	markdown: "Markdown (.md)",
	json: "JSON (.json, re-importable)",
};

const EXTENSIONS: Record<ExportFormat, string> = { markdown: "md", json: "json" };
const MIME_TYPES: Record<ExportFormat, string> = { markdown: "text/markdown", json: "application/json" };

export function exportExtension(format: ExportFormat): string {
	return EXTENSIONS[format];
}

export function exportMimeType(format: ExportFormat): string {
	return MIME_TYPES[format];
}

/**
 * The catalog narrowed to one category, or the whole catalog when `category`
 * is null. The category list is narrowed with it, so a JSON export of one
 * category does not drag every other category name along.
 */
export function selectForExport(catalog: Catalog, category: string | null): Catalog {
	if (category === null) return catalog;
	return {
		...catalog,
		categories: [category],
		equations: catalog.equations.filter((e) => e.category === category),
	};
}

/**
 * The Markdown layout, as two templates. `{{placeholder}}` fields are filled
 * from each equation; see `MARKDOWN_PLACEHOLDERS`.
 */
export interface MarkdownLayout {
	/** Written once before each category's equations; empty for no category headings. */
	readonly category: string;
	/** Written once per equation. */
	readonly equation: string;
}

export const DEFAULT_MARKDOWN_LAYOUT: MarkdownLayout = {
	category: "# {{category}}",
	equation: "## {{name}}\n\n$$\n{{equation}}\n$$\n\n{{note}}",
};

/** Every placeholder a template may use, with what it becomes. */
export const MARKDOWN_PLACEHOLDERS: Record<string, string> = {
	category: "the category name",
	name: "the equation's name",
	equation: "symbol = LaTeX, or just the LaTeX when there is no symbol",
	latex: "the LaTeX alone",
	symbol: "the symbol alone",
	note: "the note",
	usage: "the usage tags, comma-separated",
	source: "the source",
};

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Fills a template's placeholders from `values`. A line whose placeholders all
 * come out empty is dropped, so `Source: {{source}}` disappears for an equation
 * with no source instead of leaving a dangling label. An unknown placeholder is
 * left as written, so a typo shows up in the output rather than vanishing.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
	const lines: string[] = [];
	for (const line of template.split("\n")) {
		let used = 0;
		let filled = 0;
		const rendered = line.replace(PLACEHOLDER, (match, key: string) => {
			if (!(key in values)) return match;
			used += 1;
			if (values[key].length > 0) filled += 1;
			return values[key];
		});
		if (used > 0 && filled === 0) continue;
		lines.push(rendered);
	}
	return lines.join("\n");
}

/** `symbol = latex` when the equation has a symbol, otherwise just the LaTeX. */
function displayLatex(equation: Equation): string {
	return equation.symbol ? `${equation.symbol} = ${equation.latex}` : equation.latex;
}

function equationValues(equation: Equation): Record<string, string> {
	return {
		category: equation.category,
		name: equation.name,
		equation: displayLatex(equation).trim(),
		latex: equation.latex.trim(),
		symbol: equation.symbol?.trim() ?? "",
		note: equation.note?.trim() ?? "",
		usage: (equation.usage ?? []).join(", "),
		source: equation.source?.trim() ?? "",
	};
}

/**
 * The library as a Markdown document laid out by `layout` — by default
 * `# Category`, then `## Name`, the equation in a `$$` block, and the note as
 * plain text below it. Categories follow the library's own order (Uncategorized
 * first, the rest A–Z) and empty ones are left out; equations are sorted by
 * name within each category. Blocks are separated by one blank line, and runs
 * of blank lines a template leaves behind are collapsed to one.
 */
export function serializeMarkdown(catalog: Catalog, layout: MarkdownLayout = DEFAULT_MARKDOWN_LAYOUT): string {
	const byCategory = new Map<string, Equation[]>();
	for (const equation of catalog.equations) {
		const list = byCategory.get(equation.category) ?? [];
		list.push(equation);
		byCategory.set(equation.category, list);
	}

	// An equation can carry a category the list does not know about; it is
	// still exported, after the known ones.
	const order = orderedCategories(catalog);
	const extra = [...byCategory.keys()].filter((c) => !order.includes(c)).sort((a, b) => a.localeCompare(b));

	const sections: string[] = [];
	for (const category of [...order, ...extra]) {
		const equations = byCategory.get(category);
		if (!equations || equations.length === 0) continue;
		const parts = [renderTemplate(layout.category, { category })];
		for (const equation of equations.slice().sort((a, b) => a.name.localeCompare(b.name))) {
			parts.push(renderTemplate(layout.equation, equationValues(equation)));
		}
		sections.push(...parts.map((part) => part.trim()).filter((part) => part.length > 0));
	}
	return sections.join("\n\n").replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n") + "\n";
}

export function serializeExport(
	catalog: Catalog,
	format: ExportFormat,
	layout: MarkdownLayout = DEFAULT_MARKDOWN_LAYOUT,
): string {
	return format === "json" ? serializeCatalog(catalog) : serializeMarkdown(catalog, layout);
}

/** Characters no file system on any platform Obsidian runs on accepts in a name. */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|#^[\]]/g;

/**
 * `Equation Library.md`, or `Equation Library - Statistics.md` for one
 * category. Characters a file name cannot hold become dashes.
 */
export function defaultExportFileName(format: ExportFormat, category: string | null): string {
	const base = category === null ? "Equation Library" : `Equation Library - ${category}`;
	const safe = base.replace(UNSAFE_FILE_CHARS, "-").replace(/\s+/g, " ").trim();
	return `${safe}.${exportExtension(format)}`;
}
