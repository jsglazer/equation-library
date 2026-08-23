import { Catalog, CURRENT_SCHEMA_VERSION, Equation, UNCATEGORIZED } from "../src/core/types";

export function equation(overrides: Partial<Equation> & Pick<Equation, "id" | "name">): Equation {
	return {
		latex: "x",
		category: UNCATEGORIZED,
		created: "2026-01-01T00:00:00.000Z",
		modified: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

/** A small fixed catalog. Every test that needs data starts from this. */
export function mockCatalog(): Catalog {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		categories: [UNCATEGORIZED, "Algebra", "Calculus"],
		equations: [
			equation({
				id: "eq-quadratic",
				name: "Quadratic Formula",
				latex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
				category: "Algebra",
				created: "2026-01-01T00:00:00.000Z",
				modified: "2026-01-05T00:00:00.000Z",
			}),
			equation({
				id: "eq-euler",
				name: "Euler Identity",
				latex: "e^{i\\pi} + 1 = 0",
				category: "Algebra",
				created: "2026-01-02T00:00:00.000Z",
				modified: "2026-01-02T00:00:00.000Z",
			}),
			equation({
				id: "eq-derivative",
				name: "Power Rule",
				latex: "\\frac{d}{dx} x^n = n x^{n-1}",
				category: "Calculus",
				created: "2026-01-03T00:00:00.000Z",
				modified: "2026-01-09T00:00:00.000Z",
			}),
			equation({
				id: "eq-loose",
				name: "Scratch Note",
				latex: "\\Delta \\log(x) \\approx \\frac{\\Delta x}{x_0}",
				category: UNCATEGORIZED,
				created: "2026-01-04T00:00:00.000Z",
				modified: "2026-01-04T00:00:00.000Z",
			}),
		],
	};
}

/** Unwraps a successful Outcome, failing loudly if it was an error. */
export function expectOk<T>(outcome: { ok: true; value: T } | { ok: false; error: string }): T {
	if (!outcome.ok) throw new Error(`expected ok, got error: ${outcome.error}`);
	return outcome.value;
}
