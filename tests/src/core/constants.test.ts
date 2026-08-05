import {
	BLOCK_ELEMENTS,
	BOILERPLATE_ELEMENTS,
	CONTENT_ELEMENTS,
	HTML,
	HTML_WHITESPACE,
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
import { describe, expect, it } from 'vitest'

export interface CollectionMutation {
	readonly collection: object
	readonly remove: string
	readonly key: string
	readonly value: unknown
	readonly original: unknown
}

export function attemptCollectionMutation(mutation: CollectionMutation): void {
	const remove = Reflect.get(mutation.collection, 'delete')
	if (typeof remove === 'function') Reflect.apply(remove, mutation.collection, [mutation.remove])
	const add = Reflect.get(mutation.collection, 'add')
	if (typeof add === 'function') Reflect.apply(add, mutation.collection, [mutation.value])
	const set = Reflect.get(mutation.collection, 'set')
	if (typeof set === 'function') {
		Reflect.apply(set, mutation.collection, [mutation.key, mutation.value])
	}
	const indexOf = Reflect.get(mutation.collection, 'indexOf')
	if (typeof indexOf === 'function') {
		const index = Reflect.apply(indexOf, mutation.collection, [mutation.remove])
		if (typeof index === 'number' && index >= 0) {
			Reflect.set(mutation.collection, String(index), mutation.value)
		}
	}
	Reflect.set(mutation.collection, '0', mutation.value)
	Reflect.deleteProperty(mutation.collection, '0')
	Reflect.set(mutation.collection, mutation.key, mutation.value)
	Reflect.deleteProperty(mutation.collection, mutation.remove)
}

export function restoreCollectionMutation(mutation: CollectionMutation): void {
	const add = Reflect.get(mutation.collection, 'add')
	if (typeof add === 'function') Reflect.apply(add, mutation.collection, [mutation.remove])
	const remove = Reflect.get(mutation.collection, 'delete')
	if (typeof remove === 'function') Reflect.apply(remove, mutation.collection, [mutation.value])
	const set = Reflect.get(mutation.collection, 'set')
	if (typeof set === 'function') {
		Reflect.apply(set, mutation.collection, [mutation.remove, mutation.original])
		if (mutation.key !== mutation.remove) {
			Reflect.apply(remove, mutation.collection, [mutation.key])
		}
	}
	const indexOf = Reflect.get(mutation.collection, 'indexOf')
	if (typeof indexOf === 'function') {
		const index = Reflect.apply(indexOf, mutation.collection, [mutation.value])
		if (typeof index === 'number' && index >= 0) {
			Reflect.set(mutation.collection, String(index), mutation.remove)
		}
	}
	Reflect.set(mutation.collection, '0', mutation.original)
	Reflect.set(mutation.collection, mutation.remove, mutation.original)
	if (mutation.key !== mutation.remove) Reflect.deleteProperty(mutation.collection, mutation.key)
}

describe('behavioral collection invariants', () => {
	it('defines exactly the five HTML ASCII whitespace characters', () => {
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
})
