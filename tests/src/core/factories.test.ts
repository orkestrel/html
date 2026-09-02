import type { HTMLDocument } from '@src/core'
import { HTML, createHTML, isHTMLDocument, renderHTML } from '@src/core'
import { describe, expect, it } from 'vitest'

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
