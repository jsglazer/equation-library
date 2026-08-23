/**
 * The `$/` editor autocomplete.
 *
 * This class is a thin shell: it reads the editor and the platform, hands both
 * to the pure decision logic in `src/core/suggest.ts`, and applies whatever
 * that logic returns. The trigger is a two-character sequence (`$/` by
 * default), never a bare `$`, so ordinary inline math typing is untouched.
 */
import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Platform, TFile } from "obsidian";
import { Equation } from "../core/types";
import { EquationLibrarySettings, SUGGEST_LIMIT } from "../core/settings";
import { matchSuggestions } from "../core/search";
import { resolveInsertMode, wrapDelimiters } from "../core/latex";
import { DismissalState, TriggerSite, decideTrigger, dismissalOnClose } from "../core/suggest";
import { renderLatexInto } from "../ui/mathlive-adapter";

export interface SuggestDeps {
	readonly getSettings: () => EquationLibrarySettings;
	readonly getEquations: () => readonly Equation[];
	readonly onAccept: (equation: Equation, inserted: string) => void;
}

export class EquationSuggest extends EditorSuggest<Equation> {
	private dismissal: DismissalState = null;
	/** The span the most recent `onTrigger` matched, or null if it matched none. */
	private lastSite: TriggerSite | null = null;
	/** Whether the popup was showing suggestions the last time it was updated. */
	private hadSuggestions = false;
	/** Set for the duration of an accept, so the accept's close is not a dismissal. */
	private accepting = false;

	constructor(app: App, private readonly deps: SuggestDeps) {
		super(app);
		this.limit = SUGGEST_LIMIT;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const settings = this.deps.getSettings();
		const line = editor.getLine(cursor.line);
		const result = decideTrigger(
			{
				file: file?.path ?? "",
				line: cursor.line,
				linePrefix: line.slice(0, cursor.ch),
				getPrecedingLines: () =>
					editor.getRange({ line: 0, ch: 0 }, { line: cursor.line, ch: 0 }).split("\n"),
			},
			settings.suggestTrigger,
			{
				isMobile: Platform.isMobile,
				// Obsidian's own body class, never the user agent: iPadOS reports
				// itself as a Macintosh and cannot be told apart that way.
				isPhone: activeDocument.body.classList.contains("is-phone"),
				settingEnabled: settings.suggestEnabled,
			},
			this.dismissal,
		);

		this.dismissal = result.state;
		this.lastSite = result.decision?.site ?? null;
		if (!result.decision) return null;

		const { match } = result.decision;
		return {
			start: { line: cursor.line, ch: match.start },
			end: { line: cursor.line, ch: match.end },
			query: match.query,
		};
	}

	getSuggestions(context: EditorSuggestContext): Equation[] {
		const suggestions = matchSuggestions(this.deps.getEquations(), context.query, SUGGEST_LIMIT);
		// Obsidian closes the popup when this list is empty; remembering that
		// keeps such a close from being mistaken for a user dismissal.
		this.hadSuggestions = suggestions.length > 0;
		return suggestions;
	}

	renderSuggestion(equation: Equation, el: HTMLElement): void {
		el.addClass("eqlib-suggestion");
		const preview = el.createDiv({ cls: "eqlib-suggestion-preview" });
		renderLatexInto(preview, equation.latex, "inline");
		const meta = el.createDiv({ cls: "eqlib-suggestion-meta" });
		meta.createDiv({ cls: "eqlib-suggestion-name", text: equation.name });
		meta.createDiv({ cls: "eqlib-suggestion-category", text: equation.category });
	}

	selectSuggestion(equation: Equation, event: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;

		const settings = this.deps.getSettings();
		const inserted = wrapDelimiters(equation.latex, resolveInsertMode(settings.insertFormat, event.shiftKey));

		this.accepting = true;
		try {
			// Replacing from `start` swallows the trigger characters too, so no
			// stray `$/` is ever left behind in the document.
			context.editor.replaceRange(inserted, context.start, context.end);
			context.editor.setCursor({ line: context.start.line, ch: context.start.ch + inserted.length });
			this.close();
		} finally {
			this.accepting = false;
		}
		this.deps.onAccept(equation, inserted);
	}

	close(): void {
		this.dismissal = dismissalOnClose(this.dismissal, {
			site: this.lastSite,
			hadSuggestions: this.hadSuggestions,
			accepting: this.accepting,
		});
		this.hadSuggestions = false;
		super.close();
	}
}
