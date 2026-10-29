import type { HTMLNode } from '@src/core'
import { collectStream } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { HTMLStream } from '../../../src/core/HTMLStream.js'

describe('HTMLStream', () => {
	it('reads the terminal indexed slot and never consumes the array iterator', async () => {
		const reads: string[] = []
		const nodes: HTMLNode[] = [{ category: 'text', value: 'kept' }]
		const children = new Proxy(nodes, {
			get(target, key, receiver) {
				if (key === Symbol.iterator) throw new Error('Unexpected iterator read')
				if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(key)
				return Reflect.get(target, key, receiver)
			},
		})
		expect(await collectStream(new HTMLStream(children).result)).toEqual(nodes)
		expect(reads).toEqual(['0', '1'])
	})

	it('closes on the first hole without reading a later child', async () => {
		const nodes: HTMLNode[] = []
		nodes[1] = { category: 'text', value: 'unread' }
		expect(await collectStream(new HTMLStream(nodes).result)).toEqual([])
	})
})
