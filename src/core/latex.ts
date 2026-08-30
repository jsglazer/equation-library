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

/** Opening fence of a code block, which suspends all math parsing. */
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Whether a `$` at this point can open inline math, judged by what follows it.
 *
 * `$100` is currency and `$ x` is prose, so neither opens an equation; a `$`
 * sitting at the very end of the scanned text is the one the user just typed,
 * so that does. Without this test every dollar amount above the cursor made
 * the whole rest of the note look like an open equation.
 */
function opensInline(next: string | undefined): boolean {
	if (next === undefined) return true;
	return !/[\s0-9]/.test(next);
}

/**
 * Whether a position sits inside an already-open `$...$` or `$$...$$` span.
 *
 * `textBeforePosition` is everything in the document from its start up to the
 * position being tested — the same "scan from the top" approach the code
 * suggester uses for fenced code blocks.
 *
 * The two delimiters are scoped differently, because they behave differently:
 * `$$` blocks span lines and so are tracked across the whole document, while
 * inline `$` cannot cross a newline and so is reset on every line. Fenced code
 * and inline code spans are skipped entirely (`$ pandoc ...` in a shell block
 * and a Dataview `$=` query are not math), an
 * escaped `\$` never toggles state, and `$$` is checked before a lone `$` so a
 * block delimiter is never mistaken for two inline ones.
 */
export function isInsideMath(textBeforePosition: string): boolean {
	const lines = textBeforePosition.replace(/\\\$/g, "  ").split("\n");
	let fence: string | null = null;
	let blockOpen = false;
	let inlineOpen = false;

	for (const line of lines) {
		const fenceMatch = FENCE.exec(line);
		if (fenceMatch !== null) {
			const marker = fenceMatch[1][0];
			fence = fence === null ? marker : fence === marker ? null : fence;
			continue;
		}
		if (fence !== null) continue;

		// Inline math never survives a line break; block math does.
		inlineOpen = false;
		let inCode = false;
		for (let i = 0; i < line.length; i += 1) {
			// A backtick run opens or closes a code span, and `$` inside one is
			// not math — a Dataview `$=` query is the common case.
			if (line[i] === "`") {
				while (line[i + 1] === "`") i += 1;
				inCode = !inCode;
				continue;
			}
			if (inCode || line[i] !== "$") continue;
			if (line[i + 1] === "$") {
				blockOpen = !blockOpen;
				i += 1;
				continue;
			}
			if (blockOpen) continue;
			if (inlineOpen) inlineOpen = false;
			else if (opensInline(line[i + 1])) inlineOpen = true;
		}
	}
	return blockOpen || inlineOpen;
}

/** One complete `$…$` or `$$…$$` span found in a document. */
export interface MathSpan {
	/** Offset of the first delimiter character. */
	readonly start: number;
	/** Offset one past the last delimiter character. */
	readonly end: number;
	readonly mode: InsertMode;
	/** The contents with the delimiters removed and trimmed. */
	readonly latex: string;
}

function makeSpan(text: string, start: number, end: number, mode: InsertMode): MathSpan | null {
	const latex = stripDelimiters(text.slice(start, end));
	return latex.length === 0 ? null : { start, end, mode, latex };
}

/**
 * Every closed math span in `text`, in document order.
 *
 * The scan mirrors `isInsideMath` — fenced code and inline code spans are
 * skipped, `\$` never toggles state, `$$` is checked before a lone `$`, and a
 * `$` followed by whitespace or a digit is currency rather than an opener —
 * but records where each span begins and ends instead of only whether a
 * position sits inside one. Unterminated spans are dropped: there is nothing
 * to load into the generator until the equation is closed.
 */
export function scanMathSpans(text: string): MathSpan[] {
	const spans: MathSpan[] = [];
	const lines = text.split("\n");
	let fence: string | null = null;
	let blockStart = -1;
	let offset = 0;

	for (const line of lines) {
		const fenceMatch = FENCE.exec(line);
		// A fence inside an open `$$` block is part of the equation, not code.
		if (fenceMatch !== null && blockStart < 0) {
			const marker = fenceMatch[1][0];
			fence = fence === null ? marker : fence === marker ? null : fence;
			offset += line.length + 1;
			continue;
		}
		if (fence !== null) {
			offset += line.length + 1;
			continue;
		}

		// Inline math never survives a line break; block math does.
		let inlineStart = -1;
		let inCode = false;
		for (let i = 0; i < line.length; i += 1) {
			if (line[i] === "\\") {
				i += 1;
				continue;
			}
			if (blockStart < 0 && line[i] === "`") {
				while (line[i + 1] === "`") i += 1;
				inCode = !inCode;
				continue;
			}
			if (inCode || line[i] !== "$") continue;
			const at = offset + i;
			if (line[i + 1] === "$") {
				if (blockStart >= 0) {
					const span = makeSpan(text, blockStart, at + 2, "block");
					if (span) spans.push(span);
					blockStart = -1;
				} else {
					blockStart = at;
					inlineStart = -1;
				}
				i += 1;
				continue;
			}
			if (blockStart >= 0) continue;
			if (inlineStart >= 0) {
				const span = makeSpan(text, inlineStart, at + 1, "inline");
				if (span) spans.push(span);
				inlineStart = -1;
			} else if (opensInline(line[i + 1])) {
				inlineStart = at;
			}
		}
		offset += line.length + 1;
	}
	return spans;
}

/**
 * The math span `offset` sits in, or `null`.
 *
 * Both edges count as inside, so a caret resting immediately before the
 * opening `$` or just after the closing one still finds the equation — that is
 * where the caret lands when a click selects a rendered equation.
 */
export function findMathSpanAt(text: string, offset: number): MathSpan | null {
	for (const span of scanMathSpans(text)) {
		if (offset >= span.start && offset <= span.end) return span;
	}
	return null;
}
