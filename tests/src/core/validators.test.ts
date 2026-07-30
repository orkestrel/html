import type { ElementNode, HTMLNode } from '@src/core'
import {
	MAX_DEPTH,
	isBlockElement,
	isCommentNode,
	isDoctypeNode,
	isElementNode,
	isEmptyElement,
	isHTMLAttribute,
	isHTMLDocument,
	isHTMLNode,
	isLiteralElement,
	isRawElement,
	isSafeURL,
	isTextNode,
	isVoidElement,
	parseDocument,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	buildCyclicHTMLNode,
	buildDeepHTMLNode,
	buildDiamondHTMLDocument,
	buildHostileHTMLNode,
	buildHostileHTMLPrototype,
	buildRevokedHTMLNode,
} from '../../setup.js'

describe('from-unknown leaf guards', () => {
	it('accepts exact attributes and preserves absent versus empty values', () => {
		expect(isHTMLAttribute({ name: 'disabled' })).toBe(true)
		expect(isHTMLAttribute({ name: 'title', value: '' })).toBe(true)
		expect(isHTMLAttribute({ name: 'title', value: 1 })).toBe(false)
		expect(isHTMLAttribute({ name: 'title', extra: true })).toBe(false)
	})

	it('accepts exact text and comment nodes', () => {
		expect(isTextNode({ category: 'text', value: 'hello' })).toBe(true)
		expect(isCommentNode({ category: 'comment', value: 'hello' })).toBe(true)
		expect(isTextNode({ category: 'text' })).toBe(false)
		expect(isCommentNode({ category: 'comment', value: 'x', extra: true })).toBe(false)
	})

	it('accepts doctype nodes with optional public and system identifiers', () => {
		expect(isDoctypeNode({ category: 'doctype', name: 'html' })).toBe(true)
		expect(
			isDoctypeNode({
				category: 'doctype',
				name: 'html',
				public: '-//W3C//DTD HTML 4.01//EN',
				system: 'about:legacy-compat',
			}),
		).toBe(true)
		expect(isDoctypeNode({ category: 'doctype', name: 'html', public: 1 })).toBe(false)
	})
})

describe('recursive HTML guards', () => {
	it('accepts every real parser result as an HTMLDocument and HTMLNode', () => {
		const sources = [
			'',
			'plain',
			'<!doctype html><main><p>hello &amp; goodbye</p></main>',
			'<script>if (a < b) x()</script><textarea>&lt;x&gt;</textarea>',
			'<ul><li>one<li>two</ul>',
		]
		for (const source of sources) {
			const document = parseDocument(source)
			expect(isHTMLDocument(document)).toBe(true)
			expect(isHTMLNode(document)).toBe(true)
		}
	})

	it('narrows a valid element and rejects cross-category values', () => {
		const candidate: unknown = {
			category: 'element',
			name: 'p',
			attributes: [{ name: 'class', value: 'lead' }],
			children: [{ category: 'text', value: 'hello' }],
		}
		if (!isElementNode(candidate)) throw new Error('expected element narrowing')
		expect(candidate.name).toBe('p')
		expect(isHTMLNode(candidate)).toBe(true)
		expect(isHTMLDocument(candidate)).toBe(false)
	})

	it('rejects malformed descendants and non-node values', () => {
		expect(
			isHTMLDocument({
				category: 'document',
				children: [{ category: 'element', name: 'p', attributes: [], children: [{}] }],
			}),
		).toBe(false)
		for (const value of [undefined, null, 0, '', true, [], {}, Symbol('node')]) {
			expect(isHTMLNode(value)).toBe(false)
			expect(isHTMLDocument(value)).toBe(false)
			expect(isElementNode(value)).toBe(false)
		}
	})

	it('enforces the void-element empty-children invariant', () => {
		expect(isElementNode({ category: 'element', name: 'br', attributes: [], children: [] })).toBe(
			true,
		)
		expect(
			isElementNode({
				category: 'element',
				name: 'br',
				attributes: [],
				children: [{ category: 'text', value: 'invalid' }],
			}),
		).toBe(false)
	})

	it('returns false without throwing for cycles and excessive depth', () => {
		const cyclic = buildCyclicHTMLNode()
		const deep = buildDeepHTMLNode(MAX_DEPTH + 1)
		expect(() => isHTMLNode(cyclic)).not.toThrow()
		expect(isHTMLNode(cyclic)).toBe(false)
		expect(() => isHTMLDocument(deep)).not.toThrow()
		expect(isHTMLDocument(deep)).toBe(false)
	})

	it('validates a shared diamond graph once per node identity', () => {
		expect(isHTMLDocument(buildDiamondHTMLDocument(MAX_DEPTH))).toBe(true)
	})

	it('returns false without throwing for hostile getters and revoked proxies', () => {
		for (const hostile of [buildHostileHTMLNode(), buildRevokedHTMLNode()]) {
			expect(() => isHTMLNode(hostile)).not.toThrow()
			expect(isHTMLNode(hostile)).toBe(false)
			expect(() => isHTMLDocument(hostile)).not.toThrow()
			expect(isHTMLDocument(hostile)).toBe(false)
		}
	})

	it('rejects a hostile custom prototype without reading its inherited getter', () => {
		const node = {
			category: 'element',
			name: 'div',
			attributes: [],
			children: [],
		}
		Object.setPrototypeOf(node, buildHostileHTMLPrototype())
		expect(() => isElementNode(node)).not.toThrow()
		expect(isElementNode(node)).toBe(false)
	})
})

describe('element predicates', () => {
	it('classifies void, raw, literal, and block names case-insensitively', () => {
		expect(isVoidElement('BR')).toBe(true)
		expect(isVoidElement('div')).toBe(false)
		expect(isRawElement('SCRIPT')).toBe(true)
		expect(isRawElement('title')).toBe(false)
		expect(isLiteralElement('TEXTAREA')).toBe(true)
		expect(isLiteralElement('style')).toBe(false)
		expect(isBlockElement('ARTICLE')).toBe(true)
		expect(isBlockElement('span')).toBe(false)
	})

	it('recognizes relative and allowed URLs and rejects the hard floor', () => {
		expect(isSafeURL('/guide?q=1')).toBe(true)
		expect(isSafeURL('https://example.com')).toBe(true)
		expect(isSafeURL('MAILTO:a@example.com')).toBe(true)
		expect(isSafeURL('javascript:alert(1)')).toBe(false)
		expect(isSafeURL('java\nscript:alert(1)')).toBe(false)
		expect(isSafeURL('data:text/html,x')).toBe(false)
		expect(isSafeURL('//example.com')).toBe(false)
		expect(isSafeURL('\\\\example.com')).toBe(false)
		expect(isSafeURL('')).toBe(false)
	})

	it('applies a caller scheme set without lowering the dangerous-scheme floor', () => {
		const schemes = new Set(['custom', 'javascript'])
		expect(isSafeURL('custom:value', schemes)).toBe(true)
		expect(isSafeURL('https://example.com', schemes)).toBe(false)
		expect(isSafeURL('javascript:value', schemes)).toBe(false)
	})

	it('recognizes an element with no children', () => {
		const empty: ElementNode = {
			category: 'element',
			name: 'div',
			attributes: [],
			children: [],
		}
		const child: HTMLNode = { category: 'text', value: '' }
		expect(isEmptyElement(empty)).toBe(true)
		expect(isEmptyElement({ ...empty, children: [child] })).toBe(false)
	})
})
