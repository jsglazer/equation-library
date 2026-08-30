import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG_PATH, DEFAULT_SETTINGS, normalizeSettings } from "../src/core/settings";

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
			catalogLocation: "plugin",
			catalogPath: "Math/equations.json",
		};
		expect(normalizeSettings(stored)).toEqual(stored);
	});

	it("defaults the catalog to a vault file, which is what sync replicates", () => {
		expect(DEFAULT_SETTINGS.catalogLocation).toBe("vault");
		expect(normalizeSettings({}).catalogPath).toBe(DEFAULT_CATALOG_PATH);
	});

	it("rejects a catalog path that is empty or escapes the vault", () => {
		expect(normalizeSettings({ catalogPath: "   " }).catalogPath).toBe(DEFAULT_CATALOG_PATH);
		expect(normalizeSettings({ catalogPath: "../outside.json" }).catalogPath).toBe(DEFAULT_CATALOG_PATH);
		expect(normalizeSettings({ catalogPath: "/Math/eq.json" }).catalogPath).toBe("Math/eq.json");
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
