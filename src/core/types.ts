// HTML AST
//
// A {@link HTMLInterface} parses HTML - a whole page or a bare fragment, which are the
// same shape here - into a typed AST: a discriminated union of plain readonly node
// values keyed by their `category`, the axis that varies (AGENTS design law: never
// `kind` / `type`). There is exactly one root, the {@link HTMLDocument}, and nothing is
// implied or inserted that the source did not write: no synthesized `html` / `head` /
// `body`, and a `<!DOCTYPE html>` is an ordinary {@link DoctypeNode} child in source
// order. Document parsing is total - every input produces a document, so there are no
// parse options, no issue list, and no errors; `parseStartTag` is the separate fail-closed
// source boundary. Every node is data with no behavior: the interface owns the
// traversal, rewrite, fold, sanitize, and distill operations over it, and each renderer
// is a downstream projection from the AST to a string.

/**
 * One attribute of an {@link ElementNode} - its `name` and, when the source wrote one,
 * its `value`.
 *
 * @remarks
 * `name` is ASCII-lowercased at parse, so `HREF` and `href` are the same attribute and a
 * duplicate keeps its first occurrence. `value` carries the only distinction HTML
 * actually makes: it is absent for a valueless attribute (`<input disabled>`) and `''`
 * for an explicitly empty one (`<input disabled="">`). Absence is `undefined` - there is
 * no sentinel value and no separate "minimized" flag, so a malformed or unterminated
 * attribute recovers to an absent value rather than to invented text.
 */
export interface HTMLAttribute {
	/** The attribute's ASCII-lowercased name. */
	readonly name: string
	/** The attribute's value; absent for a valueless attribute (`<input disabled>`). */
	readonly value?: string
}

/**
 * One unambiguous start tag parsed directly from source without recovery.
 *
 * @remarks
 * `name` and attribute names are ASCII-lowercased, while `next` remains an exact
 * UTF-16 source offset immediately after the closing `>`. `slashed` reports the
 * trailing solidus that was not absorbed into an attribute value; it does not claim the
 * named HTML element is semantically self-closing. The package deliberately retains its narrow
 * ASCII tag-name grammar. Malformed, ambiguous, duplicated, or incomplete source produces
 * no value through `parseStartTag`.
 */
export interface HTMLStartTag {
	/** The tag's ASCII-lowercased name. */
	readonly name: string
	/** The tag's ordered, ASCII-lowercased attributes. */
	readonly attributes: readonly HTMLAttribute[]
	/** Whether the tokenizer recognized a trailing solidus outside an attribute value. */
	readonly slashed: boolean
	/** The exclusive UTF-16 source offset immediately after the closing `>`. */
	readonly next: number
}

/** One start or close tag returned by the total, recovering `scanTag` scanner. */
export interface HTMLTag {
	/** The tag's ASCII-lowercased name. */
	readonly name: string
	/** The start tag's attributes; always empty for a close tag. */
	readonly attributes: readonly HTMLAttribute[]
	/** Whether the source token is a close tag. */
	readonly closing: boolean
	/** The exclusive UTF-16 source offset immediately after the recovered tag boundary. */
	readonly next: number
}

/**
 * An element - `<p>`, `<table>`, `<my-widget>`, or any other tag, known or custom.
 *
 * @remarks
 * `name` is the ASCII-lowercased tag name and `attributes` are its attributes in source
 * order. `children` is empty for a void element (`<br>`, `<img>`, …): voidness is
 * DERIVED from the tag name against `VOID_ELEMENTS`, never stored as a flag, so no
 * second fact can drift from the first. A raw-text element (`script`, `style`) holds
 * exactly one {@link TextNode} carrying its verbatim, undecoded body; a literal-text
 * element (`title`, `textarea`) holds one entity-decoded {@link TextNode}.
 */
export interface ElementNode {
	readonly category: 'element'
	/** The element's ASCII-lowercased tag name. */
	readonly name: string
	/** The element's attributes, in source order; a duplicate name keeps its first occurrence. */
	readonly attributes: readonly HTMLAttribute[]
	/** The element's content; empty for a void element. */
	readonly children: readonly HTMLNode[]
}

/**
 * A run of character data - the leaf node. `value` is the decoded text: numeric and
 * semicolon-terminated WHATWG named character references are already resolved (an unknown
 * named reference stays literal), and the renderer re-encodes `&`, `<`, and `>` on the way out.
 */
