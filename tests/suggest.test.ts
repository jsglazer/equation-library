import { describe, expect, it } from "vitest";
import {
	DEFAULT_TRIGGER,
	DismissalState,
	TriggerSite,
	buildTriggerPattern,
	decideTrigger,
	dismissAt,
	dismissalOnClose,
	isCodeContext,
	isDismissed,
	isSuggestEnabled,
	matchTrigger,
	reconcileDismissal,
} from "../src/core/suggest";

const FLAGS_ON = { isMobile: false, isPhone: false, settingEnabled: true };

describe("isSuggestEnabled", () => {
	it("is on for desktop when the setting is on", () => {
		expect(isSuggestEnabled(FLAGS_ON)).toBe(true);
	});

	it("is off when the setting is off", () => {
		expect(isSuggestEnabled({ ...FLAGS_ON, settingEnabled: false })).toBe(false);
	});

	it("is off on a phone", () => {
		expect(isSuggestEnabled({ isMobile: true, isPhone: true, settingEnabled: true })).toBe(false);
	});

	it("stays on for a mobile tablet, which is the iPad case", () => {
		expect(isSuggestEnabled({ isMobile: true, isPhone: false, settingEnabled: true })).toBe(true);
	});

	it("is off on a phone even with the setting on and isMobile somehow false", () => {
		expect(isSuggestEnabled({ isMobile: false, isPhone: true, settingEnabled: true })).toBe(false);
	});
});

describe("buildTriggerPattern", () => {
	it("produces the documented default pattern", () => {
		expect(buildTriggerPattern(DEFAULT_TRIGGER).source).toBe("(?<!\\$)\\$\\/([A-Za-z0-9_-]*)$");
	});

	it("escapes regex metacharacters in a custom trigger", () => {
		expect(buildTriggerPattern("[[").test("see [[")).toBe(true);
	});
});

describe("matchTrigger", () => {
	it("fires on a bare trigger with an empty query", () => {
		expect(matchTrigger("hello $/", DEFAULT_TRIGGER)).toEqual({ query: "", start: 6, end: 8 });
	});

	it("captures the query after the trigger", () => {
		expect(matchTrigger("hello $/quad", DEFAULT_TRIGGER)).toEqual({ query: "quad", start: 6, end: 12 });
	});

	it("never fires on a bare dollar, so inline math typing is untouched", () => {
		expect(matchTrigger("cost is $5", DEFAULT_TRIGGER)).toBeNull();
		expect(matchTrigger("$x^2", DEFAULT_TRIGGER)).toBeNull();
		expect(matchTrigger("$", DEFAULT_TRIGGER)).toBeNull();
	});

	it("does not fire on a doubled delimiter", () => {
		expect(matchTrigger("$$/", DEFAULT_TRIGGER)).toBeNull();
	});

	it("stops at a character outside the query set", () => {
		expect(matchTrigger("$/quad form", DEFAULT_TRIGGER)).toBeNull();
	});

	it("covers the trigger characters so the whole span is replaced", () => {
		const match = matchTrigger("a $/pow", DEFAULT_TRIGGER);
		expect("a $/pow".slice(match?.start, match?.end)).toBe("$/pow");
	});

	it("honours a custom trigger and rejects an empty one", () => {
		expect(matchTrigger("text ;;eq", ";;")).toEqual({ query: "eq", start: 5, end: 9 });
		expect(matchTrigger("anything", "")).toBeNull();
	});
});

describe("isCodeContext", () => {
	it("is false in ordinary prose", () => {
		expect(isCodeContext(["# Notes", ""], "the value $/")).toBe(false);
	});

	it("is true inside an unclosed fenced block", () => {
		expect(isCodeContext(["```js", "const a = 1;"], "// $/")).toBe(true);
	});

	it("is false after the fence closes", () => {
		expect(isCodeContext(["```js", "const a = 1;", "```", ""], "$/")).toBe(false);
	});

	it("handles tilde fences and indented fences", () => {
		expect(isCodeContext(["~~~", "x"], "$/")).toBe(true);
		expect(isCodeContext(["  ```", "x"], "$/")).toBe(true);
	});

	it("is true inside an open inline code span", () => {
		expect(isCodeContext([], "run `npm $/")).toBe(true);
	});

	it("is false once the inline span closes", () => {
		expect(isCodeContext([], "run `npm` then $/")).toBe(false);
	});
});

describe("dismissal state", () => {
	const site: TriggerSite = { file: "notes.md", line: 3, start: 6 };

	it("suppresses only the exact span that was dismissed", () => {
		const state = dismissAt(site);
		expect(isDismissed(state, site)).toBe(true);
		expect(isDismissed(state, { ...site, line: 4 })).toBe(false);
		expect(isDismissed(state, { ...site, start: 7 })).toBe(false);
		expect(isDismissed(state, { ...site, file: "other.md" })).toBe(false);
	});

	it("treats a null state as never dismissed", () => {
		expect(isDismissed(null, site)).toBe(false);
	});

	it("keeps the dismissal while the cursor stays in the span", () => {
		expect(reconcileDismissal(dismissAt(site), site)).toEqual(site);
	});

	it("clears the dismissal once the cursor leaves the span", () => {
		expect(reconcileDismissal(dismissAt(site), { ...site, line: 9 })).toBeNull();
		expect(reconcileDismissal(dismissAt(site), { ...site, start: 20 })).toBeNull();
		expect(reconcileDismissal(dismissAt(site), { ...site, file: "other.md" })).toBeNull();
	});
});

