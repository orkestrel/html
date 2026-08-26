import type { ElementNode, HTMLDocument } from '@src/core'
import {
	IMPLIED_BARRIERS,
	IMPLIED_CLOSERS,
	MAX_DEPTH,
	isHTMLDocument,
	parseDocument,
	parseProvenance,
	renderHTML,
	walkNodes,
} from '@src/core'
import { bench, describe, expect, it } from 'vitest'
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

describe('parseDocument recovery table', () => {
	it('returns provenance without changing parseDocument bare-document callers', () => {
		const [document, spans] = parseProvenance('<p>x</p>')
		expect(parseDocument('<p>x</p>')).toEqual(document)
		expect(spans.get(document)).toEqual({ start: 0, end: 8 })
		expect([...walkNodes(document)].map((node) => spans.get(node))).toEqual([
			{ start: 0, end: 8 },
			{ start: 0, end: 8 },
			{ start: 3, end: 4 },
		])
	})

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

	it('closes a keyed ancestor through intervening inline elements', () => {
		expect(renderHTML(parseDocument('<p><b>x<div>y'))).toBe('<p><b>x</b></p><div>y</div>')
	})

	it('keeps a paragraph open across a button scope barrier', () => {
		expect(renderHTML(parseDocument('<p><button>x<div>y'))).toBe(
			'<p><button>x<div>y</div></button></p>',
		)
	})

	it('keeps an outer list item open while inner list item siblings imply closes', () => {
		expect(renderHTML(parseDocument('<ul><li>x<ul><li>y<li>z'))).toBe(
			'<ul><li>x<ul><li>y</li><li>z</li></ul></li></ul>',
		)
	})

	it('closes a description entry through an intervening inline element', () => {
		expect(renderHTML(parseDocument('<dl><dt><b>x<dd>y'))).toBe(
			'<dl><dt><b>x</b></dt><dd>y</dd></dl>',
		)
	})

	it('keeps a description entry open across a nested description list barrier', () => {
		expect(renderHTML(parseDocument('<dl><dt>x<dl><dd>y'))).toBe(
			'<dl><dt>x<dl><dd>y</dd></dl></dt></dl>',
		)
	})

	it('keeps entry-keyed ancestors open across every configured scope barrier', () => {
		for (const [open, barriers] of Object.entries(IMPLIED_BARRIERS)) {
			const incoming = IMPLIED_CLOSERS[open]?.[0]
			if (incoming === undefined) throw new Error(`expected an implied closer for ${open}`)
			for (const barrier of barriers) {
				expect(renderHTML(parseDocument(`<${open}><${barrier}>x<${incoming}>y`))).toBe(
					`<${open}><${barrier}>x<${incoming}>y</${incoming}></${barrier}></${open}>`,
				)
			}
		}
	})

	it('reaches a represented implied closer through the depth overflow stack', () => {
		const ancestors = '<x>'.repeat(MAX_DEPTH - 1)
		const closes = '</x>'.repeat(MAX_DEPTH - 1)
		expect(renderHTML(parseDocument(`${ancestors}<p><b>x<div>y`))).toBe(
			`${ancestors}<p>x</p><div>y</div>${closes}`,
		)
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
	// Timeout basis for the five sized parses that follow: each measured 25–137 ms across the
	// scoped `test:src:core` runs on 2026-08-24, so 30 s is far past any loaded-host reading and
	// catches a hang rather than grading the parse. The growth pairs these inputs came from live
	// in the benchmark block at the end of this file.
	it('parses 15,000 repeated raw elements into one empty script element each', () => {
		const document = parseDocument('<script></script>'.repeat(15_000))
		expect(document.children).toHaveLength(15_000)
		expect(document.children[0]).toEqual({
			category: 'element',
			name: 'script',
			attributes: [],
			children: [{ category: 'text', value: '' }],
		})
		expect(document.children[14_999]).toEqual({
			category: 'element',
			name: 'script',
			attributes: [],
			children: [{ category: 'text', value: '' }],
		})
		expect(isHTMLDocument(document)).toBe(true)
	}, 30_000)

	it('caps a 24,000-deep open run at MAX_DEPTH and discards the unmatched closes after it', () => {
		const document = parseDocument(`${'<x>'.repeat(24_000)}${'</y>'.repeat(24_000)}`)
		expect(measureHTMLDepth(document)).toBe(MAX_DEPTH)
		expect(document.children).toHaveLength(1)
		expect(isHTMLDocument(document)).toBe(true)
	}, 30_000)

	it('discards 100,000 unmatched closes against a full open-element stack', () => {
		const document = parseDocument(`${'<x>'.repeat(MAX_DEPTH)}${'</y>'.repeat(100_000)}`)
		expect(measureHTMLDepth(document)).toBe(MAX_DEPTH)
		expect(document.children).toHaveLength(1)
		expect(isHTMLDocument(document)).toBe(true)
	}, 30_000)

	it('collapses 192,000 duplicate quoted attributes to one first-wins attribute', () => {
		const document = parseDocument(buildHTMLAttributeInput(192_000))
		const element = document.children[0]
		if (element?.category !== 'element') throw new Error('expected element')
		expect(element.name).toBe('x')
		expect(element.attributes).toEqual([{ name: 'a', value: '' }])
		expect(document.children).toHaveLength(1)
		expect(isHTMLDocument(document)).toBe(true)
	}, 30_000)

	it('parses mixed attribute, raw-element, and close-soup pressure into its documented shape', () => {
		const document = parseDocument(buildMixedHTMLInput(20_000))
		expect(document.children).toHaveLength(20_002)
		expect(measureHTMLDepth(document)).toBe(MAX_DEPTH)
		expect(isHTMLDocument(document)).toBe(true)
	}, 30_000)

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

// How parse cost moves as each hostile input doubles. The suite above proves what the parse
// returns; these report what it costs and assert nothing, so only `npm run test:bench` collects
// them and no gate reads them. Each pair is the input pair the deleted wall-clock ratio
// assertions used.
if (import.meta.env.MODE === 'benchmark') {
	const rawElements = '<script></script>'.repeat(15_000)
	const closeSoupSmall = `${'<x>'.repeat(12_000)}${'</y>'.repeat(12_000)}`
	const closeSoupLarge = `${'<x>'.repeat(24_000)}${'</y>'.repeat(24_000)}`
	const strayCloseSmall = `${'<x>'.repeat(MAX_DEPTH)}${'</y>'.repeat(50_000)}`
	const strayCloseLarge = `${'<x>'.repeat(MAX_DEPTH)}${'</y>'.repeat(100_000)}`
	const attributesSmall = buildHTMLAttributeInput(96_000)
	const attributesLarge = buildHTMLAttributeInput(192_000)
	const mixedSmall = buildMixedHTMLInput(10_000)
	const mixedLarge = buildMixedHTMLInput(20_000)

	bench('parseDocument — 15,000 repeated raw elements', () => {
		parseDocument(rawElements)
	})
	bench('parseDocument — 12,000 opens then 12,000 unmatched closes', () => {
		parseDocument(closeSoupSmall)
	})
	bench('parseDocument — 24,000 opens then 24,000 unmatched closes', () => {
		parseDocument(closeSoupLarge)
	})
	bench('parseDocument — 50,000 unmatched closes against a full stack', () => {
		parseDocument(strayCloseSmall)
	})
	bench('parseDocument — 100,000 unmatched closes against a full stack', () => {
		parseDocument(strayCloseLarge)
	})
	bench('parseDocument — 96,000 duplicate quoted attributes', () => {
		parseDocument(attributesSmall)
	})
	bench('parseDocument — 192,000 duplicate quoted attributes', () => {
		parseDocument(attributesLarge)
	})
	bench('parseDocument — mixed pressure at 10,000 per family', () => {
		parseDocument(mixedSmall)
	})
	bench('parseDocument — mixed pressure at 20,000 per family', () => {
		parseDocument(mixedLarge)
	})
}
