import { describe, expect, it } from "vitest";
import { appendWithCap, applyCap, createLogEntry, parseLog, serializeLog } from "../src/core/log";
import { LogEntry } from "../src/core/types";

const NOW = "2026-02-01T12:00:00.000Z";

function entry(n: number): LogEntry {
	return { ts: `2026-01-01T00:00:0${n % 10}.000Z`, action: "insert-at-cursor", latex: `x${n}` };
}

describe("createLogEntry", () => {
	it("stores the LaTeX bare and carries the supplied timestamp", () => {
		expect(createLogEntry({ action: "add-and-insert", latex: "$$x^2$$", now: NOW })).toEqual({
			ts: NOW,
			action: "add-and-insert",
			latex: "x^2",
		});
	});

	it("includes name and category only when they carry content", () => {
		expect(createLogEntry({ action: "add-to-library", latex: "x", name: " Euler ", category: " Algebra ", now: NOW })).toEqual({
			ts: NOW,
			action: "add-to-library",
			latex: "x",
			name: "Euler",
			category: "Algebra",
		});
		expect(createLogEntry({ action: "add-to-library", latex: "x", name: "  ", category: "", now: NOW })).toEqual({
			ts: NOW,
			action: "add-to-library",
			latex: "x",
		});
	});
});

describe("serializeLog and parseLog", () => {
	it("round-trips entries", () => {
		const entries = [entry(1), entry(2)];
		expect(parseLog(serializeLog(entries))).toEqual(entries);
	});

	it("writes one JSON object per line with a trailing newline", () => {
		const text = serializeLog([entry(1), entry(2)]);
		expect(text.endsWith("\n")).toBe(true);
		expect(text.trimEnd().split("\n")).toHaveLength(2);
	});

	it("serializes an empty log as an empty string", () => {
		expect(serializeLog([])).toBe("");
		expect(parseLog("")).toEqual([]);
	});

	it("skips blank and malformed lines rather than throwing", () => {
		const text = `${JSON.stringify(entry(1))}\n\n{not json\n${JSON.stringify({ nope: true })}\n${JSON.stringify(entry(2))}\n`;
		expect(parseLog(text)).toEqual([entry(1), entry(2)]);
	});
});

describe("applyCap", () => {
	const entries = Array.from({ length: 12 }, (_unused, i) => entry(i));

	it("keeps everything when off", () => {
		expect(applyCap(entries, "off")).toHaveLength(12);
	});

	it("keeps everything when under the cap", () => {
		expect(applyCap(entries.slice(0, 3), 100)).toHaveLength(3);
	});

	it("drops from the head, keeping the newest entries", () => {
		const many = Array.from({ length: 600 }, (_unused, i) => ({ ...entry(i), latex: `x${i}` }));
		const capped = applyCap(many, 500);
		expect(capped).toHaveLength(500);
		expect(capped[0].latex).toBe("x100");
		expect(capped[capped.length - 1].latex).toBe("x599");
	});

	it("does not mutate its input", () => {
		const before = entries.map((e) => e.latex);
		applyCap(entries, "off");
		expect(entries.map((e) => e.latex)).toEqual(before);
	});
});

describe("appendWithCap", () => {
	it("appends at the tail", () => {
		const result = appendWithCap([entry(1)], entry(2), 500);
		expect(result.map((e) => e.latex)).toEqual(["x1", "x2"]);
	});

	it("enforces the cap at write time by dropping the oldest", () => {
		const existing = Array.from({ length: 100 }, (_unused, i) => entry(i));
		const result = appendWithCap(existing, entry(999), 100);
		expect(result).toHaveLength(100);
		expect(result[0].latex).toBe("x1");
		expect(result[result.length - 1].latex).toBe("x999");
	});

	it("grows without bound when the cap is off", () => {
		const existing = Array.from({ length: 100 }, (_unused, i) => entry(i));
		expect(appendWithCap(existing, entry(999), "off")).toHaveLength(101);
	});
});
