import { describe, expect, it } from "vitest";
import {
	asList,
	asText,
	changedFields,
	extraText,
	fieldsToWrite,
	fileStem,
	readEquationNote,
	uniqueStem,
} from "../src/core/note-schema";
import { DEFAULT_KEYS } from "../src/core/settings";
import { UNCATEGORIZED } from "../src/core/types";
import { equation } from "./fixtures";

const INFO = {
	path: "Lib/Eq/eq-Set-Bayes.md",
	basename: "eq-Set-Bayes",
	ctime: Date.UTC(2026, 0, 2),
	mtime: Date.UTC(2026, 0, 3),
};

describe("asText / asList", () => {
	it("trims scalars, joins lists, and ignores objects", () => {
		expect(asText("  a ")).toBe("a");
		expect(asText(["a", " b"])).toBe("a b");
		expect(asText(3)).toBe("3");
		expect(asText(null)).toBe("");
		expect(asText({ x: 1 })).toBe("");
		expect(asList("a")).toEqual(["a"]);
		expect(asList(["a", "", null, " b"])).toEqual(["a", "b"]);
		expect(asList(undefined)).toEqual([]);
	});
});

describe("readEquationNote", () => {
	it("maps the frontmatter onto an equation, stripping $ from the LaTeX and symbol", () => {
		const result = readEquationNote(
			{
				...INFO,
				frontmatter: {
					DocType: "Equation",
					Name: "Bayes Theorem",
					Smb: "$P(A|B)$",
					Eq: "$\\dfrac{P(A \\cap B)}{P(B)}$",
					Category: "Stats",
					Usage: ["Sets"],
					Source: "OpenStax 421",
					Function: "Conditional probability",
					Note: null,
				},
				body: "Body text here.",
			},
			DEFAULT_KEYS,
		);
		expect(result).toEqual({
			id: INFO.path,
			name: "Bayes Theorem",
			latex: "\\dfrac{P(A \\cap B)}{P(B)}",
			symbol: "P(A|B)",
			category: "Stats",
			usage: ["Sets"],
			source: "OpenStax 421",
			text: "Equation\nConditional probability\nBody text here.",
			created: "2026-01-02T00:00:00.000Z",
			modified: "2026-01-03T00:00:00.000Z",
		});
	});

	it("falls back to the file name and Uncategorized, and omits blank optionals", () => {
		const result = readEquationNote({ ...INFO, frontmatter: { Eq: "x^2", Smb: "", Category: " " } }, DEFAULT_KEYS);
		expect(result).toMatchObject({ name: "eq-Set-Bayes", latex: "x^2", category: UNCATEGORIZED });
		expect(result).not.toHaveProperty("symbol");
		expect(result).not.toHaveProperty("note");
		expect(result).not.toHaveProperty("usage");
		expect(result).not.toHaveProperty("text");
	});

	it("is null for a note without the LaTeX key, so index and template notes are ignored", () => {
		expect(readEquationNote({ ...INFO, frontmatter: { Name: "Index" } }, DEFAULT_KEYS)).toBeNull();
		expect(readEquationNote({ ...INFO, frontmatter: { Eq: "" } }, DEFAULT_KEYS)).toBeNull();
		expect(readEquationNote({ ...INFO, frontmatter: null }, DEFAULT_KEYS)).toBeNull();
		expect(readEquationNote({ ...INFO, frontmatter: undefined }, DEFAULT_KEYS)).toBeNull();
	});

	it("honours a remapped note key", () => {
		const keys = { ...DEFAULT_KEYS, note: "Function" };
		const result = readEquationNote({ ...INFO, frontmatter: { Eq: "x", Function: "SE of the mean", Note: "ignored" } }, keys);
		expect(result?.note).toBe("SE of the mean");
		// The unmapped `Note` key now counts as extra text instead.
		expect(result?.text).toBe("ignored");
	});
});

describe("extraText", () => {
	it("skips owned keys and the cache's position entry", () => {
		const text = extraText({ Name: "n", Eq: "x", AltName: ["a", "b"], position: { start: 0 }, Flag: "Y" }, DEFAULT_KEYS, undefined);
		expect(text).toBe("a b\nY");
	});
});

describe("fieldsToWrite", () => {
	it("wraps LaTeX and symbol in $, blanks Uncategorized, trims text", () => {
		expect(fieldsToWrite({ name: " n ", symbol: "$E_p$", latex: "x = 1", category: UNCATEGORIZED, note: " " }, DEFAULT_KEYS)).toEqual([
			["Name", "n"],
			["Smb", "$E_p$"],
			["Eq", "$x = 1$"],
			["Category", ""],
			["Note", ""],
		]);
	});

	it("writes only the fields given", () => {
		expect(fieldsToWrite({ category: "Econ" }, DEFAULT_KEYS)).toEqual([["Category", "Econ"]]);
		expect(fieldsToWrite({}, DEFAULT_KEYS)).toEqual([]);
	});

	it("uses the configured keys", () => {
		expect(fieldsToWrite({ note: "why" }, { ...DEFAULT_KEYS, note: "Function" })).toEqual([["Function", "why"]]);
	});
});

describe("changedFields", () => {
	const before = equation({ id: "a", name: "A", latex: "x", category: "C", symbol: "s" });

	it("reports only what differs, treating absent optionals as empty", () => {
		expect(changedFields(before, before)).toEqual({});
		expect(changedFields(before, { ...before, name: "B" })).toEqual({ name: "B" });
		const { symbol: _dropped, ...noSymbol } = before;
		void _dropped;
		expect(changedFields(before, noSymbol)).toEqual({ symbol: "" });
		expect(changedFields(before, { ...before, note: "n" })).toEqual({ note: "n" });
	});
});

describe("fileStem / uniqueStem", () => {
	it("builds a link-safe hyphenated stem", () => {
		expect(fileStem("eq-", "Bayes Theorem")).toBe("eq-Bayes-Theorem");
		expect(fileStem("eq-", "Bayes' Theorem (2)")).toBe("eq-Bayes'-Theorem-2");
		expect(fileStem("eq-", "a/b:c*d?e\"f<g>h|i#j^k[l]m")).toBe("eq-a-b-c-d-e-f-g-h-i-j-k-l-m");
		expect(fileStem("", "   ")).toBe("equation");
		expect(fileStem("eq-", "()")).toBe("eq-equation");
	});

	it("suffixes -2, -3 until the name is free", () => {
		const taken = new Set(["eq-x", "eq-x-2"]);
		expect(uniqueStem("eq-x", (c) => taken.has(c))).toBe("eq-x-3");
		expect(uniqueStem("eq-y", (c) => taken.has(c))).toBe("eq-y");
	});
});
