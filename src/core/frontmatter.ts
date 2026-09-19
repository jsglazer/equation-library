/**
 * Line-level frontmatter editing.
 *
 * The plugin writes to notes the user also edits by hand, so it never
 * re-serializes a whole YAML block: doing so would reorder keys, requote
 * values and turn blank fields into `null` across the library. Instead the
 * block is edited one key at a time — the key's line (and any list items or
 * continuation lines under it) is replaced, or the key is appended just before
 * the closing `---`. Everything else stays byte for byte.
 *
 * Reading is not done here. The metadata cache parses YAML properly; this
 * module only needs to find where a key's lines start and end.
 *
 * Pure module: no `obsidian`, DOM or Node imports.
 */

export type FieldValue = string | readonly string[];

export interface SplitNote {
	/** The YAML text between the fences, without them, or null if there is no block. */
	readonly frontmatter: string | null;
	/** Everything after the closing fence (or the whole text when no block). */
	readonly body: string;
	/** The line ending the note uses, so edits do not mix `\n` and `\r\n`. */
	readonly eol: "\n" | "\r\n";
}

const OPEN_FENCE = /^---[ \t]*$/;
const CLOSE_FENCE = /^(---|\.\.\.)[ \t]*$/;

/** Splits a note into its frontmatter block and body. */
export function splitNote(text: string): SplitNote {
	const eol: SplitNote["eol"] = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	if (lines.length === 0 || !OPEN_FENCE.test(lines[0])) return { frontmatter: null, body: text, eol };
	for (let i = 1; i < lines.length; i += 1) {
		if (CLOSE_FENCE.test(lines[i])) {
			return {
				frontmatter: lines.slice(1, i).join(eol),
				body: lines.slice(i + 1).join(eol),
				eol,
			};
		}
	}
	return { frontmatter: null, body: text, eol };
}

/** A top-level `Key:` line, capturing the key. Keys may contain spaces but not colons. */
const KEY_LINE = /^([^\s#\-][^:]*?)\s*:(?:\s|$)/;

function isKeyLine(line: string): boolean {
	return KEY_LINE.test(line);
}

/**
 * A line that belongs to the key above it: indented (nested map, block list,
 * folded scalar) or a zero-indent list item, which YAML permits and which
 * hand-written notes often use.
 */
function isContinuation(line: string): boolean {
	if (line.length === 0) return false;
	if (/^[ \t]/.test(line)) return true;
	return /^-(\s|$)/.test(line);
}

const NEEDS_QUOTES = /^[\s\-?:,\[\]{}#&*!|>'"%@`]|: | #|:$|^\s|\s$|^(true|false|null|yes|no|on|off|~)$|^[+-]?(\d[\d_]*\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Renders one scalar as YAML. Plain style whenever YAML allows it — LaTeX
 * with backslashes and braces is fine plain — and single quotes otherwise, so
 * a backslash never has to be doubled the way double quotes would demand.
 */
export function yamlScalar(value: string): string {
	if (value.length === 0) return "";
	if (NEEDS_QUOTES.test(value)) return `'${value.replace(/'/g, "''")}'`;
	return value;
}

/** The lines that represent `key: value` — one line for a scalar, a block for a list. */
export function fieldLines(key: string, value: FieldValue): string[] {
	if (typeof value === "string") {
		const scalar = yamlScalar(value);
		return [scalar.length > 0 ? `${key}: ${scalar}` : `${key}: `];
	}
	if (value.length === 0) return [`${key}: `];
	return [`${key}:`, ...value.map((item) => `  - ${yamlScalar(item)}`)];
}

/**
 * Sets each key in `patch` inside the note's frontmatter, replacing the lines
 * that key already occupies or appending it before the closing fence. A note
 * with no frontmatter block gets one.
 */
export function setFrontmatterFields(text: string, patch: Readonly<Record<string, FieldValue>>): string {
	const split = splitNote(text);
	const eol = split.eol;
	const lines = split.frontmatter === null ? [] : split.frontmatter.split(/\r?\n/);
	// A block that was exactly `---\n---` splits to one empty line; drop it.
	const block = lines.length === 1 && lines[0] === "" ? [] : lines;

	for (const [key, value] of Object.entries(patch)) {
		const replacement = fieldLines(key, value);
		const start = block.findIndex((line) => {
			const match = KEY_LINE.exec(line);
			return match !== null && match[1] === key;
		});
		if (start === -1) {
			block.push(...replacement);
			continue;
		}
		let end = start + 1;
		while (end < block.length && !isKeyLine(block[end]) && isContinuation(block[end])) end += 1;
		block.splice(start, end - start, ...replacement);
	}

	const body = split.frontmatter === null ? text : split.body;
	const head = ["---", ...block, "---"].join(eol);
	if (split.frontmatter === null) {
		return body.length === 0 ? head + eol : head + eol + body;
	}
	return head + (body.length > 0 || text.endsWith(eol) ? eol : "") + body;
}

/**
 * Reads the `Key:` lines a frontmatter block declares, in order, with the raw
 * remainder of each line. Used to scaffold a new note from a template: the
 * template's keys (and their order) are kept, its values are kept when they
 * are plain text, and anything that looks like a template tag is blanked.
 */
export function templateKeys(text: string): Array<{ readonly key: string; readonly raw: string }> {
	const split = splitNote(text);
	if (split.frontmatter === null) return [];
	const out: Array<{ key: string; raw: string }> = [];
	for (const line of split.frontmatter.split(/\r?\n/)) {
		const match = KEY_LINE.exec(line);
		if (match === null) continue;
		out.push({ key: match[1], raw: line.slice(match[0].length).trim() });
	}
	return out;
}

const TEMPLATE_TAG = /<%|\{\{/;

export interface NewNoteInput {
	/** The plugin-owned keys and their values, in the order they should appear when not in the template. */
	readonly fields: ReadonlyArray<readonly [string, FieldValue]>;
	/** Full text of the template note, or null for none. */
	readonly template: string | null;
}

/**
 * Builds the full text of a new equation note.
 *
 * With a template, every key the template declares is written in the
 * template's order: a plugin field takes the plugin's value, any other key
 * keeps its template value unless that value is a Templater or Handlebars tag,
 * which is blanked because nothing here will expand it. Plugin fields the
 * template lacks are appended. The template's body follows the block.
 */
export function buildNoteText(input: NewNoteInput): string {
	const values = new Map<string, FieldValue>(input.fields);
	const lines: string[] = [];
	let body = "";
	if (input.template !== null) {
		const split = splitNote(input.template);
		body = split.body;
		const seen = new Set<string>();
		for (const { key, raw } of templateKeys(input.template)) {
			if (seen.has(key)) continue;
			seen.add(key);
			const own = values.get(key);
			if (own !== undefined) {
				lines.push(...fieldLines(key, own));
				values.delete(key);
			} else {
				lines.push(TEMPLATE_TAG.test(raw) ? `${key}: ` : raw.length > 0 ? `${key}: ${raw}` : `${key}: `);
			}
		}
	}
	for (const [key, value] of values) lines.push(...fieldLines(key, value));
	const head = ["---", ...lines, "---"].join("\n");
	return body.length > 0 ? `${head}\n${body.replace(/^\r?\n/, "")}` : `${head}\n`;
}
