/**
 * The decision logic behind the editor autocomplete: when it may fire, where
 * in the line it fires, and the dismissal state that stops it re-opening at a
 * position the user just dismissed.
 *
 * Pure module: no `obsidian`, DOM or Node imports. The shell reads the
 * platform flags and the editor text and passes them in, which turns two
 * otherwise untestable checks (phone detection, cursor movement) into unit
 * tested functions.
 */

/** The default two-character trigger. A bare `$` must never open the popup. */
export const DEFAULT_TRIGGER = "$/";

/** Characters accepted in the query that follows the trigger. */
const QUERY_CHARS = "[A-Za-z0-9_-]*";

export interface PlatformFlags {
	/** `Platform.isMobile` — true on both phones and tablets. */
	readonly isMobile: boolean;
	/** `activeDocument.body.classList.contains("is-phone")`. */
	readonly isPhone: boolean;
	/** The master enable/disable toggle from the settings panel. */
	readonly settingEnabled: boolean;
}

/**
 * Whether the suggester may run at all.
 *
 * Phones are excluded because the popup fights the on-screen keyboard; tablets
 * are not, which is why `isMobile` alone is never the test. The phone signal
 * comes from Obsidian's own `is-phone` body class, never from the user agent —
 * iPadOS reports itself as a Macintosh and cannot be distinguished that way.
 *
 * Called on every trigger rather than cached at load, so a device that changes
 * class (an iPad in a Stage Manager window, a settings change) is picked up
 * immediately.
 */
export function isSuggestEnabled(flags: PlatformFlags): boolean {
	return flags.settingEnabled && !flags.isPhone;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Builds the trigger pattern for a trigger string.
 *
 * The lookbehind on the first character stops a doubled delimiter from firing,
 * so `$$/` in a display-math block is left alone. For the default trigger this
 * is exactly `/(?<!\$)\$\/([A-Za-z0-9_-]*)$/`.
 */
export function buildTriggerPattern(trigger: string): RegExp {
	const escaped = escapeRegex(trigger);
	const guard = trigger.length > 0 ? `(?<!${escapeRegex(trigger[0])})` : "";
	return new RegExp(`${guard}${escaped}(${QUERY_CHARS})$`);
}

export interface TriggerMatch {
	/** Text typed after the trigger; empty means "list everything". */
	readonly query: string;
	/** Offset of the first trigger character in the line. */
	readonly start: number;
	/** Offset just past the query, i.e. the cursor position. */
	readonly end: number;
}

/**
 * Matches the trigger against the text before the cursor on the current line.
 * `start` covers the trigger characters themselves, so accepting a suggestion
 * replaces the whole `$/query` span and never leaves a stray trigger behind.
 */
export function matchTrigger(linePrefix: string, trigger: string): TriggerMatch | null {
	if (trigger.length === 0) return null;
	const match = buildTriggerPattern(trigger).exec(linePrefix);
	if (!match) return null;
	const query = match[1];
	const end = linePrefix.length;
	return { query, start: end - query.length - trigger.length, end };
}

/**
 * Whether the cursor sits inside a fenced code block or an inline code span.
 *
 * Fences are counted over the lines above the cursor (a ``` or ~~~ run at the
 * start of a line toggles the block); inline spans are detected by an odd
 * number of backtick runs in the text before the cursor on the current line.
 */
export function isCodeContext(precedingLines: readonly string[], linePrefix: string): boolean {
	let fence: string | null = null;
	for (const line of precedingLines) {
		const match = /^\s*(`{3,}|~{3,})/.exec(line);
		if (!match) continue;
		const marker = match[1][0];
		if (fence === null) fence = marker;
		else if (fence === marker) fence = null;
	}
	if (fence !== null) return true;

	const runs = linePrefix.match(/`+/g);
	return runs !== null && runs.length % 2 === 1;
}

/**
 * Where a dismissal applies. A dismissal is pinned to the start of the trigger
 * span rather than to the cursor, so typing more query characters after
 * pressing Escape does not re-open the popup for the same span.
 */
export interface TriggerSite {
	readonly file: string;
	readonly line: number;
	readonly start: number;
}

export type DismissalState = TriggerSite | null;

/** Records that the user dismissed the popup at `site`. */
export function dismissAt(site: TriggerSite): DismissalState {
	return { file: site.file, line: site.line, start: site.start };
}

/** True when `site` is the span the user dismissed, so the popup must stay shut. */
export function isDismissed(state: DismissalState, site: TriggerSite): boolean {
	if (state === null) return false;
	return state.file === site.file && state.line === site.line && state.start === site.start;
}

/**
 * Drops a stale dismissal. Moving to another line, another file, or starting a
 * new trigger span on the same line all clear it; staying inside the dismissed
 * span keeps it.
 */
export function reconcileDismissal(state: DismissalState, site: TriggerSite): DismissalState {
	return isDismissed(state, site) ? state : null;
}

/**
 * What the shell knows at the moment the popup closes.
 *
 * Obsidian closes an `EditorSuggest` for three different reasons, and only one
 * of them is a dismissal:
 *
 * - the trigger stopped matching, so the suggester is simply torn down
 *   (`site` is null — the last `onTrigger` returned nothing);
 * - the query matched no equations, so the popup was never on screen
 *   (`hadSuggestions` is false);
 * - the user pressed Escape or clicked away while the list was showing, which
 *   is the one case that must suppress a re-trigger at the same span.
 *
 * Accepting a suggestion rewrites the text, so it clears the state instead.
 */
export interface CloseContext {
	/** The span the most recent `onTrigger` matched, or null if it matched none. */
	readonly site: TriggerSite | null;
	/** Whether the popup was showing suggestions when it closed. */
	readonly hadSuggestions: boolean;
	/** Whether this close follows an accepted suggestion. */
	readonly accepting: boolean;
}

/** The dismissal state after a close. */
export function dismissalOnClose(state: DismissalState, close: CloseContext): DismissalState {
	if (close.accepting) return null;
	if (close.site === null || !close.hadSuggestions) return state;
	return dismissAt(close.site);
}

export interface TriggerContext {
	readonly file: string;
	readonly line: number;
	readonly linePrefix: string;
	/**
	 * The lines above the cursor, as a thunk. It is only called once the
	 * trigger has already matched, so the common keystroke — which matches
	 * nothing — never pays to read the document above the cursor.
	 */
	readonly getPrecedingLines: () => readonly string[];
}

export interface TriggerDecision {
	readonly match: TriggerMatch;
	readonly site: TriggerSite;
}

/**
 * The whole "should the popup open here?" decision in one testable function:
 * platform gate, code-context gate, trigger match, dismissal gate. Returns the
 * span to replace, or `null` to leave the keystroke alone.
 *
 * `state` is the dismissal state as it stands *after* this call — the caller
 * stores it back, which is how a dismissal is cleared once the cursor leaves.
 */
export function decideTrigger(
	context: TriggerContext,
	trigger: string,
	flags: PlatformFlags,
	state: DismissalState,
): { decision: TriggerDecision | null; state: DismissalState } {
	if (!isSuggestEnabled(flags)) return { decision: null, state };

	const match = matchTrigger(context.linePrefix, trigger);
	if (!match) return { decision: null, state: null };

	if (isCodeContext(context.getPrecedingLines(), context.linePrefix)) return { decision: null, state };

	const site: TriggerSite = { file: context.file, line: context.line, start: match.start };
	const reconciled = reconcileDismissal(state, site);
	if (isDismissed(reconciled, site)) return { decision: null, state: reconciled };
	return { decision: { match, site }, state: reconciled };
}
