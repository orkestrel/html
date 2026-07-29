import type { HTMLDocument, HTMLNode } from '@src/core'
import { MAX_DEPTH, parseDocument } from '@src/core'

// ── Call recorder (a real callback, not a mock) ──────────────────────────────
//
// The test rules require a recording callback when a test only needs to count calls or inspect arguments:
// recorder — a real listener that records every invocation — rather than a test-
// framework spy. `handler` is a genuine callback; `calls` is each invocation's
// argument tuple, in order.

/** A real call-recording callback over an argument tuple, following `.claude/rules/tests.md`. */
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

/**
 * Create a {@link TestRecorderInterface} — a real callback that records each
 * invocation's arguments, for asserting what fired and with what, following
 * `.claude/rules/tests.md`.
 *
 * @typeParam TArgs - The argument tuple the recorded handler receives
 * @returns A recorder whose `handler` records into `calls`
 */
export function createRecorder<TArgs extends readonly unknown[]>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler(...args: TArgs) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/** Whether a repository-relative Vue SFC belongs to the private browser application. */
export function isBrowserVuePath(path: string): boolean {
	const normalized = path.replaceAll('\\', '/')
	return normalized.startsWith('app/browser/')
}

/**
 * Build a deeply nested HTML source around one text leaf.
 *
 * @param depth - The number of nested `div` start and close tags
 * @param leaf - The text placed at the deepest point
 * @returns The nested HTML source
 */
export function buildDeepHTMLInput(depth: number, leaf = 'leaf'): string {
	return `${'<div>'.repeat(depth)}${leaf}${'</div>'.repeat(depth)}`
}

/**
 * Build a representative parser-produced corpus for HTML roundtrip laws.
 *
 * @returns Documents covering realistic pages and every parser recovery family
 */
export function buildHTMLRoundtripCorpus(): readonly HTMLDocument[] {
	const sources = [
		'',
		'plain text &amp; entities',
		'<!DOCTYPE html><main><article><h1>Title</h1><p>Lead <strong>bold</strong>.</p></article></main>',
		'<html lang=en><head><title>A &amp; B</title></head><body><nav>Menu</nav><main><p>Body<br>line</p></main></body></html>',
		'<p>a<br>b</br>c<img src=x></p>',
		'<script>if (a < b) &amp;<style>x</style></SCRIPT><style><b>&copy;</b></style>',
		'<title>&lt;b&gt;&amp;</TITLE><textarea>&copy;</textarea>',
		'<ul><li>a<li>b</ul>',
		'<dl><dt>a<dd>b<dt>c</dl>',
		'<select><option>a<option>b<optgroup><option>c</select>',
		'<ruby><rt>a<rp>b<rt>c</ruby>',
		'<p>one<div>two</div><table><tr><td>x<td>y<tr><th>z</table>',
		'<b><i>x</b>y</i>',
		'</p>kept</unknown>',
		'<my-widget data-x=1>hello</my-widget>',
		'<DIV ID=first id=second CLASS="x">x</DIV>',
		'<div disabled title="oops><p>safe</p>',
		'1 < 2 <<x',
		'<?work?><!ENTITY x><![CDATA[a<b]]>',
		'a<!--open',
		'<div>kept<span',
		buildDeepHTMLInput(MAX_DEPTH + 20, 'deep text'),
		'<p>a\r\nb\rc\0d</p>',
		'before<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "legacy.dtd">after',
		'<a>one<b>two</a>three</b><custom>four',
		'<script>unterminated <b>&amp;',
	]
	return sources.map((source) => parseDocument(source))
}

/**
 * Build a hand-authored document deeper than the parser permits.
 *
 * @param depth - The number of nested elements
 * @returns A deep document ending in one text node
 */
export function buildDeepHTMLDocument(depth: number): HTMLDocument {
	let node: HTMLNode = { category: 'text', value: 'leaf' }
	for (let index = 0; index < depth; index += 1) {
		node = { category: 'element', name: 'div', attributes: [], children: [node] }
	}
	return { category: 'document', children: [node] }
}

