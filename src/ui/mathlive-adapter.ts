/**
 * The single point of contact between this plugin and MathLive.
 *
 * Every MathLive API call in the plugin lives here: the live `<math-field>`
 * editor, the static `convertLatexToMarkup()` renderer used by the library
 * tiles and the autocomplete previews, the global configuration, and the
 * bundled stylesheet. Replacing or upgrading the math engine is therefore a
 * one-file change, and no module under `src/core/` imports from `mathlive`.
 *
 * MathLive is the only math engine used. Obsidian's own `renderMath()` /
 * `finishRenderMath()` are deliberately never called: MathJax is a renderer,
 * not an editor, and cannot display incomplete LaTeX as it is being typed.
 */
import "mathlive";
import { MathfieldElement, convertLatexToMarkup } from "mathlive";
import { InsertMode } from "../core/latex";
import mathliveStyles from "../generated/mathlive-bundled.css";

const STYLE_ID = "equation-library-mathlive-styles";

/** Style elements this plugin injected, so `onunload` can remove every one. */
const injectedStyles = new Set<HTMLStyleElement>();

/**
 * The `math-field` custom element is registered once per window, by whichever
 * copy of the bundle loaded first. After a plugin reload our freshly bundled
 * `MathfieldElement` class is no longer the registered one, so instances are
 * created through `createElement` and statics are set on the constructor the
 * registry actually holds.
 */
function registeredMathfield(): typeof MathfieldElement {
	const registered = window.customElements?.get("math-field");
	return (registered as typeof MathfieldElement | undefined) ?? MathfieldElement;
}

export interface MathLiveConfig {
	/** Show MathLive's on-screen math keyboard. Mobile only. */
	readonly virtualKeyboard: boolean;
}

/**
 * Applies the global MathLive configuration.
 *
 * `soundsDirectory` and `fontsDirectory` are both nulled: the keypress sounds
 * are never bundled, and the KaTeX fonts are served from data URIs inside the
 * stylesheet, so MathLive must not try to fetch either from disk.
 */
export function configureMathLive(config: MathLiveConfig): void {
	const mathfield = registeredMathfield();
	mathfield.soundsDirectory = null;
	mathfield.fontsDirectory = null;
	if (!config.virtualKeyboard && typeof window.mathVirtualKeyboard !== "undefined") {
		window.mathVirtualKeyboard.hide();
	}
}

/**
 * Injects the MathLive stylesheet into a document if it is not already there.
 *
 * The sheet ships inside `main.js` with its twenty KaTeX fonts inlined as data
 * URIs, because Obsidian installs only `main.js`, `manifest.json` and
 * `styles.css` — there is nowhere to put font files. A document is passed in so
 * that a popped-out window gets its own copy.
 */
export function ensureMathLiveStyles(doc: Document): void {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = mathliveStyles;
	doc.head.appendChild(style);
	injectedStyles.add(style);
}

/** Removes every stylesheet this plugin injected. Called from `onunload`. */
export function removeMathLiveStyles(): void {
	for (const style of injectedStyles) style.remove();
	injectedStyles.clear();
}

/**
 * Renders LaTeX to static markup. Incomplete or invalid LaTeX renders as
 * MathLive's own error markup rather than throwing, which is what lets a tile
 * or a preview show something useful while an equation is still being typed.
 */
export function renderLatexToMarkup(latex: string, mode: InsertMode): string {
	try {
		return convertLatexToMarkup(latex, { defaultMode: mode === "block" ? "math" : "inline-math" });
	} catch {
		return "";
	}
}

/**
 * Renders LaTeX into `target`.
 *
 * The markup comes from MathLive's own converter, which escapes the LaTeX it is
 * given; this is the documented way to display its static output.
 */
export function renderLatexInto(target: HTMLElement, latex: string, mode: InsertMode): void {
	ensureMathLiveStyles(target.ownerDocument);
	const markup = renderLatexToMarkup(latex, mode);
	if (markup.length > 0) {
		target.innerHTML = markup;
	} else {
		target.setText(latex);
	}
}

export interface MathFieldHandle {
	/** The LaTeX currently in the field. */
	getLatex(): string;
	/** Replaces the field contents without firing the change callback. */
	setLatex(latex: string): void;
	focus(): void;
	/** Detaches listeners and removes the element. */
	destroy(): void;
}

export interface MathFieldOptions {
	readonly initialLatex: string;
	readonly virtualKeyboard: boolean;
	/** Fired on user edits only, never on a programmatic `setLatex`. */
	readonly onInput: (latex: string) => void;
}

/**
 * Creates a live `<math-field>` inside `parent`.
 *
 * The element is created through `createElement` rather than `new
 * MathfieldElement()` so that it is always an instance of the class the window
 * has actually registered — see `registeredMathfield`.
 */
export function createMathField(parent: HTMLElement, options: MathFieldOptions): MathFieldHandle {
	const doc = parent.ownerDocument;
	ensureMathLiveStyles(doc);

	const field = doc.createElement("math-field") as MathfieldElement;
	field.addClass("eqlib-mathfield");
	field.mathVirtualKeyboardPolicy = options.virtualKeyboard ? "auto" : "manual";
	field.smartMode = false;
	field.value = options.initialLatex;
	parent.appendChild(field);

	let suppress = false;
	const onInput = (): void => {
		if (suppress) return;
		options.onInput(field.getValue("latex"));
	};
	field.addEventListener("input", onInput);

	return {
		getLatex: () => field.getValue("latex"),
		setLatex: (latex: string) => {
			if (field.getValue("latex") === latex) return;
			suppress = true;
			try {
				field.setValue(latex, { silenceNotifications: true });
			} finally {
				suppress = false;
			}
		},
		focus: () => field.focus(),
		destroy: () => {
			field.removeEventListener("input", onInput);
			field.remove();
		},
	};
}

/** Hides the on-screen math keyboard, if one is showing. */
export function hideVirtualKeyboard(): void {
	if (typeof window.mathVirtualKeyboard !== "undefined") window.mathVirtualKeyboard.hide();
}
