import { describe, expect, it } from "vitest";
import { buildNoteText, fieldLines, setFrontmatterFields, splitNote, templateKeys, yamlScalar } from "../src/core/frontmatter";

const NOTE = [
	"---",
	"DocType: Equation",
	"Name: Bayes Theorem",
	"Smb: $P(A|B)$",
	"Eq: $\\dfrac{P(A \\cap B)}{P(B)}$",
	"Cond: ",
	"Source: ",
	"Usage:",
	"- Sets",
	" - Probability",
	"AltName: ",
	"---",
	"`= this.Smb + \" = \" + this.Eq`",
	"",
	"#### Backlinks",
	"",
].join("\n");

describe("splitNote", () => {
	it("separates the block from the body and keeps the body verbatim", () => {
		const split = splitNote(NOTE);
		expect(split.frontmatter?.split("\n")[0]).toBe("DocType: Equation");
		expect(split.body.startsWith("`= this.Smb")).toBe(true);
		expect(split.eol).toBe("\n");
	});

	it("treats a note with no opening fence as all body", () => {
		expect(splitNote("just text")).toEqual({ frontmatter: null, body: "just text", eol: "\n" });
	});

	it("treats an unterminated fence as no frontmatter", () => {
		expect(splitNote("---\nName: x\nbody").frontmatter).toBeNull();
	});

	it("detects CRLF", () => {
		expect(splitNote("---\r\nName: x\r\n---\r\nbody").eol).toBe("\r\n");
	});
});

describe("yamlScalar", () => {
	it("leaves LaTeX plain: backslashes and braces need no quoting", () => {
		expect(yamlScalar("$\\dfrac{a}{b}$")).toBe("$\\dfrac{a}{b}$");
		expect(yamlScalar("Bayes Theorem")).toBe("Bayes Theorem");
	});

	it("single-quotes values YAML would misread", () => {
		expect(yamlScalar("a: b")).toBe("'a: b'");
		expect(yamlScalar("[x]")).toBe("'[x]'");
		expect(yamlScalar("true")).toBe("'true'");
		expect(yamlScalar("42")).toBe("'42'");
		expect(yamlScalar("# heading")).toBe("'# heading'");
		// An apostrophe inside a plain scalar is fine; one at the start is not.
		expect(yamlScalar("it's")).toBe("it's");
		expect(yamlScalar("'quoted'")).toBe("'''quoted'''");
		expect(yamlScalar("")).toBe("");
	});
});

describe("fieldLines", () => {
	it("writes a scalar on one line and a list as a block", () => {
		expect(fieldLines("Name", "x")).toEqual(["Name: x"]);
		expect(fieldLines("Name", "")).toEqual(["Name: "]);
		expect(fieldLines("Usage", ["Sets", "a: b"])).toEqual(["Usage:", "  - Sets", "  - 'a: b'"]);
		expect(fieldLines("Usage", [])).toEqual(["Usage: "]);
	});
});

