import type { ElementNode, HTMLDocument } from '@src/core'
import {
	MAX_DEPTH,
	NAMED_ENTITIES,
	decodeEntities,
	isHTMLDocument,
	parseDocument,
	renderHTML,
	scanAttributes,
	scanComment,
	scanDoctype,
	scanRawText,
	scanTag,
	walkNodes,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	buildDeepHTMLInput,
	buildHTMLAttributeInput,
	buildHTMLCommentEnumeration,
	buildHTMLRoundtripCorpus,
	buildMixedHTMLInput,
	extractHTMLText,
	hasAdjacentHTMLText,
	measureHTMLDepth,
} from '../../setup.js'

describe('scanning pieces', () => {
	it('decodeEntities decodes decimal, hexadecimal, invalid-scalar, and named references', () => {
		expect(decodeEntities('&#65; &#x1F600;')).toBe('A 😀')
		expect(decodeEntities('&#0; &#xD800; &#1114112;')).toBe('\uFFFD \uFFFD \uFFFD')
		expect(decodeEntities('&amp; &copy; &Alpha; &nbsp;')).toBe('& © Α \u00A0')
		expect(decodeEntities('&unknown; &amp')).toBe('&unknown; &amp')
	})

	it('decodes every semicolon-terminated WHATWG named entity exactly', () => {
		expect(Object.isFrozen(NAMED_ENTITIES)).toBe(true)
		expect(Object.keys(NAMED_ENTITIES)).toHaveLength(2_125)
		for (const [name, value] of Object.entries(NAMED_ENTITIES)) {
			expect({ name, decoded: decodeEntities(`&${name};`) }).toEqual({ name, decoded: value })
		}
	})

	it('decodes multi-codepoint values and digit-bearing names', () => {
		expect(decodeEntities('&fjlig;&NotEqualTilde;&ThickSpace;&race;')).toBe(
			'fj\u2242\u0338\u205F\u200A\u223D\u0331',
		)
		expect(decodeEntities('&frac12;&sup1;&blk12;')).toBe('\u00BD\u00B9\u2592')
	})

	it('keeps unknown, wrong-case, prototype-like, and unterminated names literal', () => {
		const literal = [
			'&definitelyUnknown;',
			'&aMp;',
			'&constructor;',
			'&__proto__;',
			'&hasOwnProperty;',
			'&copy',
			'&NotEqualTilde',
			'&frac12',
		].join('|')
		expect(decodeEntities(literal)).toBe(literal)
	})

	it('audits every security-relevant generated entity value against the reviewed set', () => {
		const controls: string[] = []
		const punctuation: string[] = []
		for (const [name, value] of Object.entries(NAMED_ENTITIES)) {
			if (
				[...value].some((character) => {
					const point = character.codePointAt(0)
					return point !== undefined && (point <= 0x1f || point === 0x7f || character === '&')
				})
			) {
				controls.push(name)
			}
			if (value === ':' || value === '/' || value === '\\') punctuation.push(name)
		}
		expect(controls).toEqual(['AMP', 'NewLine', 'Tab', 'amp'])
		expect(punctuation).toEqual(['bsol', 'colon', 'sol'])
	})

	it('preserves the AST roundtrip law across every entity parsing context', () => {
		const references = Object.keys(NAMED_ENTITIES).map((name) => `&${name};`)
		const text = parseDocument(references.join('|'))
		const literal = parseDocument(
			`<title>${references.join('|')}</title><textarea>${references.join('|')}</textarea>`,
		)
		const attributes = parseDocument(
			references.map((reference) => `<p title="${reference}"></p>`).join(''),
		)
		for (const document of [text, literal, attributes]) {
			expect(parseDocument(renderHTML(document))).toEqual(document)
		}
	})

	it('scales linearly for recognized, enormous unknown, and nested entity inputs', () => {
		expect(Object.keys(NAMED_ENTITIES)).toHaveLength(2_125)
		decodeEntities('&NotEqualTilde;'.repeat(1_000))

		const recognizedSmall = '&NotEqualTilde;'.repeat(40_000)
		const recognizedLarge = '&NotEqualTilde;'.repeat(80_000)
		const recognizedSmallStart = performance.now()
		decodeEntities(recognizedSmall)
		const recognizedSmallElapsed = performance.now() - recognizedSmallStart
		const recognizedLargeStart = performance.now()
		decodeEntities(recognizedLarge)
		const recognizedLargeElapsed = performance.now() - recognizedLargeStart

		const unknownSmall = `&${'unknown'.repeat(30_000)};`
		const unknownLarge = `&${'unknown'.repeat(60_000)};`
		const unknownSmallStart = performance.now()
		expect(decodeEntities(unknownSmall)).toBe(unknownSmall)
		const unknownSmallElapsed = performance.now() - unknownSmallStart
		const unknownLargeStart = performance.now()
		expect(decodeEntities(unknownLarge)).toBe(unknownLarge)
		const unknownLargeElapsed = performance.now() - unknownLargeStart

		const nestedSmall = '&amp;amp;'.repeat(40_000)
		const nestedLarge = '&amp;amp;'.repeat(80_000)
		const nestedSmallStart = performance.now()
		decodeEntities(nestedSmall)
		const nestedSmallElapsed = performance.now() - nestedSmallStart
		const nestedLargeStart = performance.now()
		decodeEntities(nestedLarge)
		const nestedLargeElapsed = performance.now() - nestedLargeStart

		expect(recognizedLargeElapsed).toBeLessThan(recognizedSmallElapsed * 3 + 50)
		expect(unknownLargeElapsed).toBeLessThan(unknownSmallElapsed * 3 + 50)
		expect(nestedLargeElapsed).toBeLessThan(nestedSmallElapsed * 3 + 50)
		expect(recognizedLargeElapsed + unknownLargeElapsed + nestedLargeElapsed).toBeLessThan(1_500)
	})

	it('scanAttributes handles quoted, unquoted, minimized, duplicate, and hostile names', () => {
		expect(
			scanAttributes(' ID="first" id=second disabled empty="" title=\'a &amp; b\' __proto__=safe'),
		).toEqual([
			{ name: 'id', value: 'first' },
			{ name: 'disabled' },
			{ name: 'empty', value: '' },
			{ name: 'title', value: 'a & b' },
			{ name: '__proto__', value: 'safe' },
		])
	})

	it('scanAttributes minimizes an unterminated quoted value', () => {
		expect(scanAttributes(' title="unterminated')).toEqual([{ name: 'title' }])
	})

	it('scanTag scans lowercased start and close tags and rejects incomplete tags', () => {
		expect(scanTag('<DIV A=1>', 0)).toEqual({
			name: 'div',
			attributes: [{ name: 'a', value: '1' }],
			closing: false,
			next: 9,
		})
		expect(scanTag('x</DiV >y', 1)).toEqual({
			name: 'div',
			attributes: [],
			closing: true,
			next: 8,
		})
		expect(scanTag('<div', 0)).toBeUndefined()
	})

	it('scanComment handles standard, bogus, CDATA, and unterminated comments', () => {
		expect(scanComment('<!--hello-->x', 0)).toEqual({
			node: { category: 'comment', value: 'hello' },
			next: 12,
		})
		expect(scanComment('<?work?>', 0)?.node.value).toBe('work?')
		expect(scanComment('<![CDATA[x<y]]>', 0)?.node.value).toBe('[CDATA[x<y]]')
		expect(scanComment('<!--open', 0)).toEqual({
			node: { category: 'comment', value: 'open' },
			next: 8,
		})
	})

	it('scanComment closes abrupt and incorrectly closed forms into representable tokens', () => {
		expect(scanComment('<!-->x-->', 0)).toEqual({
			node: { category: 'comment', value: '' },
			next: 5,
		})
		expect(scanComment('<!--->x-->', 0)).toEqual({
			node: { category: 'comment', value: '' },
			next: 6,
		})
		expect(scanComment('<!--x--!>tail', 0)).toEqual({
			node: { category: 'comment', value: 'x' },
			next: 9,
		})
	})

	it('scanDoctype handles simple, public, and system declarations', () => {
		expect(scanDoctype('<!DOCTYPE HTML>', 0)?.node).toEqual({
			category: 'doctype',
			name: 'html',
		})
		expect(
			scanDoctype('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "legacy.dtd">', 0)?.node,
		).toEqual({
			category: 'doctype',
			name: 'html',
			public: '-//W3C//DTD HTML 4.01//EN',
			system: 'legacy.dtd',
		})
		expect(scanDoctype('<!doctype html SYSTEM "about:legacy-compat">', 0)?.node).toEqual({
			category: 'doctype',
			name: 'html',
			system: 'about:legacy-compat',
		})
		expect(scanDoctype('<!doctype html SYSTEM "identifier>part">', 0)?.node).toEqual({
			category: 'doctype',
			name: 'html',
			system: 'identifier>part',
		})
		expect(scanDoctype('<!doctype html', 0)).toBeUndefined()
	})

	it('scanRawText finds a case-insensitive close and optionally decodes entities', () => {
		expect(scanRawText('a <b>&amp;</b></ScRiPt>x', 0, 'script')).toEqual({
			node: { category: 'text', value: 'a <b>&amp;</b>' },
			next: 23,
			closed: true,
		})
		expect(scanRawText('&lt;b&gt;</TITLE>', 0, 'title', true)).toEqual({
			node: { category: 'text', value: '<b>' },
			next: 17,
			closed: true,
		})
		expect(scanRawText('unterminated', 0, 'style')).toEqual({
			node: { category: 'text', value: 'unterminated' },
			next: 12,
			closed: false,
		})
	})
})

