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

/** `symbol = latex` when the equation has a symbol, otherwise just the LaTeX. */
function displayLatex(equation: Equation): string {
	return equation.symbol ? `${equation.symbol} = ${equation.latex}` : equation.latex;
}

/**
 * The library as a Markdown document: `# Category`, then `## Name`, the
 * equation in a `$$` block, and the note as plain text below it. Categories
 * follow the library's own order (Uncategorized first, the rest A–Z) and empty
 * ones are left out; equations are sorted by name within each category.
 */
export function serializeMarkdown(catalog: Catalog): string {
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
		const parts = [`# ${category}`];
		for (const equation of equations.slice().sort((a, b) => a.name.localeCompare(b.name))) {
			parts.push(`## ${equation.name}`);
			parts.push(`$$\n${displayLatex(equation).trim()}\n$$`);
			if (equation.note) parts.push(equation.note.trim());
		}
		sections.push(parts.join("\n\n"));
	}
	return sections.join("\n\n") + "\n";
}

export function serializeExport(catalog: Catalog, format: ExportFormat): string {
	return format === "json" ? serializeCatalog(catalog) : serializeMarkdown(catalog);
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