describe("setFrontmatterFields", () => {
	it("replaces only the named key's line and leaves everything else byte for byte", () => {
		const out = setFrontmatterFields(NOTE, { Name: "Bayes' Rule" });
		expect(out).toBe(NOTE.replace("Name: Bayes Theorem", "Name: Bayes' Rule"));
	});

	it("replaces a block list including zero- and one-space-indented items", () => {
		const out = setFrontmatterFields(NOTE, { Usage: ["Inference"] });
		expect(out).toContain("Usage:\n  - Inference\nAltName: ");
		expect(out).not.toContain("- Sets");
		expect(out).not.toContain("Probability");
	});

	it("can collapse a list to a blank scalar and expand a scalar to a list", () => {
		const collapsed = setFrontmatterFields(NOTE, { Usage: "" });
		expect(collapsed).toContain("Source: \nUsage: \nAltName: ");
		const expanded = setFrontmatterFields(NOTE, { Cond: ["n > 30"] });
		expect(expanded).toContain("Cond:\n  - n > 30\nSource: ");
	});

	it("appends a missing key before the closing fence", () => {
		const out = setFrontmatterFields(NOTE, { Category: "Stats" });
		expect(out).toContain("AltName: \nCategory: Stats\n---\n`= this.Smb");
	});

	it("does not match a key that merely starts with the same letters", () => {
		const out = setFrontmatterFields(NOTE, { Alt: "x" });
		expect(out).toContain("AltName: \nAlt: x\n---");
	});

	it("adds a frontmatter block to a note that has none", () => {
		expect(setFrontmatterFields("body\n", { Name: "x" })).toBe("---\nName: x\n---\nbody\n");
		expect(setFrontmatterFields("", { Name: "x" })).toBe("---\nName: x\n---\n");
	});

	it("handles an empty block", () => {
		expect(setFrontmatterFields("---\n---\nbody", { Name: "x" })).toBe("---\nName: x\n---\nbody");
	});

	it("keeps CRLF line endings", () => {
		const crlf = "---\r\nName: a\r\nEq: $x$\r\n---\r\nbody\r\n";
		expect(setFrontmatterFields(crlf, { Name: "b" })).toBe("---\r\nName: b\r\nEq: $x$\r\n---\r\nbody\r\n");
	});

	it("applies several fields in one pass", () => {
		const out = setFrontmatterFields(NOTE, { Name: "N", Eq: "$y$", Category: "C" });
		expect(out).toContain("Name: N\n");
		expect(out).toContain("Eq: $y$\n");
		expect(out).toContain("Category: C\n---");
	});
});

describe("templateKeys", () => {
	it("lists the keys in order with their raw values", () => {
		const keys = templateKeys("---\nDocType: Equation\nCreated: <% tp.date.now() %>\nUsage:\n- a\n---\nbody");
		expect(keys.map((k) => k.key)).toEqual(["DocType", "Created", "Usage"]);
		expect(keys[1].raw).toBe("<% tp.date.now() %>");
		expect(keys[2].raw).toBe("");
	});
});

describe("buildNoteText", () => {
	const fields: Array<readonly [string, string]> = [
		["Name", "Bayes Theorem"],
		["Smb", "$P(A|B)$"],
		["Eq", "$\\dfrac{P(A \\cap B)}{P(B)}$"],
		["Category", "Stats"],
		["Note", ""],
	];

	it("without a template writes the plugin fields and an empty body", () => {
		expect(buildNoteText({ fields, template: null })).toBe(
			"---\nName: Bayes Theorem\nSmb: $P(A|B)$\nEq: $\\dfrac{P(A \\cap B)}{P(B)}$\nCategory: Stats\nNote: \n---\n",
		);
	});

	it("with a template keeps its key order, blanks template tags, and copies the body", () => {
		const template = [
			"---",
			"DocType: Equation",
			"Created: <% tp.date.now(\"YYYY-MM-DD HH:mm\") %>",
			"Name: ",
			"Smb: ",
			"Eq: ",
			"Source: ",
			"Usage: ",
			"AltName: ",
			"---",
			"`= this.Smb + \" = \" + this.Eq`",
			"",
			"#### Backlinks",
		].join("\n");
		const out = buildNoteText({ fields, template });
		expect(out).toBe(
			[
				"---",
				"DocType: Equation",
				"Created: ",
				"Name: Bayes Theorem",
				"Smb: $P(A|B)$",
				"Eq: $\\dfrac{P(A \\cap B)}{P(B)}$",
				"Source: ",
				"Usage: ",
				"AltName: ",
				"Category: Stats",
				"Note: ",
				"---",
				"`= this.Smb + \" = \" + this.Eq`",
				"",
				"#### Backlinks",
			].join("\n"),
		);
	});

	it("keeps a plain template value the plugin does not own", () => {
		const out = buildNoteText({ fields: [["Name", "x"]], template: "---\nDocType: Equation\nFlag: Y\n---\n" });
		expect(out).toBe("---\nDocType: Equation\nFlag: Y\nName: x\n---\n");
	});
});