export interface TextNode {
	readonly category: 'text'
	/** The decoded text content (character references resolved, NOT yet re-encoded). */
	readonly value: string
}

/**
 * A comment - `<!-- … -->`. `value` is the comment's verbatim inner text, never decoded
 * and never parsed as markup. The parser constructs only representable values: they never
 * begin with an abrupt `>` / `->` close and never contain `-->` / `--!>`, so rendering and
 * reparsing a parser-produced comment preserves it exactly. A hand-built value can violate
 * that invariant, in which case the renderer drops it rather than emit a breakout.
 *
 * A bogus comment (`<?…>`, a non-doctype `<!…>`, or a CDATA section) recovers to this same
 * node, which is why the AST needs no processing instruction or CDATA category of its own.
 */
export interface CommentNode {
	readonly category: 'comment'
	/** The comment's verbatim inner text. */
	readonly value: string
}

/**
 * A document type declaration - `<!DOCTYPE html>` and its legacy public/system forms.
 *
 * @remarks
 * `name` is the declared root name (`html`). `public` and `system` are the external
 * identifiers of a legacy declaration, absent when the source omitted them; they keep
 * the vocabulary of the SGML declaration they come from rather than renaming it. A
 * doctype is an ordinary child in source order, and it survives sanitizing: it carries
 * structure, not risk.
 */
export interface DoctypeNode {
	readonly category: 'doctype'
	/** The declared root element name, ASCII-lowercased (`html`). */
	readonly name: string
	/** The public identifier of a legacy declaration, when one was written. */
	readonly public?: string
	/** The system identifier of a legacy declaration, when one was written. */
	readonly system?: string
}

/**
 * The root of a parsed AST - the ordered children of the whole input, whether that input
 * was a full page or one fragment. The value {@link HTMLInterface.document} holds.
 */
export interface HTMLDocument {
	readonly category: 'document'
	/** The top-level nodes, in source order. */
	readonly children: readonly HTMLNode[]
}

/**
 * Any node in an HTML AST - the {@link HTMLDocument} root or one of its descendants. The
 * exhaustive set every guard, traversal, fold table, and renderer covers, discriminated
 * by `category`.
 */
export type HTMLNode = HTMLDocument | ElementNode | TextNode | CommentNode | DoctypeNode

/**
 * A fold handler for one node category - receives the node and its children ALREADY
 * folded to `T`, and produces the node's own `T`. The building block of an
 * {@link HTMLHandlers} table.
 *
 * @param node - The node being folded
 * @param children - The node's children, each already folded to `T`; empty for a leaf
 * @returns The folded value of `node`
 */
export type HTMLHandler<TNode, T> = (node: TNode, children: readonly T[]) => T

/**
 * The total fold table for {@link HTMLInterface.fold} - one {@link HTMLHandler} per node
 * category, keyed by that category. Every key is required, because a fold is total over
 * the AST: there is no node it may skip.
 */
export interface HTMLHandlers<T> {
	/** Folds the {@link HTMLDocument} root from its already-folded children. */
	readonly document: HTMLHandler<HTMLDocument, T>
	/** Folds an {@link ElementNode} from its already-folded children (empty for a void element). */
	readonly element: HTMLHandler<ElementNode, T>
	/** Folds a {@link TextNode} (a leaf - always called with an empty children list). */
	readonly text: HTMLHandler<TextNode, T>
	/** Folds a {@link CommentNode} (a leaf - always called with an empty children list). */
	readonly comment: HTMLHandler<CommentNode, T>
	/** Folds a {@link DoctypeNode} (a leaf - always called with an empty children list). */
	readonly doctype: HTMLHandler<DoctypeNode, T>
}

/**
 * A copy-on-write node rewrite applied bottom-up by {@link HTMLInterface.map} - receives
 * one node whose children have already been rewritten and returns its replacement: the
 * same node unchanged, or a new one.
 *
 * @param node - The node to rewrite, with its children already rewritten
 * @returns The replacement node
 */
export type HTMLRewriteHandler = (node: HTMLNode) => HTMLNode

/**
 * A bottom-up pruning handler applied by `pruneDocument` - receives one node whose
 * children have already been pruned and returns the nodes that replace it.
 *
 * @param node - The node to prune, with its children already pruned
 * @returns No nodes to drop it, its children to unwrap it, or replacement nodes
 */