describe('parseDocument recovery table', () => {
	it('void element start tags have empty children and stray closes are discarded', () => {
		const document = parseDocument('<p>a<br>b</br>c<img src=x></p>')
		const paragraph = document.children[0]
		if (paragraph?.category !== 'element') throw new Error('expected paragraph')
		expect(paragraph.children.map((node) => node.category)).toEqual([
			'text',
			'element',
			'text',
			'element',
		])
		const elements = paragraph.children.filter(
			(node): node is ElementNode => node.category === 'element',
		)
		expect(elements.map((node) => node.children)).toEqual([[], []])
	})

	it('coalesces text separated only by a discarded void close tag', () => {
		const document = parseDocument('<p>a<br>b</br>c</p>')
		const paragraph = document.children[0]
		if (paragraph?.category !== 'element') throw new Error('expected paragraph')
		expect(paragraph.children).toEqual([
			{ category: 'text', value: 'a' },
			{ category: 'element', name: 'br', attributes: [], children: [] },
			{ category: 'text', value: 'bc' },
		])
		expect(hasAdjacentHTMLText(document)).toBe(false)
	})

	it('script and style bodies are one verbatim text child with no nested tag scan', () => {
		const document = parseDocument(
			'<script>if (a < b) &amp;<style>x</style></SCRIPT><style><b>&copy;</b></style>',
		)
		expect(document.children).toEqual([
			{
				category: 'element',
				name: 'script',
				attributes: [],
				children: [{ category: 'text', value: 'if (a < b) &amp;<style>x</style>' }],
			},
			{
				category: 'element',
				name: 'style',
				attributes: [],
				children: [{ category: 'text', value: '<b>&copy;</b>' }],
			},
		])
	})

	it('title and textarea bodies are one entity-decoded literal text child', () => {
		expect(parseDocument('<title>&lt;b&gt;&amp;</TITLE><textarea>&copy;</textarea>')).toEqual({
			category: 'document',
			children: [
				{
					category: 'element',
					name: 'title',
					attributes: [],
					children: [{ category: 'text', value: '<b>&' }],
				},
				{
					category: 'element',
					name: 'textarea',
					attributes: [],
					children: [{ category: 'text', value: '©' }],
				},
			],
		})
	})

	it('new li, dt, dd, option, optgroup, rt, and rp tags imply configured closes', () => {
		const cases = [
			'<ul><li>a<li>b</ul>',
			'<dl><dt>a<dd>b<dt>c</dl>',
			'<select><option>a<option>b<optgroup><option>c</select>',
			'<ruby><rt>a<rp>b<rt>c</ruby>',
		]
		for (const source of cases) {
			const document = parseDocument(source)
			expect(isHTMLDocument(document)).toBe(true)
			expect(measureHTMLDepth(document)).toBeLessThanOrEqual(3)
		}
		const list = parseDocument(cases[0] ?? '').children[0]
		if (list?.category !== 'element') throw new Error('expected list')
		expect(list.children.filter((node) => node.category === 'element')).toHaveLength(2)
	})

	it('a block start closes an open p and table row/cell starts imply configured closes', () => {
		const document = parseDocument('<p>one<div>two</div><table><tr><td>x<td>y<tr><th>z</table>')
		expect(
			document.children.map((node) => (node.category === 'element' ? node.name : 'text')),
		).toEqual(['p', 'div', 'table'])
		const table = document.children[2]
		if (table?.category !== 'element') throw new Error('expected table')
		expect(extractHTMLText({ category: 'document', children: [table] })).toBe('xyz')
		expect(isHTMLDocument(document)).toBe(true)
	})

	it('a mis-nested close closes the nearest match and implicitly closes spanned elements', () => {
		const document = parseDocument('<b><i>x</b>y</i>')
		expect(document.children).toEqual([
			{
				category: 'element',
				name: 'b',
				attributes: [],
				children: [
					{
						category: 'element',
						name: 'i',
						attributes: [],
						children: [{ category: 'text', value: 'x' }],
					},
				],
			},
			{ category: 'text', value: 'y' },
		])
	})

	it('a stray close with no match is discarded', () => {
		expect(parseDocument('</p>kept</unknown>').children).toEqual([
			{ category: 'text', value: 'kept' },
		])
	})

	it('unknown and custom elements are ordinary elements with children', () => {
		expect(parseDocument('<my-widget data-x=1>hello</my-widget>').children[0]).toEqual({
			category: 'element',
			name: 'my-widget',
			attributes: [{ name: 'data-x', value: '1' }],
			children: [{ category: 'text', value: 'hello' }],
		})
	})

	it('duplicate attributes are lowercased and first-wins', () => {
		const element = parseDocument('<DIV ID=first id=second CLASS="x">x</DIV>').children[0]
		if (element?.category !== 'element') throw new Error('expected element')
		expect(element.name).toBe('div')
		expect(element.attributes).toEqual([
			{ name: 'id', value: 'first' },
			{ name: 'class', value: 'x' },
		])
	})

	it('malformed and unterminated attributes recover without trusting later markup', () => {
		const document = parseDocument('<div disabled title="oops><p>safe</p>')
		const div = document.children[0]
		if (div?.category !== 'element') throw new Error('expected recovered element')
		expect(div.attributes).toEqual([{ name: 'disabled' }, { name: 'title' }])
		expect(div.children[0]?.category).toBe('element')
		expect(extractHTMLText(document)).toBe('safe')
	})

	it('a less-than sign not followed by a markup starter stays literal text', () => {
		expect(extractHTMLText(parseDocument('1 < 2 <<x'))).toBe('1 < 2 <')
	})

	it('processing instructions, non-doctype declarations, and CDATA become comments', () => {
		expect(parseDocument('<?work?><!ENTITY x><![CDATA[a<b]]>').children).toEqual([
			{ category: 'comment', value: 'work?' },
			{ category: 'comment', value: 'ENTITY x' },
			{ category: 'comment', value: '[CDATA[a<b]]' },
		])
	})

	it('an unterminated comment runs to the end of input', () => {
		expect(parseDocument('a<!--open').children).toEqual([
			{ category: 'text', value: 'a' },
			{ category: 'comment', value: 'open' },
		])
	})

	it('an incomplete tag at EOF is dropped without losing preceding text', () => {
		const document = parseDocument('<div>kept<span')
		expect(extractHTMLText(document)).toBe('kept')
		expect(isHTMLDocument(document)).toBe(true)
	})

	it('depth beyond MAX_DEPTH degrades at the deepest allowed element and keeps text', () => {
		const document = parseDocument(buildDeepHTMLInput(10_000, 'deep text'))
		expect(measureHTMLDepth(document)).toBe(MAX_DEPTH)
		expect(extractHTMLText(document)).toBe('deep text')
		expect(isHTMLDocument(document)).toBe(true)
	})

	it('normalizes CRLF, lone CR, and null before parsing', () => {
		expect(parseDocument('<p>a\r\nb\rc\0d</p>')).toEqual(parseDocument('<p>a\nb\nc\uFFFDd</p>'))
	})
})

