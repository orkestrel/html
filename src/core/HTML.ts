import type {
	DistillOptions,
	ElementNode,
	HTMLDerivation,
	HTMLDocument,
	HTMLHandlers,
	HTMLInterface,
	HTMLNode,
	HTMLRewriteHandler,
	HTMLSpan,
	SanitizeOptions,
} from './types.js'
import { attempt } from '@orkestrel/contract'
import {
	BOILERPLATE_ELEMENTS,
	CONTENT_ELEMENTS,
	REGION_ELEMENTS,
	SAFE_ATTRIBUTES,
	SAFE_ELEMENTS,
	SAFE_URL_SCHEMES,
	UNSAFE_ELEMENTS,
	VOID_ELEMENTS,
} from './constants.js'
import {
	attributeOf,
	collapseText,
	extractRegion,
	foldNode,
	mergeText,
	pruneDocument,
	resolveAttributes,
	renderHTML,
	rewriteDocument,
	sanitizeAttributes,
	walkNodes,
} from './helpers.js'
import { parseDocument, parseProvenance } from './parsers.js'
import { isEmptyElement } from './validators.js'

/**
 * A parsed HTML document - the typed {@link HTMLDocument} AST plus the query
 * (`walk` / `find` / `filter` / `reduce`), rewrite (`map`), fold, streaming, and
 * document-shaping (`sanitize` / `distill`) operations {@link HTMLInterface} declares.
 *
 * @remarks
 * - **Construction.** Given a `string`, the constructor runs {@link parseProvenance}, which is
 *   total: every input parses, so there is nothing to catch. Given an {@link HTMLDocument},
 *   that document is adopted AS-IS and is NOT re-validated - gate an untrusted value with
 *   `isHTMLDocument` first.
 * - **Immutable.** Nothing here mutates the stored AST. `map`, `sanitize`, and `distill`
 *   each return a NEW `HTML`, and the root invariant (`category: 'document'`) always holds.
 * - **Traversal order.** `walk` and the queries built on it are depth-first, pre-order, and
 *   root-inclusive; `stream` is shallow - the root's direct children only.
 * - **The two engines.** `sanitize` enforces a security floor no option can lower;
 *   `distill` extracts content, sanitizing first because content extraction is not a second
 *   security surface. Both compose the pure leaves in `helpers.ts` over one shared
 *   bottom-up spine, {@link pruneDocument}.
 *
 * @example
 * ```ts
 * import { HTML, isElementNode, renderHTML } from '@orkestrel/html'
 *
 * const page = new HTML('<nav>skip</nav><main><h1>Title</h1><p onclick="x()">Body</p></main>')
 * const content = renderHTML(page.distill().document)
 * // '<h1>Title</h1><p>Body</p>'
 * page.find(isElementNode)?.name // 'nav' - the original document is untouched
 * ```
 */
export class HTML implements HTMLInterface {
	readonly #document: HTMLDocument
	readonly #spans: Map<HTMLNode, HTMLSpan>

	constructor(input: string | HTMLDocument) {
		if (typeof input === 'string') {
			const [document, spans] = parseProvenance(input)
			this.#document = document
			this.#spans = new Map(spans)
		} else {
			this.#document = input
			this.#spans = new Map()
		}
	}

	/** The stored {@link HTMLDocument} AST root. */
	get document(): HTMLDocument {
		return this.#document
	}

	/**
	 * Returns the half-open original-input region that produced a node in this handle's tree.
	 *
	 * @param node - The node whose provenance to look up
	 * @returns A fresh span value, or `undefined` when the node has no provenance here
	 */
	span(node: HTMLNode): HTMLSpan | undefined {
		const span = this.#spans.get(node)
		return span === undefined ? undefined : { start: span.start, end: span.end }
	}

