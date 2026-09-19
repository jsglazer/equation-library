import { describe, expect, it } from "vitest";
import { mergeCatalog, parseCatalog, planImport, serializeCatalog } from "../src/core/import-export";
import { createCatalog } from "../src/core/catalog";
import { expectOk, mockCatalog } from "./fixtures";

const mintId = (index: number) => `minted-${index}`;

describe("parseCatalog", () => {
	it("accepts a serialized catalog", () => {
		const parsed = expectOk(parseCatalog(serializeCatalog(mockCatalog())));
		expect(parsed.catalog.equations).toHaveLength(4);
		expect(parsed.warnings).toEqual([]);
	});

	it("returns an error instead of throwing on malformed JSON", () => {
		const result = parseCatalog("{ not json");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("not valid JSON");
	});

	it("rejects empty text", () => {
		expect(parseCatalog("   ").ok).toBe(false);
	});

	it("rejects a catalog with no usable equations", () => {
		expect(parseCatalog('{"schemaVersion":1,"categories":[],"equations":[]}').ok).toBe(false);
	});

	it("accepts a legacy bare array and reports it as a warning", () => {
		const parsed = expectOk(parseCatalog('[{"id":"a","name":"Old","latex":"$x$"}]'));
		expect(parsed.catalog.equations[0].latex).toBe("x");
		expect(parsed.warnings.length).toBeGreaterThan(0);
	});
});

describe("mergeCatalog", () => {
	it("adds every equation into an empty catalog", () => {
		const report = mergeCatalog(createCatalog(), mockCatalog(), mintId);
		expect(report.added).toBe(4);
		expect(report.skipped).toBe(0);
		expect(report.catalog.equations).toHaveLength(4);
	});

	it("skips an identical equation that is already present", () => {
		const base = mockCatalog();
		const report = mergeCatalog(base, mockCatalog(), mintId);
		expect(report.skipped).toBe(4);
		expect(report.added).toBe(0);
		expect(report.catalog.equations).toHaveLength(4);
	});

	it("mints a new id and disambiguates the name on a conflicting id", () => {
		const base = mockCatalog();
		const incoming = {
			...mockCatalog(),
			equations: [{ ...mockCatalog().equations[0], latex: "different" }],
		};
		const report = mergeCatalog(base, incoming, mintId);
		expect(report.added).toBe(1);
		expect(report.renamed).toBe(1);
		expect(report.catalog.equations).toHaveLength(5);
		expect(report.catalog.equations[report.catalog.equations.length - 1].id).toBe("minted-0");
		expect(report.catalog.equations[report.catalog.equations.length - 1].name).toBe("Quadratic Formula (2)");
	});

	it("never overwrites or removes anything already in the base catalog", () => {
		const base = mockCatalog();
		const report = mergeCatalog(base, { ...createCatalog(), equations: [] }, mintId);
		expect(report.catalog.equations).toEqual(base.equations);
	});

	it("unions the category lists", () => {
		const incoming = { ...createCatalog(), categories: ["Uncategorized", "Statistics"], equations: [] };
		const report = mergeCatalog(mockCatalog(), incoming, mintId);
		expect(report.catalog.categories).toContain("Statistics");
		expect(report.catalog.categories).toContain("Algebra");
	});
});

describe("serializeCatalog", () => {
	it("writes pretty JSON that parses back to the same catalog", () => {
		const catalog = mockCatalog();
		const text = serializeCatalog(catalog);
		expect(text.endsWith("\n")).toBe(true);
		expect(JSON.parse(text)).toEqual(catalog);
	});
});

describe("planImport", () => {
	it("creates every equation into an empty library", () => {
		const plan = planImport(createCatalog(), mockCatalog());
		expect(plan.toCreate).toHaveLength(4);
		expect(plan.skipped).toEqual([]);
	});

	it("skips by LaTeX, whatever the id or name says", () => {
		const incoming = {
			...mockCatalog(),
			equations: [{ ...mockCatalog().equations[0], id: "other", name: "Renamed" }],
		};
		const plan = planImport(mockCatalog(), incoming);
		expect(plan.toCreate).toEqual([]);
		expect(plan.skipped).toEqual(["Renamed"]);
	});

	it("disambiguates a clashing name and de-duplicates within the import itself", () => {
		const fresh = { ...mockCatalog().equations[0], id: "n1", latex: "brand new" };
		const twin = { ...fresh, id: "n2" };
		const plan = planImport(mockCatalog(), { ...createCatalog(), equations: [fresh, twin] });
		expect(plan.toCreate.map((e) => e.name)).toEqual(["Quadratic Formula (2)"]);
		expect(plan.skipped).toEqual(["Quadratic Formula"]);
	});
});

describe("serializeCatalog with search text", () => {
	it("drops the derived text field", () => {
		const catalog = { ...mockCatalog(), equations: [{ ...mockCatalog().equations[0], text: "body" }] };
		expect(JSON.parse(serializeCatalog(catalog)).equations[0]).not.toHaveProperty("text");
	});
});
