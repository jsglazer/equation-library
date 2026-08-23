/**
 * LaTeX delimiter handling.
 *
 * Equations are stored bare so that one stored equation can serve both the
 * inline (`$`) and block (`$$`) insert paths; delimiters exist only in the
 * document.
 *
 * Pure module: no `obsidian`, DOM or Node imports.
 */

export type InsertMode = "inline" | "block";

/** The user-facing setting that decides which delimiters an insert uses. */
export type InsertFormat = "inline" | "always-block";

/**
 * Strips exactly one matched surrounding `$...$` or `$$...$$` pair.
 *
 * A pair counts as "matched" only when the text between the delimiters
 * contains no further `$`. That leaves unmatched delimiters and interior `$`
 * characters untouched: `"$a$ + $b$"` is not a single wrapped equation and is
 * returned unchanged.
 */
export function stripDelimiters(raw: string): string {
	const text = raw.trim();
	if (text.length >= 4 && text.startsWith("$$") && text.endsWith("$$")) {
		const inner = text.slice(2, -2);
		if (!inner.includes("$")) return inner.trim();
	}
	if (text.length >= 2 && text.startsWith("$") && text.endsWith("$")) {
		const inner = text.slice(1, -1);
		if (!inner.includes("$")) return inner.trim();
	}
	return text;
}

/** Wraps bare LaTeX in the delimiters for `mode`. */
export function wrapDelimiters(latex: string, mode: InsertMode): string {
	const bare = stripDelimiters(latex);
	return mode === "block" ? `$$${bare}$$` : `$${bare}$`;
}

/**
 * Decides inline vs block for one insert action.
 *
 * `always-block` forces block; otherwise a held shift key promotes an insert
 * to block. This is the single place that rule lives.
 */
export function resolveInsertMode(format: InsertFormat, shiftKey: boolean): InsertMode {
	if (format === "always-block") return "block";
	return shiftKey ? "block" : "inline";
}