	/**
	 * THE deep traversal - a lazy, depth-first, pre-order, root-inclusive generator over
	 * every {@link HTMLNode} in the document. `find`, `filter`, and `reduce` all iterate
	 * this one traversal, so a single ordering law covers the whole query surface.
	 *
	 * @example
	 * ```ts
	 * for (const node of page.walk()) {
	 *   // every node, depth-first, pre-order, root first
	 * }
	 *
	 * // also consumable by for-await - JS accepts a sync iterable there
	 * for await (const node of page.walk()) {
	 * }
	 * ```
	 */
	*walk(): Generator<HTMLNode> {
		yield* walkNodes(this.#document)
	}

	// Finds the first node (depth-first, pre-order) narrowed by a type guard.
	find<T extends HTMLNode>(guard: (node: HTMLNode) => node is T): T | undefined
	// Finds the first node (depth-first, pre-order) matching a predicate.
	find(predicate: (node: HTMLNode) => boolean): HTMLNode | undefined
	find(predicate: (node: HTMLNode) => boolean): HTMLNode | undefined {
		for (const node of this.walk()) if (predicate(node)) return node
		return undefined
	}

	// Collects every node (depth-first, pre-order) narrowed by a type guard.
	filter<T extends HTMLNode>(guard: (node: HTMLNode) => node is T): readonly T[]
	// Collects every node (depth-first, pre-order) matching a predicate.
	filter(predicate: (node: HTMLNode) => boolean): readonly HTMLNode[]
	filter(predicate: (node: HTMLNode) => boolean): readonly HTMLNode[] {
		const found: HTMLNode[] = []
		for (const node of this.walk()) if (predicate(node)) found.push(node)
		return found
	}

	/**
	 * Rewrites the AST bottom-up (copy-on-write) and returns a NEW {@link HTML}. A rewrite
	 * that returns its node unchanged shares that subtree instead of copying it, so an
	 * identity rewrite copies no node.
	 *
	 * @param rewrite - The bottom-up node rewrite
	 * @returns A new handle over the rewritten document
	 */
	map(rewrite: HTMLRewriteHandler): HTML {
		const [document, derivations] = rewriteDocument(this.#document, rewrite)
		return this.#derive(document, derivations)
	}

	/**
	 * Reduces the AST depth-first, pre-order into one accumulated value.
	 *
	 * @param callback - The accumulator step, receiving the value so far and one node
	 * @param initial - The initial accumulated value
	 * @returns The final accumulated value
	 */
	reduce<T>(callback: (value: T, node: HTMLNode) => T, initial: T): T {
		let value = initial
		for (const node of this.walk()) value = callback(value, node)
		return value
	}

	/**
	 * Runs a total catamorphism over the document: every node is folded from its own
	 * already-folded children, so a fold table is a complete, structure-aware projection -
	 * a renderer, a metric, a validator - with no traversal of its own.
	 *
	 * @param handlers - One handler per node category; a fold may skip no node
	 * @returns The folded value of the document root
	 */
	fold<T>(handlers: HTMLHandlers<T>): T {
		return foldNode(this.#document, handlers)
	}

	/**
	 * A web-standard {@link ReadableStream} over the root's direct children (shallow, source
	 * order) - a fresh, pull-based source per call: exactly one node is enqueued per `pull`,
	 * so a slow consumer's backpressure is respected and no work happens ahead of demand.
	 * Cancellable, independently replayable, and pipeable through any
	 * {@link TransformStream} / {@link WritableStream}.
	 *
	 * @example
	 * ```ts
	 * // universal - works in every ReadableStream-supporting environment
	 * const reader = page.stream().getReader()
	 * for (let result = await reader.read(); !result.done; result = await reader.read()) {
	 *   result.value // one top-level HTMLNode
	 * }
	 *
	 * // Node / Deno / Firefox iterate a ReadableStream natively
	 * for await (const node of page.stream()) {
	 * }
	 * ```
	 */
	stream(): ReadableStream<HTMLNode> {
		const children = this.#document.children
		let index = 0
		return new ReadableStream<HTMLNode>({
			pull(controller) {
				const node = children[index]
				if (node === undefined) {
					controller.close()
					return
				}
				controller.enqueue(node)
				index += 1
			},
		})
	}

	/**
	 * Removes every unsafe element, attribute, and URL and returns a NEW {@link HTML}.
	 *
	 * @remarks
	 * Each allowlist option REPLACES its default rather than extending it, and the floor
	 * documented on {@link SanitizeOptions} holds whatever the options say: an
	 * `UNSAFE_ELEMENTS` subtree goes whole, a handler / `style` / `srcdoc` / namespaced
	 * attribute always goes, a URL survives only as a relative or allowed-scheme value, a
	 * safe element outside the allowlist is unwrapped to its children rather than dropped,
	 * and a doctype is untouched. Unwrapping rejoins the text it splices together, so the
	 * result is a fixpoint both directly and through a reparse of its own serialization.
	 *
	 * @param options - The sanitize allowlists and comment policy
	 * @returns A new handle over the sanitized document
	 *
	 * @example
	 * ```ts
	 * const clean = page.sanitize({ attributes: new Set(['href', 'onclick']) })
	 * // `href` is kept, `onclick` is still stripped - the floor is not an allowlist
	 * ```
	 */
	sanitize(options?: SanitizeOptions): HTML {
		const outcome = attempt(() => {
			const elements = new Set(options?.elements ?? SAFE_ELEMENTS)
			const attributes = new Set(options?.attributes ?? SAFE_ATTRIBUTES)
			const schemes = new Set(options?.schemes ?? SAFE_URL_SCHEMES)
			const comments = options?.comments ?? false
			const [document, derivations] = pruneDocument(this.#document, (node) =>
				this.#cleanNode(node, elements, attributes, schemes, comments),
			)
			return this.#derive(document, derivations)
		})
		return outcome.success ? outcome.value : new HTML({ category: 'document', children: [] })
	}

	/**
	 * Extracts the page's content - the prose a reader, or a language model, actually wants -
	 * and returns a NEW {@link HTML}.
	 *
	 * @remarks
	 * The pipeline runs in five stages: every `boilerplate` region and every element marked
	 * `hidden` or `aria-hidden="true"` is dropped whole; the survivors are sanitized with the
	 * DEFAULTS, because distilling narrows content and never widens the security floor; the
	 * document is re-rooted at its single `main`, or failing that its single `article`, when
	 * exactly one exists; everything outside `elements` is unwrapped to its children, an
	 * attribute-free element wrapping only its own kind collapses, whitespace outside `pre`
	 * and `code` collapses to single spaces, and an empty non-void element is dropped; and
	 * finally every URL attribute is resolved against `base` when one is given. The result is
	 * a pruned {@link HTMLInterface}, never a string: rendering stays a downstream choice.
	 *
	 * The `hidden` stage runs BEFORE the sanitize stage by necessity - `hidden` and
	 * `aria-hidden` are outside `SAFE_ATTRIBUTES`, so sanitizing first would consume the
	 * evidence this stage reads. Pruning more before the floor is applied can never admit
	 * anything the floor would have refused.
	 *
	 * @param options - The base URL and the content and boilerplate element sets
	 * @returns A new handle over the distilled document
	 *
	 * @example
	 * ```ts
	 * const article = page.distill({ base: 'https://example.test/docs/page' })
	 * renderHTML(article.document) // canonical HTML, links absolute
	 * ```
	 */
	distill(options?: DistillOptions): HTML {
		const outcome = attempt(() => {
			const boilerplate = new Set(options?.boilerplate ?? BOILERPLATE_ELEMENTS)
			const elements = new Set(options?.elements ?? CONTENT_ELEMENTS)
			const base = options?.base
			const [visibleDocument, visibleDerivations] = pruneDocument(this.#document, (node) =>
				this.#pruneRegion(node, boilerplate),
			)
			const visible = this.#derive(visibleDocument, visibleDerivations)
			const clean = visible.sanitize()
			const [rootedDocument, regionDerivations] = extractRegion(clean.document, REGION_ELEMENTS)
			const rooted = clean.#derive(rootedDocument, regionDerivations)
			const nestedDerivations = new Map<HTMLNode, HTMLNode | undefined>()
			const [contentDocument, contentDerivations] = pruneDocument(rooted.document, (node) => {
				const [replacements, derivations] = this.#keepContent(node, elements, base)
				for (const [derived, source] of derivations) nestedDerivations.set(derived, source)
				return replacements
			})
			const derivations = new Map(contentDerivations)
			for (const [derived, source] of nestedDerivations) {
				if (!derivations.has(derived)) derivations.set(derived, source)
				else if (derivations.get(derived) !== source) derivations.set(derived, undefined)
			}
			return rooted.#derive(contentDocument, derivations)
		})
		return outcome.success ? outcome.value : new HTML({ category: 'document', children: [] })
	}

	// Creates a fresh handle and resolves each carried node through this operation's
	// one-source derivation chain. Unchanged references resolve directly by identity.
	// The entry is read once, for the node being resolved, because a handler that hands
	// back an original node gives that object an output entry of its own; every later hop
	// reads its span first, so a reused original terminates the chain on its own region
	// rather than following its unrelated output entry onto a foreign one.
	#derive(document: HTMLDocument, derivations: ReadonlyMap<HTMLNode, HTMLNode | undefined>): HTML {
		const derived = new HTML(document)
		const visited = new Set<HTMLNode>()
		for (const node of walkNodes(document)) {
			visited.clear()
			let source: HTMLNode | undefined = derivations.has(node) ? derivations.get(node) : node
			while (source !== undefined && !visited.has(source)) {
				visited.add(source)
				const span = this.#spans.get(source)
				if (span !== undefined) {
					derived.#spans.set(node, span)
					break
				}
				source = derivations.get(source)
			}
		}
		return derived
	}

	// The sanitize policy for one node, applied bottom-up by `pruneDocument`, which hands the
	// node its children already sanitized: the floor first (an unsafe subtree goes whole),
	// then the allowlist (a safe element outside it unwraps to its children), then the
	// attribute filter. Unwrapping splices text together, so every rebuilt list is rejoined.
	#cleanNode(
		node: HTMLNode,
		elements: ReadonlySet<string>,
		attributes: ReadonlySet<string>,
		schemes: ReadonlySet<string>,
		comments: boolean,
	): readonly HTMLNode[] {
		if (node.category === 'document') {
			return [{ category: 'document', children: mergeText(node.children) }]
		}
		if (node.category === 'comment') {
			if (!comments) return []
			const normalized = parseDocument(renderHTML(node)).children[0]
			return normalized?.category === 'comment' ? [normalized] : []
		}
		if (node.category === 'doctype') {
			const normalized = parseDocument(renderHTML(node)).children[0]
			return normalized?.category === 'doctype' ? [normalized] : []
		}
		if (node.category !== 'element') return [node]
		const name = node.name.toLowerCase()
		if (UNSAFE_ELEMENTS.includes(name)) return []
		if (!elements.has(name)) return node.children
		return [
			{
				category: 'element',
				name,
				attributes: sanitizeAttributes(node, attributes, schemes),
				children: VOID_ELEMENTS.includes(name) ? [] : mergeText(node.children),
			},
		]
	}

	// The distill region policy for one node: a boilerplate region and an author-hidden
	// element are noise in every reading of the page, so both go with their children.
	#pruneRegion(node: HTMLNode, boilerplate: ReadonlySet<string>): readonly HTMLNode[] {
		if (node.category === 'document') {
			return [{ category: 'document', children: mergeText(node.children) }]
		}
		if (node.category !== 'element') return [node]
		if (boilerplate.has(node.name.toLowerCase())) return []
		if (attributeOf(node, 'hidden') !== undefined) return []
		if (attributeOf(node, 'aria-hidden')?.trim().toLowerCase() === 'true') return []
		return [
			{
				category: 'element',
				name: node.name,
				attributes: node.attributes,
				children: mergeText(node.children),
			},
		]
	}