/**
 * Build a deeply nested from-unknown element shape.
 *
 * @param depth - The number of nested element nodes
 * @returns A document-shaped unknown value
 */
export function buildDeepHTMLNode(depth: number): unknown {
	let node: unknown = { category: 'text', value: 'leaf' }
	for (let index = 0; index < depth; index += 1) {
		node = { category: 'element', name: 'div', attributes: [], children: [node] }
	}
	return { category: 'document', children: [node] }
}

/**
 * Build a cyclic from-unknown element shape.
 *
 * @returns An element whose child points back to itself
 */
export function buildCyclicHTMLNode(): unknown {
	const children: unknown[] = []
	const node = { category: 'element', name: 'div', attributes: [], children }
	children.push(node)
	return node
}

/**
 * Throw from a hostile property getter.
 *
 * @returns Never
 */
export function throwHostileHTMLGetter(): never {
	throw new Error('hostile HTML getter')
}

/**
 * Build a value whose discriminant getter throws.
 *
 * @returns The hostile from-unknown value
 */
export function buildHostileHTMLNode(): unknown {
	const node = {}
	Object.defineProperty(node, 'category', {
		enumerable: true,
		get: throwHostileHTMLGetter,
	})
	return node
}

/**
 * Build a revoked proxy that throws on every structural read.
 *
 * @returns The revoked proxy
 */
export function buildRevokedHTMLNode(): unknown {
	const revocable = Proxy.revocable({}, {})
	revocable.revoke()
	return revocable.proxy
}

/**
 * Build a prototype with a throwing inherited property.
 *
 * @returns The hostile prototype
 */
export function buildHostileHTMLPrototype(): object {
	const prototype = {}
	Object.defineProperty(prototype, 'poison', {
		enumerable: true,
		get: throwHostileHTMLGetter,
	})
	return prototype
}

/**
 * Collect decoded text content from a document without recursion.
 *
 * @param document - The document to traverse
 * @returns Concatenated text-node values in source order
 */
export function extractHTMLText(document: HTMLDocument): string {
	const pending: HTMLNode[] = [...document.children].reverse()
	let text = ''
	while (pending.length > 0) {
		const node = pending.pop()
		if (node === undefined) continue
		if (node.category === 'text') {
			text += node.value
			continue
		}
		if (node.category !== 'document' && node.category !== 'element') continue
		for (let index = node.children.length - 1; index >= 0; index -= 1) {
			const child = node.children[index]
			if (child !== undefined) pending.push(child)
		}
	}
	return text
}

/**
 * Detect whether any sibling list contains adjacent text nodes.
 *
 * @param document - The document to inspect
 * @returns `true` when the parser normalization invariant is violated
 */
export function hasAdjacentHTMLText(document: HTMLDocument): boolean {
	const pending: HTMLNode[] = [document]
	while (pending.length > 0) {
		const node = pending.pop()
		if (node === undefined || (node.category !== 'document' && node.category !== 'element')) {
			continue
		}
		let previous = false
		for (const child of node.children) {
			if (previous && child.category === 'text') return true
			previous = child.category === 'text'
			pending.push(child)
		}
	}
	return false
}

/**
 * Measure the greatest element nesting depth in a document.
 *
 * @param document - The document to traverse
 * @returns The maximum element depth below the root
 */
export function measureHTMLDepth(document: HTMLDocument): number {
	const pending: { readonly node: HTMLNode; readonly depth: number }[] = []
	for (const child of document.children) pending.push({ node: child, depth: 0 })
	let maximum = 0
	while (pending.length > 0) {
		const entry = pending.pop()
		if (entry === undefined) continue
		const depth = entry.node.category === 'element' ? entry.depth + 1 : entry.depth
		if (depth > maximum) maximum = depth
		if (entry.node.category !== 'document' && entry.node.category !== 'element') continue
		for (const child of entry.node.children) pending.push({ node: child, depth })
	}
	return maximum
}
