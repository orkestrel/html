import type { HTMLDocument } from '@src/core'
import {
	HTML,
	createAttributeContract,
	createCommentContract,
	createDoctypeContract,
	createHTML,
	createTextContract,
	isHTMLDocument,
	renderHTML,
} from '@src/core'
import { seededRandom } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { TEST_SEED } from '../../setup.js'

describe('createHTML', () => {
	it('parses an HTML string into a working handle', () => {
		const page = createHTML('<h1>Title</h1><p>Body</p>')
		expect(isHTMLDocument(page.document)).toBe(true)
		expect(
			page.document.children.map((node) =>
				node.category === 'element' ? node.name : node.category,
			),
		).toEqual(['h1', 'p'])
	})

	it('adopts an existing document by reference', () => {
		const document: HTMLDocument = { category: 'document', children: [] }
		expect(createHTML(document).document).toBe(document)
	})

	it('recovers from malformed markup instead of throwing', () => {
		expect(() => createHTML('<div>kept<span')).not.toThrow()
		expect(renderHTML(createHTML('<div>kept<span').document)).toBe('<div>kept</div>')
	})

	it('returns the same behavior as the class it constructs', () => {
		const source = '<main><p>Body</p></main>'
		expect(renderHTML(createHTML(source).document)).toBe(renderHTML(new HTML(source).document))
	})
})

describe('createAttributeContract', () => {
	const contract = createAttributeContract()

	it('guards, parses, and generates one HTMLAttribute contract', () => {
		expect(contract.is({ name: 'href', value: '/guide' })).toBe(true)
		expect(contract.is({ name: 'href', value: 1 })).toBe(false)
		expect(contract.parse({ name: 'disabled' })).toEqual({ name: 'disabled' })
		expect(contract.parse({ value: 'x' })).toBeUndefined()
		expect(contract.is(contract.generate(seededRandom(TEST_SEED)))).toBe(true)
	})

	it('declares the same schema on every call without sharing an instance', () => {
		const other = createAttributeContract()
		expect(other).not.toBe(contract)
		expect(other.schema).toEqual(contract.schema)
	})
})

describe('createTextContract', () => {
	const contract = createTextContract()

	it('guards, parses, and generates one TextNode contract', () => {
		expect(contract.is({ category: 'text', value: 'a & b' })).toBe(true)
		expect(contract.is({ category: 'comment', value: 'a' })).toBe(false)
		expect(contract.parse({ category: 'text', value: 'x' })).toEqual({
			category: 'text',
			value: 'x',
		})
		expect(contract.parse({ category: 'text' })).toBeUndefined()
		expect(contract.is(contract.generate(seededRandom(TEST_SEED)))).toBe(true)
	})
})

describe('createCommentContract', () => {
	const contract = createCommentContract()

	it('guards, parses, and generates one CommentNode contract', () => {
		expect(contract.is({ category: 'comment', value: ' note ' })).toBe(true)
		expect(contract.is({ category: 'text', value: ' note ' })).toBe(false)
		expect(contract.parse({ category: 'comment', value: 'x' })).toEqual({
			category: 'comment',
			value: 'x',
		})
		expect(contract.is(contract.generate(seededRandom(TEST_SEED)))).toBe(true)
	})
})

describe('createDoctypeContract', () => {
	const contract = createDoctypeContract()

	it('guards, parses, and generates one DoctypeNode contract', () => {
		expect(contract.is({ category: 'doctype', name: 'html' })).toBe(true)
		expect(contract.is({ category: 'doctype', name: 'html', system: 'legacy.dtd' })).toBe(true)
		expect(contract.is({ category: 'doctype' })).toBe(false)
		expect(contract.parse({ category: 'doctype', name: 'html' })).toEqual({
			category: 'doctype',
			name: 'html',
		})
		expect(contract.is(contract.generate(seededRandom(TEST_SEED)))).toBe(true)
	})

	it('accepts every doctype the parser produces', () => {
		const document = createHTML(
			'<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "legacy.dtd">',
		).document
		const doctype = document.children[0]
		expect(contract.is(doctype)).toBe(true)
	})
})
