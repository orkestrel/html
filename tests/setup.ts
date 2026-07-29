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

// ── Deterministic randomness ─────────────────────────────────────────────────
//
// The single house seed for tests that need generated input (a contract's
// `.generate(random)`). Suites call `seededRandom(TEST_SEED)` for a fresh,
// deterministic `RandomFunction`, so every suite starts from the same point.

/** The shared seed for deterministic generated test input. */
export const TEST_SEED = 42

/**
 * Read a `ReadableStream` to completion through its reader, in order.
 *
 * @remarks
 * The universal consumption form - a reader loop rather than async iteration -
 * so a stream assertion runs in every environment the core library targets.
 *
 * @param stream - The stream to drain
 * @returns Every chunk the stream produced, in order
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<readonly T[]> {
	const reader = stream.getReader()
	const chunks: T[] = []
	for (let result = await reader.read(); !result.done; result = await reader.read()) {
		chunks.push(result.value)
	}
	return chunks
}

/**
 * Build a realistic article page carrying every region the distiller prunes.
 *
 * @remarks
 * One page with navigation, a hidden banner, a hidden paragraph, a tracking
 * script, a wrapper `div`, a fenced code block, an empty element, and a footer -
 * so one distill assertion covers the whole pipeline instead of nine fragments.
 *
 * @returns The page source
 */
