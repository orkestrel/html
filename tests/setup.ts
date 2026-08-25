import type { ElementNode, HTMLDocument, HTMLNode } from '@src/core'
import { MAX_DEPTH, parseDocument } from '@src/core'
import WHATWG_ENTITIES from './src/core/fixtures/entities.json' with { type: 'json' }

// Fetched from https://html.spec.whatwg.org/entities.json on 2026-08-24.
/** The semicolon-terminated names and characters from the vendored WHATWG entity reference. */
export const WHATWG_NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(
		Object.entries(WHATWG_ENTITIES)
			.filter(([name]) => name.endsWith(';'))
			.map(([name, entity]) => [name.slice(1, -1), entity.characters] as const),
	),
)

// ── Deterministic randomness ─────────────────────────────────────────────────
//
// The single house seed for tests that need generated input (a contract's
// `.generate(random)`). Suites call `seededRandom(TEST_SEED)` for a fresh,
// deterministic `RandomFunction`, so every suite starts from the same point.

/** The shared seed for deterministic generated test input. */
export const TEST_SEED = 42

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
 * @returns Documents covering realistic pages and representative parser recovery families
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
		'<table><thead><tr><th align=" RIGHT ">Head</th></tr></thead><tbody><tr><td align="left">Cell</td></tr></tbody></table>',
		'<b><i>x</b>y</i>',
		'</p>kept</unknown>',
		'<my-widget data-x=1>hello</my-widget>',
		'<DIV ID=first id=second CLASS="x">x</DIV>',
		'<div disabled title="oops><p>safe</p>',
		'1 < 2 <<x',
		'<?work?><!ENTITY x><![CDATA[a<b]]>',
		'<!--a--b-->',
		'<!--a---->',
		'<!--one--two--three-->',
		'<!-->x-->',
		'<!--->x-->',
		'<!--a--!>tail',
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
 * Build every unique bounded comment-token source from three introducers and a small alphabet.
 *
 * @returns All sources with a `<!--`, `<!`, or `<?` introducer and up to six suffix characters
 */
export function buildHTMLCommentEnumeration(): readonly string[] {
	const alphabet = ['<', '!', '-', '>', 'x']
	const suffixes = ['']
	let start = 0
	for (let depth = 0; depth < 6; depth += 1) {
		const end = suffixes.length
		for (let index = start; index < end; index += 1) {
			const suffix = suffixes[index]
			if (suffix === undefined) continue
			for (const character of alphabet) suffixes.push(suffix + character)
		}
		start = end
	}
	const sources = new Set<string>()
	for (const prefix of ['<!--', '<!', '<?']) {
		for (const suffix of suffixes) sources.add(prefix + suffix)
	}
	return [...sources]
}

/**
 * Throw whenever a hostile test value is asked to produce or expose collection behavior.
 *
 * @returns Never returns
 */
export function throwHostileHTMLAccess(): never {
	throw new Error('hostile option access')
}

/**
 * Return a value that deliberately violates the iterator protocol.
 *
 * @returns A non-iterator value
 */
export function returnHTMLNonIterator(): number {
	return 0
}

/**
 * Build the hostile allowlist shapes every shaping option must contain.
 *
 * @returns Throwing-iterator, throwing-proxy, and malformed-iterator collections
 */
export function buildHostileHTMLAllowlists(): ReadonlyArray<
	ReadonlySet<string> | readonly string[]
> {
	const throwing = new Set(['script', 'p', 'onclick', 'href', 'javascript'])
	Object.defineProperty(throwing, Symbol.iterator, { value: throwHostileHTMLAccess })
	const trapped = new Proxy(new Set(['script', 'p', 'onclick', 'href', 'javascript']), {
		get: throwHostileHTMLAccess,
	})
	const malformed = new Set(['script', 'p', 'onclick', 'href', 'javascript'])
	Object.defineProperty(malformed, Symbol.iterator, { value: returnHTMLNonIterator })
	return [throwing, trapped, malformed]
}

/**
 * Build an allowlist whose collection-query members throw if normalization consults them.
 *
 * @returns An iterable Set with hostile `has` and `size` accessors
 */