export type HTMLPruneHandler = (node: HTMLNode) => readonly HTMLNode[]

/**
 * The options for {@link HTMLInterface.sanitize}. Each allowlist key REPLACES its
 * default rather than extending it, so a caller who passes one narrows or redirects that
 * one axis and leaves the others alone.
 *
 * @remarks
 * - `elements` - the allowed element names, replacing the `SAFE_ELEMENTS` default.
 * - `attributes` - the allowed attribute names, replacing `SAFE_ATTRIBUTES`.
 * - `schemes` - the URL schemes allowed on a URL attribute, replacing `SAFE_URL_SCHEMES`.
 * - `comments` - keep comment nodes; they are dropped by default.
 *
 * A wider allowlist must never become a hole, so these options sit ON TOP of a floor
 * they cannot lower:
 * - every `UNSAFE_ELEMENTS` subtree is removed WHOLE, never unwrapped, so its text can
 *   never resurface as content;
 * - every case-insensitive `on*` handler attribute is removed, as are `style`, `srcdoc`,
 *   and namespace/`xlink` attributes;
 * - a `URL_ATTRIBUTES` value is entity-decoded and stripped of ASCII whitespace and
 *   control characters BEFORE its scheme is checked, and `javascript:`, `data:`,
 *   `vbscript:`, `file:`, and the protocol-relative forms (`//`, `\\`, `/\`) are refused
 *   whatever `schemes` says - only a relative URL or an allowed scheme survives, and a
 *   value that does not is removed rather than emptied;
 * - a safe element that is merely outside the allowlist is UNWRAPPED to its children, so
 *   wrapper soup melts while its content is kept, and a doctype survives untouched.
 *
 * Sanitizing is a fixpoint: sanitizing an already-sanitized document changes nothing,
 * and re-parsing sanitized output sanitizes to the same AST.
 */
export interface SanitizeOptions {
	/** The allowed element names, replacing the default safe element set. */
	readonly elements?: ReadonlySet<string> | readonly string[]
	/** The allowed attribute names, replacing the default safe attribute set. */
	readonly attributes?: ReadonlySet<string> | readonly string[]
	/** The URL schemes allowed on a URL attribute, replacing the default safe scheme set. */
	readonly schemes?: ReadonlySet<string> | readonly string[]
	/** Keep comment nodes instead of dropping them. */
	readonly comments?: boolean
}

/**
 * The options for {@link HTMLInterface.distill} - the content-extraction pass that
 * reduces a page to the prose a reader (or a language model) actually wants.
 *
 * @remarks
 * - `base` - the URL that relative `href` / `src` values are resolved against.
 * - `elements` - the element names kept as content, replacing the `CONTENT_ELEMENTS` default.
 * - `boilerplate` - the element names whose whole region is removed, replacing
 *   `BOILERPLATE_ELEMENTS`.
 *
 * Distilling always sanitizes with the defaults first - it is content extraction, not a
 * second security surface - and then, in order: removes each `boilerplate` region whole;
 * drops any element marked `hidden` or `aria-hidden="true"`; re-roots at the single
 * `main` or single `article` when exactly one exists; keeps the `elements` set and
 * unwraps everything else to its children; unwraps a wrapper whose only child is another
 * element; collapses inter-word whitespace outside `pre` and `code`; drops an empty
 * non-void element; and resolves relative `href` / `src` against `base`, leaving a value
 * it cannot resolve as written. The result is a pruned {@link HTMLInterface}, never a
 * string: rendering stays a separate, downstream choice.
 */
export interface DistillOptions {
	/** The URL that relative `href` / `src` values are resolved against. */
	readonly base?: string
	/** The element names kept as content, replacing the default content set. */
	readonly elements?: ReadonlySet<string> | readonly string[]
	/** The element names whose whole region is removed, replacing the default boilerplate set. */
	readonly boilerplate?: ReadonlySet<string> | readonly string[]
}