export function buildHTMLPageInput(): string {
	return [
		'<!DOCTYPE html>',
		'<html lang="en"><head><title>Doc</title><script>track()</script></head>',
		'<body>',
		'<nav><a href="/home">Home</a></nav>',
		'<header hidden>Banner</header>',
		'<main><article>',
		'<h1>  Title   here </h1>',
		'<p aria-hidden="true">Hidden note</p>',
		'<div class="wrap"><p>Body <b>bold</b> <a href="page">link</a></p></div>',
		'<pre><code class="language-ts">const x  =  1</code></pre>',
		'<div></div>',
		'</article></main>',
		'<footer>Footer</footer>',
		'</body></html>',
	].join('')
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
 * One adversarial sanitizer input and the tokens whose absence proves its dangerous
 * construct was removed from both the AST and its HTML serialization.
 */
export interface HTMLSanitizerCase {
	/** The threat family used to inventory corpus coverage. */
	readonly group: string
	/** The behavior-specific case name. */
	readonly name: string
	/** The hostile HTML source. */
	readonly source: string
	/** Lowercase tokens that must not occur in the sanitized AST. */
	readonly ast: readonly string[]
	/** Lowercase tokens that must not occur in the rendered sanitized HTML. */
	readonly html: readonly string[]
}

/**
 * Build the adversarial corpus for the sanitizer's security boundary.
 *
 * @returns Hostile inputs spanning attributes, URL schemes, unsafe elements, parser
 * recovery, raw-text boundaries, and markdown-shaped text
 */
export function buildHTMLSanitizerCorpus(): readonly HTMLSanitizerCase[] {
	return [
		{
			group: 'attributes',
			name: 'mixed-case handlers',
			source: '<p OnClIcK="x()" ONMOUSEOVER="y()" oNfOcUs="z()" title="safe">text</p>',
			ast: ['"name":"onclick"', '"name":"onmouseover"', '"name":"onfocus"'],
			html: ['onclick', 'onmouseover', 'onfocus'],
		},
		{
			group: 'attributes',
			name: 'handler inside an allowed link',
			source: '<a href="/safe" onclick="x()">link</a>',
			ast: ['"name":"onclick"'],
			html: ['onclick'],
		},
		{
			group: 'attributes',
			name: 'style and namespace channels',
			source: '<p style="color:red" xlink:href="#x" xmlns:xlink="urn:x" title="safe">text</p>',
			ast: ['"name":"style"', '"name":"xlink:href"', '"name":"xmlns:xlink"'],
			html: [' style=', 'xlink:', 'xmlns:'],
		},
		{
			group: 'attributes',
			name: 'hostile attribute names',
			source: '<p __proto__="x" constructor="y" on\0click="z">text</p>',
			ast: ['"name":"__proto__"', '"name":"constructor"', '"name":"on\uFFFDclick"'],
			html: ['__proto__', 'constructor', 'on\uFFFDclick'],
		},
		{
			group: 'attributes',
			name: 'duplicate href keeps the dangerous first value',
			source: '<a href="javascript:x" href="/safe">link</a>',
			ast: ['"name":"href"', 'javascript:'],
			html: ['href=', 'javascript:'],
		},
		{
			group: 'urls',
			name: 'decimal entity scheme',
			source: '<a href="&#106;avascript:x">link</a>',
			ast: ['javascript:'],
			html: ['javascript:'],
		},
		{
			group: 'urls',
			name: 'hexadecimal entity scheme',
			source: '<a href="&#x6A;avascript:x">link</a>',
			ast: ['javascript:'],
			html: ['javascript:'],
		},
		{
			group: 'urls',
			name: 'doubly encoded entity scheme',
			source: '<a href="&amp;#106;avascript:x">link</a>',
			ast: ['&#106;avascript:'],
			html: ['&amp;#106;avascript:'],
		},
		{
			group: 'urls',
			name: 'control-spliced scheme',
			source: '<a href="java\tscript:x">tab</a><a href="java\nscript:y">line</a>',
			ast: ['javascript:'],
			html: ['javascript:'],
		},
		{
			group: 'urls',
			name: 'data html scheme',
			source: '<a href="data:text/html,&lt;script&gt;x&lt;/script&gt;">link</a>',
			ast: ['data:text/html'],
			html: ['data:text/html'],
		},
		{
			group: 'urls',
			name: 'vbscript scheme',
			source: '<a href="vbscript:run">link</a>',
			ast: ['vbscript:'],
			html: ['vbscript:'],
		},
		{
			group: 'urls',
			name: 'file scheme',
			source: '<a href="file:///tmp/value">link</a>',
			ast: ['file:'],
			html: ['file:'],
		},
		{
			group: 'urls',
			name: 'slash protocol-relative URL',
			source: '<a href="//evil.test/path">link</a>',
			ast: ['evil.test'],
			html: ['evil.test'],
		},
		{
			group: 'urls',
			name: 'backslash protocol-relative URL',
			source: '<a href="\\\\evil.test\\path">link</a>',
			ast: ['evil.test'],
			html: ['evil.test'],
		},
		{
			group: 'urls',
			name: 'mixed-slash protocol-relative URL',
			source: '<a href="/\\evil.test/path">link</a>',
			ast: ['evil.test'],
			html: ['evil.test'],
		},
		{
			group: 'elements',
			name: 'svg handler',
			source: '<svg onload="x()"><circle></circle></svg><p>safe</p>',
			ast: ['"name":"svg"', '"name":"onload"'],
			html: ['<svg', 'onload'],
		},
		{
			group: 'elements',
			name: 'svg script subtree',
			source: '<svg><script>alert(1)</script></svg><p>safe</p>',
			ast: ['"name":"svg"', '"name":"script"'],
			html: ['<svg', '<script'],
		},
		{
			group: 'elements',
			name: 'math link',
			source: '<math href="javascript:x"><mi>x</mi></math><p>safe</p>',
			ast: ['"name":"math"', 'javascript:'],
			html: ['<math', 'javascript:'],
		},
		{
			group: 'elements',
			name: 'iframe srcdoc',
			source: '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe><p>safe</p>',
			ast: ['"name":"iframe"', '"name":"srcdoc"'],
			html: ['<iframe', 'srcdoc'],
		},
		{
			group: 'elements',
			name: 'object data',
			source: '<object data="https://evil.test/payload">fallback</object><p>safe</p>',
			ast: ['"name":"object"', '"name":"data"'],
			html: ['<object', ' data='],
		},
		{
			group: 'elements',
			name: 'embed source',
			source: '<embed src="https://evil.test/payload"><p>safe</p>',
			ast: ['"name":"embed"', '"name":"src"'],
			html: ['<embed', ' src='],
		},
		{
			group: 'elements',
			name: 'applet subtree',
			source: '<applet code="evil">fallback</applet><p>safe</p>',
			ast: ['"name":"applet"'],
			html: ['<applet'],
		},
		{
			group: 'elements',
			name: 'template script subtree',
			source: '<template><script>alert(1)</script></template><p>safe</p>',
			ast: ['"name":"template"', '"name":"script"'],
			html: ['<template', '<script'],
		},
		{
			group: 'elements',
			name: 'base URL mutation',
			source: '<base href="https://evil.test/"><p>safe</p>',
			ast: ['"name":"base"', 'evil.test'],
			html: ['<base', 'evil.test'],
		},
		{
			group: 'elements',
			name: 'form action',
			source: '<form action="javascript:x"><p>submit</p></form><p>safe</p>',
			ast: ['"name":"form"', 'javascript:'],
			html: ['<form', 'javascript:'],
		},
		{
			group: 'recovery',
			name: 'raw close sequence in allowed text',
			source: '<p>&lt;/script&gt;<strong>safe</strong></p>',
			ast: ['"name":"script"'],
			html: ['</script>'],
		},
		{
			group: 'recovery',
			name: 'script-shaped textarea literal',
			source: '<textarea>&lt;script&gt;alert(1)&lt;/script&gt;</textarea><p>safe</p>',
			ast: ['"name":"textarea"', '<script>'],
			html: ['<textarea', '<script>'],
		},
		{
			group: 'recovery',
			name: 'unclosed script swallows the tail',
			source: '<p>before</p><script>alert(1)<p>swallowed tail</p>',
			ast: ['"name":"script"', 'swallowed tail'],
			html: ['<script', 'swallowed tail'],
		},
		{
			group: 'recovery',
			name: 'deep unsafe subtree',
			source: `${'<div>'.repeat(32)}<iframe src="/evil">bad</iframe>${'</div>'.repeat(32)}`,
			ast: ['"name":"iframe"', '"name":"src"'],
			html: ['<iframe', ' src='],
		},
		{
			group: 'recovery',
			name: 'unsafe subtree under implied-close recovery',
			source: '<ul><li>safe<script>bad</script><li>tail</ul>',
			ast: ['"name":"script"', '"value":"bad"'],
			html: ['<script', '>bad<'],
		},
		{
			group: 'projection',
			name: 'markdown-shaped javascript link',
			source: '<p>[x](javascript:alert(1)) <a href="javascript:alert(2)">linked</a></p>',
			ast: ['"name":"href"'],
			html: ['href='],
		},
	]
}

/**
 * Build encoded forms of every hard-banned URL scheme.
 *
 * @returns Direct, numeric, hexadecimal, and multiply encoded scheme values
 */
export function buildEncodedHTMLSchemeCorpus(): readonly string[] {
	const values: string[] = []
	for (const scheme of ['javascript', 'data', 'vbscript', 'file']) {
		const first = scheme.codePointAt(0)
		if (first === undefined) continue
		const rest = scheme.slice(1)
		const decimal = `&#${first};${rest}:payload`
		const hexadecimal = `&#x${first.toString(16)};${rest}:payload`
		values.push(
			`${scheme}:payload`,
			decimal,
			hexadecimal,
			`&amp;${decimal.slice(1)}`,
			`&amp;amp;${hexadecimal.slice(1)}`,
		)
	}
	return values
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