describe('parseDocument entities and declarations', () => {
	it('decodes numeric and named entities in text and attribute values', () => {
		const document = parseDocument('<p title="&#x41;&#65;&amp;">&lt;&#128512;&euro;&unknown;</p>')
		const paragraph = document.children[0]
		if (paragraph?.category !== 'element') throw new Error('expected paragraph')
		expect(paragraph.attributes).toEqual([{ name: 'title', value: 'AA&' }])
		expect(extractHTMLText(document)).toBe('<😀€&unknown;')
	})

	it('turns invalid numeric scalars into replacement characters', () => {
		expect(extractHTMLText(parseDocument('&#0;&#xDFFF;&#x110000;'))).toBe('\uFFFD\uFFFD\uFFFD')
	})

	it('keeps a doctype in source order with public and system identifiers', () => {
		expect(
			parseDocument('before<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "legacy.dtd">after')
				.children,
		).toEqual([
			{ category: 'text', value: 'before' },
			{
				category: 'doctype',
				name: 'html',
				public: '-//W3C//DTD HTML 4.01//EN',
				system: 'legacy.dtd',
			},
			{ category: 'text', value: 'after' },
		])
	})
})

describe('parseDocument hostile corpus totality', () => {
	it('parses a large repeated raw-element input within a linear-time bound', () => {
		const source = '<script></script>'.repeat(15_000)
		const start = performance.now()
		const document = parseDocument(source)
		const elapsed = performance.now() - start
		expect(document.children).toHaveLength(15_000)
		expect(elapsed).toBeLessThan(750)
	})

	it('scales linearly through close soup after the depth overflow boundary', () => {
		const smallSource = `${'<x>'.repeat(12_000)}${'</y>'.repeat(12_000)}`
		const largeSource = `${'<x>'.repeat(24_000)}${'</y>'.repeat(24_000)}`
		const smallStart = performance.now()
		parseDocument(smallSource)
		const smallElapsed = performance.now() - smallStart
		const largeStart = performance.now()
		parseDocument(largeSource)
		const largeElapsed = performance.now() - largeStart
		expect(largeElapsed).toBeLessThan(smallElapsed * 3 + 30)
		expect(largeElapsed).toBeLessThan(600)
	})

	it('keeps unmatched close lookup linear with a full open-element stack', () => {
		const smallSource = `${'<x>'.repeat(MAX_DEPTH)}${'</y>'.repeat(50_000)}`
		const largeSource = `${'<x>'.repeat(MAX_DEPTH)}${'</y>'.repeat(100_000)}`
		const smallStart = performance.now()
		parseDocument(smallSource)
		const smallElapsed = performance.now() - smallStart
		const largeStart = performance.now()
		const document = parseDocument(largeSource)
		const largeElapsed = performance.now() - largeStart
		expect(largeElapsed).toBeLessThan(smallElapsed * 3 + 50)
		expect(largeElapsed).toBeLessThan(750)
		expect(isHTMLDocument(document)).toBe(true)
	})

	it('scales linearly through a start tag with many quoted attributes', () => {
		const smallSource = buildHTMLAttributeInput(96_000)
		const largeSource = buildHTMLAttributeInput(192_000)
		const smallStart = performance.now()
		parseDocument(smallSource)
		const smallElapsed = performance.now() - smallStart
		const largeStart = performance.now()
		parseDocument(largeSource)
		const largeElapsed = performance.now() - largeStart
		expect(largeElapsed).toBeLessThan(smallElapsed * 3 + 100)
		expect(largeElapsed).toBeLessThan(750)
	})

	it('scales linearly through mixed attribute, raw-element, and close-soup pressure', () => {
		const smallSource = buildMixedHTMLInput(10_000)
		const largeSource = buildMixedHTMLInput(20_000)
		const smallStart = performance.now()
		parseDocument(smallSource)
		const smallElapsed = performance.now() - smallStart
		const largeStart = performance.now()
		const document = parseDocument(largeSource)
		const largeElapsed = performance.now() - largeStart
		expect(largeElapsed).toBeLessThan(smallElapsed * 3 + 100)
		expect(largeElapsed).toBeLessThan(750)
		expect(isHTMLDocument(document)).toBe(true)
	})

	const cases = [
		'',
		'<',
		'</',
		'<!',
		'<?',
		'<!--',
		'<div',
		'<div a="',
		'<script>unterminated <b>&amp;',
		'<style><script>nested</script>',
		'</a></b></c>'.repeat(1000),
		'<'.repeat(10_000),
		'\0\r\r\n',
	]

	for (const source of cases) {
		it(`never throws for ${JSON.stringify(source.slice(0, 32))}`, () => {
			let document: HTMLDocument | undefined
			expect(() => {
				document = parseDocument(source)
			}).not.toThrow()
			expect(document === undefined ? false : isHTMLDocument(document)).toBe(true)
		})
	}

	it('never emits adjacent text siblings across the hostile corpus', () => {
		for (const source of cases) expect(hasAdjacentHTMLText(parseDocument(source))).toBe(false)
	})

	it('handles a 100,000-tag flood without throwing and returns a guard-valid document', () => {
		const source = '<div>'.repeat(100_000)
		let document: HTMLDocument | undefined
		expect(() => {
			document = parseDocument(source)
		}).not.toThrow()
		expect(document === undefined ? false : isHTMLDocument(document)).toBe(true)
	})

	it('handles 100,000 stray close tags and retains following text', () => {
		const document = parseDocument(`${'</div>'.repeat(100_000)}kept`)
		expect(extractHTMLText(document)).toBe('kept')
		expect(isHTMLDocument(document)).toBe(true)
	})

	it('keeps __proto__ as an ordinary own attribute name', () => {
		const element = parseDocument('<x __proto__=safe constructor=also-safe>x</x>').children[0]
		if (element?.category !== 'element') throw new Error('expected custom element')
		expect(element.attributes).toEqual([
			{ name: '__proto__', value: 'safe' },
			{ name: 'constructor', value: 'also-safe' },
		])
		expect(Object.getPrototypeOf(element.attributes[0])).toBe(Object.prototype)
	})
})