describe("decideTrigger", () => {
	const context = (linePrefix: string, precedingLines: string[] = [], line = 0) => ({
		file: "notes.md",
		line,
		linePrefix,
		getPrecedingLines: () => precedingLines,
	});

	it("opens on a valid trigger", () => {
		const result = decideTrigger(context("solve $/qu"), DEFAULT_TRIGGER, FLAGS_ON, null);
		expect(result.decision?.match.query).toBe("qu");
		expect(result.decision?.site).toEqual({ file: "notes.md", line: 0, start: 6 });
	});

	it("stays shut on a phone", () => {
		const flags = { isMobile: true, isPhone: true, settingEnabled: true };
		expect(decideTrigger(context("solve $/qu"), DEFAULT_TRIGGER, flags, null).decision).toBeNull();
	});

	it("stays shut when the master toggle is off", () => {
		const flags = { ...FLAGS_ON, settingEnabled: false };
		expect(decideTrigger(context("solve $/qu"), DEFAULT_TRIGGER, flags, null).decision).toBeNull();
	});

	it("does not read the document above the cursor when nothing matches", () => {
		let reads = 0;
		const lazy = {
			file: "notes.md",
			line: 0,
			linePrefix: "just prose",
			getPrecedingLines: () => {
				reads += 1;
				return [];
			},
		};
		decideTrigger(lazy, DEFAULT_TRIGGER, FLAGS_ON, null);
		expect(reads).toBe(0);
	});

	it("stays shut inside a fenced block and inside an inline span", () => {
		expect(decideTrigger(context("$/q", ["```"]), DEFAULT_TRIGGER, FLAGS_ON, null).decision).toBeNull();
		expect(decideTrigger(context("`code $/q"), DEFAULT_TRIGGER, FLAGS_ON, null).decision).toBeNull();
	});

	describe("simulated key and cursor movement", () => {
		it("stays shut for the rest of the span once dismissed, then re-opens on a new span", () => {
			// The user types "$/qu" and the popup opens.
			const opened = decideTrigger(context("solve $/qu"), DEFAULT_TRIGGER, FLAGS_ON, null);
			expect(opened.decision).not.toBeNull();

			// Escape closes it; the shell records the dismissal for that span.
			let state: DismissalState = dismissAt(opened.decision!.site);

			// Typing another query character must not re-open it.
			const afterTyping = decideTrigger(context("solve $/qua"), DEFAULT_TRIGGER, FLAGS_ON, state);
			expect(afterTyping.decision).toBeNull();
			state = afterTyping.state;
			expect(state).not.toBeNull();

			// Backspacing back into the span must not re-open it either.
			const afterBackspace = decideTrigger(context("solve $/q"), DEFAULT_TRIGGER, FLAGS_ON, state);
			expect(afterBackspace.decision).toBeNull();
			state = afterBackspace.state;

			// Moving to the next line clears the dismissal ...
			const nextLine = decideTrigger(context("then $/po", [], 1), DEFAULT_TRIGGER, FLAGS_ON, state);
			expect(nextLine.decision?.match.query).toBe("po");
			expect(nextLine.state).toBeNull();
		});

		it("clears the dismissal when a new trigger starts later on the same line", () => {
			const state = dismissAt({ file: "notes.md", line: 0, start: 6 });
			const result = decideTrigger(context("solve $/qu and $/po"), DEFAULT_TRIGGER, FLAGS_ON, state);
			expect(result.decision?.site.start).toBe(15);
			expect(result.state).toBeNull();
		});

		it("clears the dismissal as soon as the trigger stops matching", () => {
			const state = dismissAt({ file: "notes.md", line: 0, start: 6 });
			const result = decideTrigger(context("solve for x"), DEFAULT_TRIGGER, FLAGS_ON, state);
			expect(result.decision).toBeNull();
			expect(result.state).toBeNull();
		});

		it("keeps the dismissal when the platform gate closes mid-span", () => {
			const state = dismissAt({ file: "notes.md", line: 0, start: 6 });
			const flags = { ...FLAGS_ON, settingEnabled: false };
			expect(decideTrigger(context("solve $/qu"), DEFAULT_TRIGGER, flags, state).state).toEqual(state);
		});
	});
});

describe("dismissalOnClose", () => {
	const site: TriggerSite = { file: "notes.md", line: 2, start: 4 };

	it("records a dismissal when the user closes a showing popup", () => {
		expect(dismissalOnClose(null, { site, hadSuggestions: true, accepting: false })).toEqual(site);
	});

	it("records nothing when the trigger had already stopped matching", () => {
		expect(dismissalOnClose(null, { site: null, hadSuggestions: true, accepting: false })).toBeNull();
	});

	it("records nothing when the query matched no equations, so the popup never showed", () => {
		expect(dismissalOnClose(null, { site, hadSuggestions: false, accepting: false })).toBeNull();
	});

	it("clears the state when a suggestion was accepted", () => {
		expect(dismissalOnClose(dismissAt(site), { site, hadSuggestions: true, accepting: true })).toBeNull();
	});

	it("leaves an existing dismissal alone on a teardown close", () => {
		const existing = dismissAt(site);
		expect(dismissalOnClose(existing, { site: null, hadSuggestions: false, accepting: false })).toEqual(existing);
	});

	it("re-arms the dismissal after backspacing out of a dead query and closing again", () => {
		// "$/zzz" matches nothing: the popup never showed, so nothing is recorded ...
		let state = dismissalOnClose(null, { site, hadSuggestions: false, accepting: false });
		expect(state).toBeNull();
		// ... and once the query matches again the popup is free to re-open.
		expect(isDismissed(state, site)).toBe(false);
		// Escape while it is showing then does suppress it.
		state = dismissalOnClose(state, { site, hadSuggestions: true, accepting: false });
		expect(isDismissed(state, site)).toBe(true);
	});
});