export function buildShadowedHTMLAllowlist(): ReadonlySet<string> {
	const allowlist = new Set(['script', 'p', 'onclick', 'href', 'javascript'])
	Object.defineProperty(allowlist, 'has', { get: throwHostileHTMLAccess })
	Object.defineProperty(allowlist, 'size', { get: throwHostileHTMLAccess })
	return allowlist
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
 * recovery, raw-text boundaries, and link-shaped literal text
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
			group: 'text',
			name: 'link-shaped literal text beside a real javascript link',
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

/** One entity-obfuscated URL and the exact value the HTML security floor may retain. */
export interface HTMLEntityURLCase {
	/** The behavior-specific case name. */
	readonly name: string
	/** The URL before entity decoding. */
	readonly source: string
	/** The decoded URL retained by the floor; absence means the attribute is removed. */
	readonly value?: string
}

/**
 * Build the entity-obfuscated URL corpus that exercises every reviewed scheme character.
 *
 * @returns Named controls, separators, nesting, mixed references, one allowed URL, and
 * every hard-banned scheme
 */
export function buildHTMLEntityURLCorpus(): readonly HTMLEntityURLCase[] {
	return [
		{ name: 'named colon', source: 'javascript&colon;alert(1)' },
		{ name: 'named tab', source: 'java&Tab;script&colon;x' },
		{ name: 'named newline', source: 'java&NewLine;script&colon;x' },
		{ name: 'named slashes', source: '&sol;&sol;host' },
		{ name: 'mixed named slashes', source: '&bsol;&sol;host' },
		{ name: 'double encoded colon', source: 'javascript&amp;colon;x' },
		{ name: 'mixed numeric and named', source: 'java&#115;cript&colon;x' },
		{
			name: 'allowed named HTTPS',
			source: 'https&colon;&sol;&sol;host',
			value: 'https://host',
		},
		{ name: 'named javascript', source: 'javascript&colon;payload' },
		{ name: 'named data', source: 'data&colon;payload' },
		{ name: 'named vbscript', source: 'vbscript&colon;payload' },
		{ name: 'named file', source: 'file&colon;&sol;&sol;&sol;tmp' },
	]
}

// ── URL-safety corpus ────────────────────────────────────────────────────────
//
// The floor `sanitizeURL` enforces, enumerated as data: strip every codepoint ≤ U+0020
// and U+007F–U+009F, refuse any two-character protocol-relative prefix drawn from `/`
// and `\`, extract an ASCII scheme, enforce an allowlist, and keep relative / anchor /
// scheme-less values (guides/html.md § The sanitize floor states the rules this
// corpus pins). Every vector carries its disposition, so a reader can see the whole
// floor in one list instead of inferring it from scattered assertions, and one group's
// vectors can be extended without touching the assertions that consume them.
//
// `controls` / `case` / `relative` / `kept` / `schemes` are the floor itself. `entities`
// and `escaping` are the two rules that follow from WHERE this sanitizer sits: it runs on
// the AST, before `renderHTML` serializes, so it decodes character references before
// reading a scheme and leaves a surviving value unescaped for the serializer. Both have
// named tests in helpers.test.ts.

/** One adversarial URL and the value this package's sanitizer may retain. */
export interface URLSafetyCase {
	/** The threat family, used to inventory corpus coverage. */
	readonly group: string
	/** The behavior-specific case name. */
	readonly name: string
	/** The raw URL handed to the sanitizer. */
	readonly source: string
	/** The retained value; absence means the URL is refused (dropped to `''`). */
	readonly value?: string
}

/**
 * Build the URL-safety corpus for `sanitizeURL`, each vector carrying its disposition.
 *
 * @returns Control splices, case variance, protocol-relative forms, kept destinations,
 * refused schemes, entity obfuscation, and unescaped survivors
 */
export function buildURLSafetyCorpus(): readonly URLSafetyCase[] {
	return [
		// Controls and whitespace are stripped BEFORE the scheme is read, so a splice
		// cannot hide a scheme from the allowlist check.
		{ group: 'controls', name: 'tab-spliced scheme', source: 'java\tscript:alert(1)' },
		{ group: 'controls', name: 'newline-spliced scheme', source: 'java\nscript:alert(1)' },
		{ group: 'controls', name: 'NUL-spliced scheme', source: 'java\u0000script:alert(1)' },
		{ group: 'controls', name: 'C1-spliced scheme', source: 'java\u0085script:alert(1)' },
		{ group: 'controls', name: 'slash-spliced protocol-relative', source: '/\t/evil.dev' },
		{ group: 'controls', name: 'leading-space scheme', source: '  javascript:alert(1)' },
		// The scheme comparison is case-insensitive in both directions: a dangerous
		// scheme cannot escape by case, and a safe one cannot be refused by it.
		{ group: 'case', name: 'mixed-case javascript', source: 'JaVaScRiPt:alert(1)' },
		{ group: 'case', name: 'mixed-case HTTPS', source: 'HtTpS://ok.dev', value: 'HtTpS://ok.dev' },
		// All four two-character protocol-relative prefixes inherit the embedding page's
		// scheme; a SINGLE leading `/` or `\` is same-origin relative and survives.
		{ group: 'relative', name: 'double slash', source: '//evil.dev' },
		{ group: 'relative', name: 'double backslash', source: '\\\\evil.dev' },
		{ group: 'relative', name: 'slash backslash', source: '/\\evil.dev' },
		{ group: 'relative', name: 'backslash slash', source: '\\/evil.dev' },
		{ group: 'relative', name: 'single backslash', source: '\\evil.dev', value: '\\evil.dev' },
		{ group: 'kept', name: 'absolute path', source: '/path', value: '/path' },
		{ group: 'kept', name: 'anchor', source: '#anchor', value: '#anchor' },
		{ group: 'kept', name: 'query', source: '?q=1', value: '?q=1' },
		{ group: 'kept', name: 'mailto', source: 'mailto:a@b.dev', value: 'mailto:a@b.dev' },
		{ group: 'kept', name: 'tel', source: 'tel:+15551234', value: 'tel:+15551234' },
		{ group: 'kept', name: 'https', source: 'https://ok.dev', value: 'https://ok.dev' },
		// An empty URL has nothing to refuse and nothing to keep.
		{ group: 'kept', name: 'empty', source: '', value: '' },
		{ group: 'schemes', name: 'javascript', source: 'javascript:alert(1)' },
		{ group: 'schemes', name: 'data', source: 'data:text/html,<script>' },
		{ group: 'schemes', name: 'file', source: 'file:///etc/passwd' },
		{ group: 'schemes', name: 'vbscript', source: 'vbscript:msgbox' },
		{ group: 'schemes', name: 'unlisted scheme', source: 'ftp://host' },
		// The entity-decode pass. A sanitized value here is re-serialized and can be
		// reparsed, and a hand-built AST can defer decoding to that later parse, so
		// character references are decoded to a bounded fixpoint BEFORE the scheme is read
		// and whatever decodes to a dangerous scheme is refused. An obfuscated ALLOWED
		// scheme survives, decoded.
		{ group: 'entities', name: 'decimal entity scheme', source: '&#106;avascript:x' },
		{ group: 'entities', name: 'hex entity scheme', source: '&#x6a;avascript:x' },
		{ group: 'entities', name: 'named colon', source: 'javascript&colon;x' },
		{ group: 'entities', name: 'double-encoded colon', source: 'javascript&amp;colon;x' },
		{ group: 'entities', name: 'entity protocol-relative', source: '&sol;&sol;evil.dev' },
		{
			group: 'entities',
			name: 'entity-obfuscated allowed scheme',
			source: 'https&colon;&sol;&sol;ok.dev',
			value: 'https://ok.dev',
		},
		// Escaping position. These values are retained UNESCAPED, because `renderHTML`'s
		// serializer — not the sanitizer — encodes every attribute value on the way out.
		{
			group: 'escaping',
			name: 'ampersand in a kept URL',
			source: 'https://ok.dev/?a=1&b=2',
			value: 'https://ok.dev/?a=1&b=2',
		},
		{
			group: 'escaping',
			name: 'quote in a kept URL',
			source: 'https://ok.dev/"onmouseover=x',
			value: 'https://ok.dev/"onmouseover=x',
		},
	]
}

/** The URL-safety corpus's threat families, in corpus order. */
export const URL_SAFETY_GROUPS: readonly string[] = [
	'controls',
	'case',
	'relative',
	'kept',
	'schemes',
	'entities',
	'escaping',
]

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
 * Build an element whose two child references both point back to the element.
 *
 * @param name - The element name
 * @returns A branching cyclic element graph
 */
export function buildBranchingHTMLElement(name: string): ElementNode {
	const children: HTMLNode[] = []
	const element: ElementNode = { category: 'element', name, attributes: [], children }
	children.push(element, element)
	return element
}

/**
 * Build an acyclic diamond graph with two references to the preceding node at each level.
 *
 * @param depth - The number of shared element layers
 * @returns A document whose path count is exponential but whose node count is linear
 */
export function buildDiamondHTMLDocument(depth: number): HTMLDocument {
	let node: HTMLNode = { category: 'text', value: 'leaf' }
	for (let index = 0; index < depth; index += 1) {
		node = { category: 'element', name: 'span', attributes: [], children: [node, node] }
	}
	return { category: 'document', children: [node] }
}

/**
 * Build many `pre` elements that share one comment-heavy non-code child.
 *
 * @param count - The number of `pre` elements and shared comments
 * @returns A linear-size graph that exposes repeated nested fallback walks
 */
export function buildSharedHTMLPreDocument(count: number): HTMLDocument {
	const comments: HTMLNode[] = []
	for (let index = 0; index < count; index += 1) {
		comments.push({ category: 'comment', value: `comment-${index}` })
	}
	const shared: ElementNode = {
		category: 'element',
		name: 'span',
		attributes: [],
		children: comments,
	}
	const children: HTMLNode[] = []
	for (let index = 0; index < count; index += 1) {
		children.push({ category: 'element', name: 'pre', attributes: [], children: [shared] })
	}
	return { category: 'document', children }
}

/**
 * Build one start tag containing many duplicate empty quoted attributes.
 *
 * @param count - The number of attributes
 * @returns A complete custom-element source
 */
export function buildHTMLAttributeInput(count: number): string {
	return `<x ${'a="" '.repeat(count)}></x>`
}

/**
 * Build a mixed parser-pressure source spanning attributes, raw elements, and close soup.
 *
 * @param count - The size of each adversarial family
 * @returns One source whose total size grows linearly with count
 */
export function buildMixedHTMLInput(count: number): string {
	return (
		buildHTMLAttributeInput(count) +
		'<script></script>'.repeat(count) +
		'<x>'.repeat(count) +
		'</y>'.repeat(count)
	)
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
	const pending: Array<{ readonly node: HTMLNode; readonly depth: number }> = []
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