describe('parseDocument parse and guard soundness', () => {
	it('constructs representable comments throughout the representative roundtrip corpus', () => {
		const violations: string[] = []
		for (const document of buildHTMLRoundtripCorpus()) {
			for (const node of walkNodes(document)) {
				if (
					node.category === 'comment' &&
					(node.value.startsWith('>') ||
						node.value.startsWith('->') ||
						node.value.includes('-->') ||
						node.value.includes('--!>'))
				)
					violations.push(node.value)
			}
		}
		expect(violations).toEqual([])
	})

	it('exhaustively preserves 57,812 unique bounded comment-token sources', () => {
		const sources = buildHTMLCommentEnumeration()
		const invariantFailures: string[] = []
		const roundtripFailures: string[] = []
		for (const source of sources) {
			const document = parseDocument(source)
			for (const node of walkNodes(document)) {
				if (
					node.category === 'comment' &&
					(node.value.startsWith('>') ||
						node.value.startsWith('->') ||
						node.value.includes('-->') ||
						node.value.includes('--!>'))
				) {
					invariantFailures.push(`${source}: ${node.value}`)
				}
			}
			const reparsed = parseDocument(renderHTML(document))
			if (JSON.stringify(reparsed) !== JSON.stringify(document)) roundtripFailures.push(source)
		}
		expect(sources).toHaveLength(57_812)
		expect(invariantFailures).toEqual([])
		expect(roundtripFailures).toEqual([])
	})

	it('every representative parse result satisfies isHTMLDocument', () => {
		const sources = [
			'plain',
			'<!doctype html>',
			'<main><h1>Title</h1><p>Text<br>more</p></main>',
			'<script>x < y && y > z</script>',
			'<table><tr><td>a<td>b</table>',
			buildDeepHTMLInput(MAX_DEPTH + 20),
		]
		for (const source of sources) expect(isHTMLDocument(parseDocument(source))).toBe(true)
	})

	it('retains text through mixed malformed close-tag soup', () => {
		const source = '<a>one<b>two</a>three</b><custom>four'
		expect(extractHTMLText(parseDocument(source))).toBe('onetwothreefour')
	})
})
