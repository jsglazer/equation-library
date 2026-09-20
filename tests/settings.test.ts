import { describe, expect, it } from "vitest";
import {
	DEFAULT_FILE_PREFIX,
	DEFAULT_KEYS,
	DEFAULT_LIBRARY_FOLDER,
	DEFAULT_SETTINGS,
	normalizeCategories,
	normalizeKeys,
	normalizeSettings,
	normalizeVaultPath,
} from "../src/core/settings";

describe("normalizeSettings", () => {
	it("returns the defaults for an empty or non-object payload", () => {
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid values", () => {
		const stored = {
			insertFormat: "always-block",
			suggestEnabled: false,
			suggestTrigger: ";;",
			logCap: 1000,
			sortOrder: "modified",
			lastCategory: "Algebra",
			libraryFolder: "Lib/Eq",
			templatePath: "Templates/equations.md",
			filePrefix: "eq-",
			keys: { ...DEFAULT_KEYS, note: "Function" },
			categories: ["Econ", "Stats"],
		};
		expect(normalizeSettings(stored)).toEqual(stored);
	});

	it("drops the pre-1.1 catalog keys without complaint", () => {
		const result = normalizeSettings({ catalogLocation: "vault", catalogPath: "Lib/equations.json" });
		expect(result).toEqual(DEFAULT_SETTINGS);
		expect("catalogPath" in result).toBe(false);
	});

	it("defaults the library folder and rejects one that escapes the vault", () => {
		expect(normalizeSettings({}).libraryFolder).toBe(DEFAULT_LIBRARY_FOLDER);
		expect(normalizeSettings({ libraryFolder: "   " }).libraryFolder).toBe(DEFAULT_LIBRARY_FOLDER);
		expect(normalizeSettings({ libraryFolder: "../outside" }).libraryFolder).toBe(DEFAULT_LIBRARY_FOLDER);
		expect(normalizeSettings({ libraryFolder: "/Math/Eq/" }).libraryFolder).toBe("Math/Eq");
	});

	it("allows an empty template path and an empty file prefix", () => {
		expect(normalizeSettings({ templatePath: "" }).templatePath).toBe("");
		expect(normalizeSettings({ templatePath: "../x.md" }).templatePath).toBe("");
		expect(normalizeSettings({ filePrefix: "" }).filePrefix).toBe("");
		expect(normalizeSettings({ filePrefix: "a/b" }).filePrefix).toBe(DEFAULT_FILE_PREFIX);
	});

	it("discards values of the wrong type or outside the allowed set", () => {
		const result = normalizeSettings({
			insertFormat: "sideways",
			suggestEnabled: 1,
			logCap: 42,
			sortOrder: "colour",
			lastCategory: 7,
			libraryFolder: 3,
			keys: "Name",
			categories: "Econ",
		});
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("drops a setting that no longer exists, so an old data.json never warns", () => {
		// `closeOnInsert` went away when the library became a panel meant to stay
		// open; an install that predates that still has it in data.json.
		const result = normalizeSettings({ closeOnInsert: true, sortOrder: "created" });
		expect(result).not.toHaveProperty("closeOnInsert");
		expect(result.sortOrder).toBe("created");
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

describe("normalizeKeys", () => {
	it("fills missing or invalid keys from the defaults, one at a time", () => {
		expect(normalizeKeys(undefined)).toEqual(DEFAULT_KEYS);
		expect(normalizeKeys({ latex: "LaTeX", note: "" })).toEqual({ ...DEFAULT_KEYS, latex: "LaTeX" });
		expect(normalizeKeys({ name: "Na:me" }).name).toBe(DEFAULT_KEYS.name);
		expect(normalizeKeys({ symbol: "  Sym  " }).symbol).toBe("Sym");
	});
});

describe("normalizeCategories", () => {
	it("keeps trimmed unique strings and never the reserved category", () => {
		expect(normalizeCategories([" Econ ", "Econ", "Uncategorized", 4, ""])).toEqual(["Econ"]);
		expect(normalizeCategories("Econ")).toEqual([]);
	});
});

describe("normalizeVaultPath", () => {
	it("strips leading and trailing slashes", () => {
		expect(normalizeVaultPath("/a/b/", "x")).toBe("a/b");
		expect(normalizeVaultPath("a/../b", "x")).toBe("x");
		expect(normalizeVaultPath(undefined, "x")).toBe("x");
	});
});
