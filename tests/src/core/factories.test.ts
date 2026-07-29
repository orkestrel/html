import type { HtmlInterface } from '@src/core'
import { createHtml, Html } from '@src/core'
import { describe, expect, expectTypeOf, it } from 'vitest'

// The Html factory — that `createHtml` returns a working HtmlInterface
// backed by a real Html instance.

describe('createHtml', () => {
	it('returns a Html instance', () => {
		const instance = createHtml({ id: 'example' })

		expect(instance).toBeInstanceOf(Html)
	})

	it('honors the id option', () => {
		const instance = createHtml({ id: 'example' })

		expect(instance.id).toBe('example')
	})

	it('createHtml returns a HtmlInterface', () => {
		expectTypeOf(createHtml({ id: 'example' })).toEqualTypeOf<HtmlInterface>()
	})
})
