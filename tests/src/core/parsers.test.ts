import type { ElementNode, HTMLDocument, HTMLStartTag } from '@src/core'
import {
	MAX_DEPTH,
	isHTMLDocument,
	parseDocument,
	parseStartTag,
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

	it('uses one ASCII-folding and HTML-whitespace grammar across recovery paths', () => {
		expect(scanTag('<p Ω=one>', 0)?.attributes).toEqual([{ name: 'Ω', value: 'one' }])
		expect(scanTag('<p Ω=one Ω=two>', 0)?.attributes).toEqual([{ name: 'Ω', value: 'one' }])
		expect(scanTag('<p lang=en\u00a0>', 0)?.attributes).toEqual([
			{ name: 'lang', value: 'en\u00a0' },
		])
		expect(scanTag('<p a\u00a0b=c a\u00a0b=d>', 0)?.attributes).toEqual([
			{ name: 'a\u00a0b', value: 'c' },
		])
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

describe('strict start tag parsing', () => {
	it('returns exact source boundaries for unambiguous start tags', () => {
		const source = 'x<HTML lang="en" data-note="a>b">tail'
		const next = source.indexOf('>tail') + 1
		const parsed: HTMLStartTag | undefined = parseStartTag(source, 1)

		expect(parsed).toEqual({
			name: 'html',
			attributes: [
				{ name: 'lang', value: 'en' },
				{ name: 'data-note', value: 'a>b' },
			],
			slashed: false,
			next,
		})
		expect(source.slice(1, parsed?.next)).toBe('<HTML lang="en" data-note="a>b">')
	})

	it('preserves valueless, empty, quoted, unquoted, and decoded attribute values', () => {
		const source = '<html data-empty="" disabled lang=en data-note=\'a>b\' data-code="&gt;">'

		expect(parseStartTag(source, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'data-empty', value: '' },
				{ name: 'disabled' },
				{ name: 'lang', value: 'en' },
				{ name: 'data-note', value: 'a>b' },
				{ name: 'data-code', value: '>' },
			],
			slashed: false,
			next: source.length,
		})
	})

	it('accepts HTML whitespace and reports the trailing solidus without inventing semantics', () => {
		const spaced = '<html\tlang="en"\rdata-note=\'a>b\'\n>'

		expect(parseStartTag(spaced, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'lang', value: 'en' },
				{ name: 'data-note', value: 'a>b' },
			],
			slashed: false,
			next: spaced.length,
		})
		expect(parseStartTag('<html/>', 0)).toEqual({
			name: 'html',
			attributes: [],
			slashed: true,
			next: 7,
		})
		expect(parseStartTag('<html disabled/>', 0)).toEqual({
			name: 'html',
			attributes: [{ name: 'disabled' }],
			slashed: true,
			next: 16,
		})
		expect(parseStartTag('<html lang=en/>', 0)).toEqual({
			name: 'html',
			attributes: [{ name: 'lang', value: 'en/' }],
			slashed: false,
			next: 15,
		})
	})

	it('tracks UTF-16 offsets exactly', () => {
		const source = '😀<html data-note="ok">'
		const offset = source.indexOf('<')

		expect(parseStartTag(source, offset)?.next).toBe(source.length)
		expect(source.slice(offset, parseStartTag(source, offset)?.next)).toBe('<html data-note="ok">')
	})

	it('folds only ASCII attribute-name case and preserves distinct Unicode names', () => {
		const source = '<html DATA-X=one İ=two Ω=three ω=four>'

		expect(parseStartTag(source, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'data-x', value: 'one' },
				{ name: 'İ', value: 'two' },
				{ name: 'Ω', value: 'three' },
				{ name: 'ω', value: 'four' },
			],
			slashed: false,
			next: source.length,
		})
	})

	it('accepts Unicode scalar values and refuses surrogates and noncharacters', () => {
		const valid = '<html 😀="🦅" data=🦅>'
		const rejected = [
			'<html \ud800=x>',
			'<html \udfff=x>',
			'<html data="\ud800">',
			'<html data="\udfff">',
			'<html data=\ud800>',
			'<html data=\udfff>',
			'<html data="\u{1fffe}">',
		]

		expect(parseStartTag(valid, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: '😀', value: '🦅' },
				{ name: 'data', value: '🦅' },
			],
			slashed: false,
			next: valid.length,
		})
		for (const source of rejected) expect(parseStartTag(source, 0)).toBeUndefined()
	})

	it('refuses malformed, ambiguous, duplicated, closing, and incomplete source', () => {
		const rejected = [
			'<html',
			'</html>',
			'< html>',
			'<1html>',
			'<html data=>',
			'<html data="unterminated>',
			"<html data='unterminated>",
			'<html data="ok"x>',
			'<html data=one=two>',
			'<html data<bad>',
			'<html data"bad>',
			'<html data=`bad`>',
			'<x-élément>',
			'<html data="ok"data-next="bad">',
			'<html id=first ID=second>',
			'<html data=\0>',
			'<html / >',
			'<html/ >',
			'<html\u00a0lang="en">',
			'<html\vlang="en">',
		]

		for (const source of rejected) expect(parseStartTag(source, 0)).toBeUndefined()
	})

	it('refuses every invalid source offset', () => {
		const source = '<html>'
		const offsets = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, source.length]

		for (const offset of offsets) expect(parseStartTag(source, offset)).toBeUndefined()
	})

	it('leaves total scanner and document recovery unchanged', () => {
		const source = '<div disabled title="oops><p>safe</p>'

		expect(parseStartTag(source, 0)).toBeUndefined()
		expect(scanTag(source, 0)).toEqual({
			name: 'div',
			attributes: [{ name: 'disabled' }, { name: 'title' }],
			closing: false,
			next: 26,
		})
		expect(renderHTML(parseDocument(source))).toBe('<div disabled title><p>safe</p></div>')
	})

	it('handles large valid and unterminated quoted inputs', () => {
		const attributes = Array.from(
			{ length: 10_000 },
			(_, index) => ` data-${index}="${index}>value"`,
		).join('')
		const valid = `<html${attributes}>`
		const unterminated = `<html data-note="${'>'.repeat(100_000)}`

		expect(parseStartTag(valid, 0)?.attributes).toHaveLength(10_000)
		expect(parseStartTag(valid, 0)?.next).toBe(valid.length)
		expect(parseStartTag(unterminated, 0)).toBeUndefined()
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
