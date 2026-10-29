import { describe, expect, it } from 'vitest'
import { HTMLParse } from '../../../src/core/HTMLParse.js'

describe('HTMLParse', () => {
	it('projects normalized text with its original source span', () => {
		const parsed = new HTMLParse('a\r\nb')
		const [document, spans] = parsed.result
		expect(document).toEqual({
			category: 'document',
			children: [{ category: 'text', value: 'a\nb' }],
		})
		expect(spans.get(document)).toEqual({ start: 0, end: 4 })
		const child = document.children[0]
		if (child === undefined) throw new Error('Missing parsed text')
		expect(spans.get(child)).toEqual({ start: 0, end: 4 })
		expect(parsed.result).toBe(parsed.result)
	})
})
