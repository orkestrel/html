import type { CollectionMutation } from '../../setup.js'
import {
	BLOCK_ELEMENTS,
	BOILERPLATE_ELEMENTS,
	CONTENT_ELEMENTS,
	HTML,
	HTML_WHITESPACE,
	IMPLIED_BARRIERS,
	IMPLIED_CLOSERS,
	LITERAL_ELEMENTS,
	NAMED_ENTITIES,
	RAW_ELEMENTS,
	REGION_ELEMENTS,
	SAFE_ATTRIBUTES,
	SAFE_ELEMENTS,
	SAFE_URL_SCHEMES,
	TABLE_ALIGNMENTS,
	TABLE_CELL_ELEMENTS,
	UNSAFE_ELEMENTS,
	URL_ATTRIBUTES,
	VOID_ELEMENTS,
	decodeEntities,
	isBlockElement,
	isLiteralElement,
	isRawElement,
	isVoidElement,
	parseDocument,
	renderHTML,
} from '@src/core'
import { attemptCollectionMutation, restoreCollectionMutation } from '../../setup.js'
import { describe, expect, it } from 'vitest'

describe('behavioral collection invariants', () => {
	it('defines exactly the HTML ASCII whitespace characters', () => {
		expect([...HTML_WHITESPACE]).toEqual([' ', '\t', '\n', '\f', '\r'])
	})

	it('keeps every exported behavioral collection immutable after direct mutation attempts', () => {
		const mutations: readonly CollectionMutation[] = [
			{
				collection: VOID_ELEMENTS,
				remove: 'area',
				key: 'area',
				value: 'p',
				original: Reflect.get(VOID_ELEMENTS, '0'),
			},
			{
				collection: RAW_ELEMENTS,
				remove: 'script',
				key: 'script',
				value: 'p',
				original: Reflect.get(RAW_ELEMENTS, '0'),
			},
			{
				collection: LITERAL_ELEMENTS,
				remove: 'title',
				key: 'title',
				value: 'p',
				original: Reflect.get(LITERAL_ELEMENTS, '0'),
			},
			{
				collection: BLOCK_ELEMENTS,
				remove: 'p',
				key: 'p',
				value: 'span',
				original: Reflect.get(BLOCK_ELEMENTS, '0'),
			},
			{
				collection: IMPLIED_CLOSERS,
				remove: 'p',
				key: 'p',
				value: new Set(['span']),
				original: Reflect.get(IMPLIED_CLOSERS, 'p'),
			},
			{
				collection: IMPLIED_CLOSERS.li ?? [],
				remove: 'li',
				key: 'li',
				value: 'span',
				original: Reflect.get(IMPLIED_CLOSERS.li ?? [], '0'),
			},
			{
				collection: IMPLIED_BARRIERS,
				remove: 'p',
				key: 'p',
				value: new Set(['span']),
				original: Reflect.get(IMPLIED_BARRIERS, 'p'),
			},
			{
				collection: IMPLIED_BARRIERS.p ?? [],
				remove: 'button',
				key: 'button',
				value: 'span',
				original: Reflect.get(IMPLIED_BARRIERS.p ?? [], '0'),
			},
			{
				collection: SAFE_ELEMENTS,
				remove: 'p',
				key: 'p',
				value: 'script',
				original: Reflect.get(SAFE_ELEMENTS, '0'),
			},
			{
				collection: SAFE_ATTRIBUTES,
				remove: 'align',
				key: 'align',
				value: 'onclick',
				original: Reflect.get(SAFE_ATTRIBUTES, '0'),
			},
			{
				collection: TABLE_ALIGNMENTS,
				remove: 'left',
				key: 'left',
				value: 'justify',
				original: Reflect.get(TABLE_ALIGNMENTS, '0'),
			},
			{
				collection: TABLE_CELL_ELEMENTS,
				remove: 'td',
				key: 'td',
				value: 'div',
				original: Reflect.get(TABLE_CELL_ELEMENTS, '0'),
			},
			{
				collection: SAFE_URL_SCHEMES,
				remove: 'https',
				key: 'https',
				value: 'javascript',
				original: Reflect.get(SAFE_URL_SCHEMES, '0'),
			},
			{
				collection: URL_ATTRIBUTES,
				remove: 'href',
				key: 'href',
				value: 'onclick',
				original: Reflect.get(URL_ATTRIBUTES, '0'),
			},
			{
				collection: UNSAFE_ELEMENTS,
				remove: 'applet',
				key: 'applet',
				value: 'p',
				original: Reflect.get(UNSAFE_ELEMENTS, '0'),
			},
			{
				collection: CONTENT_ELEMENTS,
				remove: 'p',
				key: 'p',
				value: 'span',
				original: Reflect.get(CONTENT_ELEMENTS, '0'),
			},
			{
				collection: BOILERPLATE_ELEMENTS,
				remove: 'nav',
				key: 'nav',
				value: 'main',
				original: Reflect.get(BOILERPLATE_ELEMENTS, '0'),
			},
			{
				collection: REGION_ELEMENTS,
				remove: 'main',
				key: 'main',
				value: 'section',
				original: Reflect.get(REGION_ELEMENTS, '0'),
			},
			{
				collection: NAMED_ENTITIES,
				remove: 'amp',
				key: 'constructor',
				value: 'corrupt',
				original: Reflect.get(NAMED_ENTITIES, 'amp'),
			},
		]
		try {
			for (const mutation of mutations) attemptCollectionMutation(mutation)
			for (const mutation of mutations) expect(Object.isFrozen(mutation.collection)).toBe(true)
			for (const closers of Object.values(IMPLIED_CLOSERS)) {
				expect(Object.isFrozen(closers)).toBe(true)
			}
			for (const barriers of Object.values(IMPLIED_BARRIERS)) {
				expect(Object.isFrozen(barriers)).toBe(true)
			}
			expect(isVoidElement('area')).toBe(true)
			expect(isVoidElement('p')).toBe(false)
			expect(isRawElement('script')).toBe(true)
			expect(isRawElement('p')).toBe(false)
			expect(isLiteralElement('title')).toBe(true)
			expect(isLiteralElement('p')).toBe(false)
			expect(isBlockElement('p')).toBe(true)
			expect(isBlockElement('span')).toBe(false)
			expect(renderHTML(parseDocument('<p>one<div>two</div>'))).toBe('<p>one</p><div>two</div>')
			expect(renderHTML(parseDocument('<ul><li>one<li>two</ul>'))).toBe(
				'<ul><li>one</li><li>two</li></ul>',
			)
			expect(renderHTML(parseDocument('<p><b>nested</b></p>'))).toBe('<p><b>nested</b></p>')
			expect(decodeEntities('&amp;&constructor;')).toBe('&&constructor;')
			expect(
				renderHTML(
					new HTML(
						'<applet>drop</applet><script>drop</script><p>keep</p>' +
							'<a href="https://example.test" onclick="x()">link</a>' +
							'<div align="left">block</div><td align="justify">bad</td>' +
							'<td align="left">cell</td>',
					).sanitize().document,
				),
			).toBe(
				'<p>keep</p><a href="https://example.test">link</a>' +
					'<div>block</div><td>bad</td><td align="left">cell</td>',
			)
			expect(
				renderHTML(
					new HTML(
						'<nav>skip</nav><main><span>unwrap</span><p>keep</p></main><article>other</article>',
					).distill().document,
				),
			).toBe('unwrap<p>keep</p>')
		} finally {
			for (const mutation of mutations) restoreCollectionMutation(mutation)
		}
	})

	it('defines the scope barriers for every implied-close entry', () => {
		expect(Object.keys(IMPLIED_BARRIERS)).toEqual(Object.keys(IMPLIED_CLOSERS))
		expect(IMPLIED_BARRIERS.p).toEqual([
			'applet',
			'button',
			'html',
			'marquee',
			'object',
			'select',
			'template',
		])
		expect(IMPLIED_BARRIERS.li).toEqual([
			'applet',
			'article',
			'aside',
			'basefont',
			'bgsound',
			'blockquote',
			'body',
			'button',
			'caption',
			'center',
			'colgroup',
			'dd',
			'details',
			'dir',
			'dl',
			'dt',
			'fieldset',
			'figcaption',
			'figure',
			'footer',
			'form',
			'frame',
			'frameset',
			'h1',
			'h2',
			'h3',
			'h4',
			'h5',
			'h6',
			'head',
			'header',
			'hgroup',
			'html',
			'iframe',
			'keygen',
			'listing',
			'main',
			'marquee',
			'menu',
			'nav',
			'noembed',
			'noframes',
			'noscript',
			'object',
			'ol',
			'param',
			'plaintext',
			'pre',
			'search',
			'section',
			'select',
			'summary',
			'table',
			'tbody',
			'td',
			'template',
			'tfoot',
			'th',
			'thead',
			'tr',
			'ul',
			'xmp',
		])
		expect(IMPLIED_BARRIERS.dt).toEqual([
			'applet',
			'article',
			'aside',
			'basefont',
			'bgsound',
			'blockquote',
			'body',
			'button',
			'caption',
			'center',
			'colgroup',
			'details',
			'dir',
			'dl',
			'fieldset',
			'figcaption',
			'figure',
			'footer',
			'form',
			'frame',
			'frameset',
			'h1',
			'h2',
			'h3',
			'h4',
			'h5',
			'h6',
			'head',
			'header',
			'hgroup',
			'html',
			'iframe',
			'keygen',
			'li',
			'listing',
			'main',
			'marquee',
			'menu',
			'nav',
			'noembed',
			'noframes',
			'noscript',
			'object',
			'ol',
			'param',
			'plaintext',
			'pre',
			'search',
			'section',
			'select',
			'summary',
			'table',
			'tbody',
			'td',
			'template',
			'tfoot',
			'th',
			'thead',
			'tr',
			'ul',
			'xmp',
		])
		expect(IMPLIED_BARRIERS.dd).toEqual(IMPLIED_BARRIERS.dt)
		expect(IMPLIED_BARRIERS.option).toEqual(['select'])
		expect(IMPLIED_BARRIERS.optgroup).toEqual(['select'])
		expect(IMPLIED_BARRIERS.rt).toEqual(['ruby'])
		expect(IMPLIED_BARRIERS.rp).toEqual(['ruby'])
		for (const open of ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']) {
			expect(IMPLIED_BARRIERS[open]).toEqual(['html', 'table', 'template'])
		}
	})
})
