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
 * MathLive defines `\ldots`, `\cdots`, `\ddots` and `\mathellipsis` as symbols
 * but never `\dots` itself, even though it is standard amsmath LaTeX that
 * Obsidian's own MathJax renderer accepts — so an equation using `\dots`
 * displays fine in the note but renders as nothing here. Rewriting the bare
 * command to `\ldots` before handing LaTeX to MathLive fixes the display
 * without touching what is stored in the catalog or inserted into the note.
 */
function normalizeForMathLive(latex: string): string {
	return latex.replace(/\\dots(?![a-zA-Z])/g, "\\ldots");
}

/**
 * Renders LaTeX to static markup. Incomplete or invalid LaTeX renders as
 * MathLive's own error markup rather than throwing, which is what lets a tile
 * or a preview show something useful while an equation is still being typed.
 */
export function renderLatexToMarkup(latex: string, mode: InsertMode): string {
	try {
		return convertLatexToMarkup(normalizeForMathLive(latex), {
			defaultMode: mode === "block" ? "math" : "inline-math",
		});
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
	/** Replaces the field contents. */
	setLatex(latex: string): void;
	focus(): void;
	/** Detaches listeners and removes the element. */
	destroy(): void;
}

export interface MathFieldOptions {
	readonly initialLatex: string;
	readonly virtualKeyboard: boolean;
	/**
	 * When true the field renders LaTeX but rejects typing and pasting — it is
	 * a live preview, not an editor. The LaTeX source textarea is the only way
	 * to change the equation.
	 */
	readonly readOnly: boolean;
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
	field.readOnly = options.readOnly;
	field.value = normalizeForMathLive(options.initialLatex);
	parent.appendChild(field);

	return {
		getLatex: () => field.getValue("latex"),
		setLatex: (latex: string) => {
			const normalized = normalizeForMathLive(latex);
			if (field.getValue("latex") === normalized) return;
			field.setValue(normalized, { silenceNotifications: true });
		},
		focus: () => field.focus(),
		destroy: () => {
			field.remove();
		},
	};
}

/** Hides the on-screen math keyboard, if one is showing. */
export function hideVirtualKeyboard(): void {
	if (typeof window.mathVirtualKeyboard !== "undefined") window.mathVirtualKeyboard.hide();
}

/** Pixel scale for the rasterized PNG, so a copy still looks sharp when pasted larger. */
const PNG_EXPORT_SCALE = 3;
/** Breathing room around the glyphs, baked into both the measurement and the final image. */
const PNG_EXPORT_PADDING = 8;

/**
 * Renders LaTeX to a PNG `Blob` by rasterizing MathLive's own markup.
 *
 * MathLive has no built-in image export, so this measures the markup's
 * natural size in a hidden element, redraws it inside an SVG `foreignObject`
 * (with the bundled stylesheet inlined, since a detached SVG document cannot
 * see the host document's `<style>` tags), and rasterizes that through a
 * canvas. The background is left transparent and the glyphs forced to black
 * so the copied equation reads correctly once pasted, regardless of the
 * paste destination's own background or Obsidian's active theme.
 */
export async function renderLatexToPngBlob(doc: Document, latex: string, mode: InsertMode): Promise<Blob> {
	const markup = renderLatexToMarkup(latex, mode);
	if (markup.length === 0) throw new Error("There is nothing to render.");

	const win = doc.defaultView as (Window & typeof globalThis) | null;
	if (!win) throw new Error("This equation's window is no longer open.");

	ensureMathLiveStyles(doc);
	const boxStyle = `display:inline-block;padding:${PNG_EXPORT_PADDING}px;color:#000;background:transparent;`;

	const measure = doc.createElement("div");
	measure.style.cssText = `position:fixed;left:-99999px;top:0;visibility:hidden;${boxStyle}`;
	measure.innerHTML = markup;
	doc.body.appendChild(measure);
	if (doc.fonts) await doc.fonts.ready;
	const rect = measure.getBoundingClientRect();
	const width = Math.max(1, Math.ceil(rect.width));
	const height = Math.max(1, Math.ceil(rect.height));
	measure.remove();

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
		`<foreignObject width="100%" height="100%">` +
		`<div xmlns="http://www.w3.org/1999/xhtml" style="${boxStyle}">` +
		`<style>${mathliveStyles}</style>${markup}</div>` +
		`</foreignObject></svg>`;

	const svgUrl = win.URL.createObjectURL(new win.Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
	try {
		const image = new win.Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Could not rasterize the equation."));
			image.src = svgUrl;
		});

		const canvas = doc.createElement("canvas");
		canvas.width = width * PNG_EXPORT_SCALE;
		canvas.height = height * PNG_EXPORT_SCALE;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("This window cannot render a canvas.");
		ctx.scale(PNG_EXPORT_SCALE, PNG_EXPORT_SCALE);
		ctx.drawImage(image, 0, 0, width, height);

		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create a PNG."))), "image/png");
		});
	} finally {
		win.URL.revokeObjectURL(svgUrl);
	}
}

/** Renders `latex` to a PNG and writes it to the system clipboard as an image. */
export async function copyLatexAsPng(doc: Document, latex: string, mode: InsertMode): Promise<void> {
	const win = doc.defaultView as (Window & typeof globalThis) | null;
	if (!win?.navigator.clipboard?.write) throw new Error("This window cannot write images to the clipboard.");
	const blob = await renderLatexToPngBlob(doc, latex, mode);
	await win.navigator.clipboard.write([new win.ClipboardItem({ "image/png": blob })]);
}
