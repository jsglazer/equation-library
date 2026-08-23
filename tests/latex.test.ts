import { describe, expect, it } from "vitest";
import { resolveInsertMode, stripDelimiters, wrapDelimiters } from "../src/core/latex";

describe("stripDelimiters", () => {
	it("strips one matched inline pair", () => {
		expect(stripDelimiters("$x^2$")).toBe("x^2");
	});

	it("strips one matched block pair", () => {
		expect(stripDelimiters("$$x^2$$")).toBe("x^2");
	});

	it("strips only the outermost pair, once", () => {
		expect(stripDelimiters("$$\\frac{1}{2}$$")).toBe("\\frac{1}{2}");
		expect(stripDelimiters(stripDelimiters("$$x$$"))).toBe("x");
	});

	it("leaves bare LaTeX untouched", () => {
		expect(stripDelimiters("\\alpha + \\beta")).toBe("\\alpha + \\beta");
	});

	it("leaves an unmatched delimiter untouched", () => {
		expect(stripDelimiters("$x^2")).toBe("$x^2");
		expect(stripDelimiters("x^2$")).toBe("x^2$");
	});

	it("leaves interior dollars untouched rather than mangling two equations", () => {
		expect(stripDelimiters("$a$ + $b$")).toBe("$a$ + $b$");
	});

	it("trims surrounding whitespace", () => {
		expect(stripDelimiters("  $ x $  ")).toBe("x");
	});

	it("does not strip a lone dollar sign", () => {
		expect(stripDelimiters("$")).toBe("$");
	});
});

describe("wrapDelimiters", () => {
	it("adds inline delimiters", () => {
		expect(wrapDelimiters("x^2", "inline")).toBe("$x^2$");
	});

	it("adds block delimiters", () => {
		expect(wrapDelimiters("x^2", "block")).toBe("$$x^2$$");
	});

	it("does not double up when the source already carries delimiters", () => {
		expect(wrapDelimiters("$x^2$", "block")).toBe("$$x^2$$");
		expect(wrapDelimiters("$$x^2$$", "inline")).toBe("$x^2$");
	});
});

describe("resolveInsertMode", () => {
	it("defaults to inline", () => {
		expect(resolveInsertMode("inline", false)).toBe("inline");
	});

	it("promotes to block when shift is held", () => {
		expect(resolveInsertMode("inline", true)).toBe("block");
	});

	it("always uses block when the setting says so", () => {
		expect(resolveInsertMode("always-block", false)).toBe("block");
		expect(resolveInsertMode("always-block", true)).toBe("block");
	});
});