/**
 * A parsed HTML document: the typed {@link HTMLDocument} AST plus the query, rewrite,
 * fold, and reduction operations over it.
 *
 * @remarks
 * - **Immutable.** No method mutates the stored AST. `map`, `sanitize`, and `distill`
 *   each return a NEW {@link HTMLInterface}, and the root invariant
 *   (`category: 'document'`) always holds.
 * - **Traversal order.** `walk` / `find` / `filter` / `reduce` are depth-first,
 *   pre-order, and root-inclusive; `stream` is shallow - the root's direct children only.
 * - **`stream`.** A fresh, pull-based {@link ReadableStream} per call: one node is
 *   enqueued per `pull`, so a slow consumer's backpressure is respected and no work
 *   happens ahead of demand. Cancellable through the stream's own `cancel()` and
 *   pipeable through any {@link TransformStream} / {@link WritableStream}.
 * - **Roundtrip laws.** Parsing what the renderer wrote returns the same AST, and
 *   rendering that reparse returns the same string - so the AST is a fixpoint and the
 *   canonical serialization is idempotent. Sanitizing is a fixpoint too, through a
 *   reparse as well as directly. What roundtrips is the AST, NOT the input bytes:
 *   canonical output lowercases names, quotes every value, re-encodes character
 *   references minimally, writes `<br/>` as `<br>`, and keeps dropped constructs
 *   dropped. A hand-built AST that violates an invariant - a void element carrying
 *   children, a raw body containing its own close tag, an invalid tag name - is rendered
 *   for SAFETY rather than fidelity.
 * - **The surface.** `document` (the AST root), `walk` (the deep traversal), `find` /
 *   `filter` / `reduce` (queries built on `walk`), `map` (the bottom-up rewrite), `fold`
 *   (the total catamorphism), `stream` (the shallow backpressured source), and
 *   `sanitize` / `distill` (the two document-shaping engines).
 */
export interface HTMLInterface {
	/** The stored {@link HTMLDocument} AST root. */
	readonly document: HTMLDocument
	/**
	 * THE deep traversal - a lazy, depth-first, pre-order, root-inclusive
	 * {@link Generator} over every {@link HTMLNode} in the document. The sync
	 * `for (const node of html.walk())` surface is also consumable by
	 * `for await (const node of html.walk())`, so an async pipeline needs no second
	 * iterator. Contrast {@link HTMLInterface.stream}, which is shallow and
	 * backpressured.
	 */
	walk(): Generator<HTMLNode>
	/** Finds the first node (depth-first, pre-order) narrowed by a type guard. */
	find<T extends HTMLNode>(guard: (node: HTMLNode) => node is T): T | undefined
	/** Finds the first node (depth-first, pre-order) matching a predicate. */
	find(predicate: (node: HTMLNode) => boolean): HTMLNode | undefined
	/** Collects every node (depth-first, pre-order) narrowed by a type guard. */
	filter<T extends HTMLNode>(guard: (node: HTMLNode) => node is T): readonly T[]
	/** Collects every node (depth-first, pre-order) matching a predicate. */
	filter(predicate: (node: HTMLNode) => boolean): readonly HTMLNode[]
	/**
	 * Rewrites the AST bottom-up (copy-on-write) and returns a new
	 * {@link HTMLInterface}. A rewrite that returns its node unchanged shares that
	 * subtree instead of copying it.
	 */
	map(rewrite: HTMLRewriteHandler): HTMLInterface
	/** Reduces the AST depth-first, pre-order into one accumulated value. */
	reduce<T>(callback: (value: T, node: HTMLNode) => T, initial: T): T
	/** Runs a total catamorphism over the document using an {@link HTMLHandlers} table. */
	fold<T>(handlers: HTMLHandlers<T>): T
	/**
	 * A web-standard {@link ReadableStream} over the root's direct children (shallow,
	 * source order) - a lazy, pull-based, backpressure-respecting source. A fresh,
	 * independently replayable stream every call; never mutates the document.
	 */
	stream(): ReadableStream<HTMLNode>
	/**
	 * Removes every unsafe element, attribute, and URL and returns a new
	 * {@link HTMLInterface}. The floor documented on {@link SanitizeOptions} holds
	 * whatever the options say.
	 */
	sanitize(options?: SanitizeOptions): HTMLInterface
	/**
	 * Extracts the page's content - sanitizing first, then pruning boilerplate,
	 * chrome, and wrappers per {@link DistillOptions} - and returns a new
	 * {@link HTMLInterface}.
	 */
	distill(options?: DistillOptions): HTMLInterface
}
