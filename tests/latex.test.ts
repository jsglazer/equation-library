import { describe, expect, it } from "vitest";
import { isInsideMath, resolveInsertMode, stripDelimiters, wrapDelimiters } from "../src/core/latex";

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

describe("isInsideMath", () => {
	it("is false with no dollars at all", () => {
		expect(isInsideMath("plain text")).toBe(false);
	});

	it("is true right after an unclosed inline delimiter", () => {
		expect(isInsideMath("some text $x^2")).toBe(true);
	});

	it("is false once an inline pair has closed", () => {
		expect(isInsideMath("$x^2$ and ")).toBe(false);
	});

	it("is true right after an unclosed block delimiter", () => {
		expect(isInsideMath("some text $$x^2")).toBe(true);
	});

	it("is false once a block pair has closed", () => {
		expect(isInsideMath("$$x^2$$ and ")).toBe(false);
	});

	it("does not mistake a block delimiter for two inline ones", () => {
		expect(isInsideMath("$$x^2")).toBe(true);
		expect(isInsideMath("$$")).toBe(true);
	});

	it("ignores escaped dollar signs", () => {
		expect(isInsideMath("price: \\$5, still text")).toBe(false);
		expect(isInsideMath("\\$5 and $x^2")).toBe(true);
	});

	it("handles multiple equations on the way to the cursor", () => {
		expect(isInsideMath("$a$ + $b$ + text")).toBe(false);
		expect(isInsideMath("$a$ + $b^2")).toBe(true);
	});
});