	// The distill content policy for one node: keep the content vocabulary, melt everything
	// else into it, and leave a `pre` / `code` body's whitespace exactly as written. Comments
	// and doctypes carry structure rather than content, so they end here.
	#keepContent(
		node: HTMLNode,
		elements: ReadonlySet<string>,
		base: string | undefined,
	): HTMLDerivation<readonly HTMLNode[]> {
		const derivations = new Map<HTMLNode, HTMLNode | undefined>()
		if (node.category === 'document') {
			const [children, collapsed] = collapseText(mergeText(node.children))
			return [[{ category: 'document', children }], collapsed]
		}
		if (node.category === 'text') return [[node], derivations]
		if (node.category !== 'element') return [[], derivations]
		const name = node.name.toLowerCase()
		if (!elements.has(name)) return [node.children, derivations]
		const merged = mergeText(node.children)
		const literal = name === 'pre' || name === 'code'
		const [content, collapsed] = literal ? [merged, derivations] : collapseText(merged)
		const childless = VOID_ELEMENTS.includes(name)
		const kept: ElementNode = {
			category: 'element',
			name,
			attributes: base === undefined ? node.attributes : resolveAttributes(node, base),
			children: childless ? [] : content,
		}
		if (!childless && isEmptyElement(kept)) return [[], collapsed]
		const only = content[0]
		if (
			content.length === 1 &&
			node.attributes.length === 0 &&
			only !== undefined &&
			only.category === 'element' &&
			only.name === name
		) {
			return [[only], collapsed]
		}
		return [[kept], collapsed]
	}
}
