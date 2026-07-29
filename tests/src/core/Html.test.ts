import type { HtmlInterface } from '@src/core'
import { Html } from '@src/core'
import { describe, expect, it } from 'vitest'

// The Html entity — explicit identity. Factory-level assertions live in
// factories.test.ts.

describe('Html', () => {
	it('round-trips an explicit id', () => {
		const instance: HtmlInterface = new Html({ id: 'example' })

		expect(instance.id).toBe('example')
	})
})
