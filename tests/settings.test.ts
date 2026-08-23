import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/core/settings";

describe("normalizeSettings", () => {
	it("returns the defaults for an empty or non-object payload", () => {
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid values", () => {
		const stored = {
			closeOnInsert: false,
			insertFormat: "always-block",
			suggestEnabled: false,
			suggestTrigger: ";;",
			logCap: 1000,
			sortOrder: "modified",
			lastCategory: "Algebra",
		};
		expect(normalizeSettings(stored)).toEqual(stored);
	});

	it("discards values of the wrong type or outside the allowed set", () => {
		const result = normalizeSettings({
			closeOnInsert: "yes",
			insertFormat: "sideways",
			suggestEnabled: 1,
			logCap: 42,
			sortOrder: "colour",
			lastCategory: 7,
		});
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("accepts 'off' as a log cap", () => {
		expect(normalizeSettings({ logCap: "off" }).logCap).toBe("off");
	});

	it("falls back rather than accept an empty trigger, which would fire on every keystroke", () => {
		expect(normalizeSettings({ suggestTrigger: "   " }).suggestTrigger).toBe(DEFAULT_SETTINGS.suggestTrigger);
	});

	it("trims a stored trigger", () => {
		expect(normalizeSettings({ suggestTrigger: " $/ " }).suggestTrigger).toBe("$/");
	});
});
