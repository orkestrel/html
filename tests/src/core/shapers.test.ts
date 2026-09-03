import type { CommentNode, DoctypeNode, HTMLAttribute, TextNode } from '@src/core'
import type { Infer } from '@orkestrel/contract'
import { attributeShape, commentShape, doctypeShape, parseDocument, textShape } from '@src/core'
import { createContract, seededRandom } from '@orkestrel/contract'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { TEST_SEED } from '../../setup.js'

// Each shape compiles (through createContract) into a schema, a guard, a parser, and a
// generator that must agree in lockstep. These shapes are the LEAVES of the HTML AST: the
// element and document nodes recurse into HTMLNode, which a shape tree cannot express, so
// they stay hand-written capped guards in validators.ts.

describe('attributeShape', () => {
	const contract = createContract(attributeShape)

	it('accepts a valued and a valueless attribute', () => {
		expect(contract.is({ name: 'href', value: '/guide' })).toBe(true)
		expect(contract.is({ name: 'disabled' })).toBe(true)
		expect(contract.is({ name: 'disabled', value: '' })).toBe(true)
	})

	it('rejects a missing name, a non-string value, and an extra key', () => {
		expect(contract.is({ value: 'x' })).toBe(false)
		expect(contract.is({ name: 'href', value: 1 })).toBe(false)
		expect(contract.is({ name: 'href', value: '/x', extra: true })).toBe(false)
		expect(contract.is('href')).toBe(false)
	})

	it('declares a closed schema whose only required field is the name', () => {
		expect(contract.schema.type).toBe('object')
		expect(contract.schema.required).toEqual(['name'])
		expect(contract.schema.additionalProperties).toBe(false)
		expect(contract.schema.properties?.value?.type).toBe('string')
	})

	it('generates a guard-valid value, deterministic per seed', () => {
		const first = contract.generate(seededRandom(TEST_SEED))
		const second = contract.generate(seededRandom(TEST_SEED))
		const other = contract.generate(seededRandom(TEST_SEED + 1))

		expect(contract.is(first)).toBe(true)
		expect(first).toEqual(second)
		expect(first).not.toEqual(other)
	})

	it('parses a valid value into a structurally equal rebuild and garbage into undefined', () => {
		const input = { name: 'href', value: '/guide' }

		expect(contract.parse(input)).toEqual(input)
		expect(contract.parse(input)).not.toBe(input)
		expect(contract.parse({ name: 'disabled' })).toEqual({ name: 'disabled' })
		expect(contract.parse({ value: 'x' })).toBeUndefined()
		expect(contract.parse(null)).toBeUndefined()
	})

	it('infers HTMLAttribute both ways', () => {
		expectTypeOf<Infer<typeof attributeShape>>().toEqualTypeOf<HTMLAttribute>()
		expectTypeOf<HTMLAttribute>().toEqualTypeOf<Infer<typeof attributeShape>>()
	})
})

describe('textShape', () => {
	const contract = createContract(textShape)

	it('accepts a valid text node', () => {
		expect(contract.is({ category: 'text', value: 'a & b' })).toBe(true)
		expect(contract.is({ category: 'text', value: '' })).toBe(true)
	})

	it('rejects another category, a missing value, and an extra key', () => {
		expect(contract.is({ category: 'comment', value: 'x' })).toBe(false)
		expect(contract.is({ category: 'text' })).toBe(false)
		expect(contract.is({ category: 'text', value: 'x', name: 'p' })).toBe(false)
	})

	it('declares a closed schema pinning the category literal', () => {
		expect(contract.schema.required).toEqual(['category', 'value'])
		expect(contract.schema.additionalProperties).toBe(false)
		expect(contract.schema.properties?.category?.enum).toEqual(['text'])
	})

	it('generates a guard-valid value, deterministic per seed', () => {
		const first = contract.generate(seededRandom(TEST_SEED))
		const second = contract.generate(seededRandom(TEST_SEED))

		expect(contract.is(first)).toBe(true)
		expect(first).toEqual(second)
	})

	it('parses a valid value into a structurally equal rebuild and garbage into undefined', () => {
		const input = { category: 'text', value: 'x' }

		expect(contract.parse(input)).toEqual(input)
		expect(contract.parse(input)).not.toBe(input)
		expect(contract.parse({ category: 'text' })).toBeUndefined()
	})

	it('infers TextNode both ways', () => {
		expectTypeOf<Infer<typeof textShape>>().toEqualTypeOf<TextNode>()
		expectTypeOf<TextNode>().toEqualTypeOf<Infer<typeof textShape>>()
	})
})

describe('commentShape', () => {
	const contract = createContract(commentShape)

	it('accepts a valid comment node and rejects a text node', () => {
		expect(contract.is({ category: 'comment', value: ' note ' })).toBe(true)
		expect(contract.is({ category: 'text', value: ' note ' })).toBe(false)
	})

	it('declares a closed schema pinning the category literal', () => {
		expect(contract.schema.required).toEqual(['category', 'value'])
		expect(contract.schema.additionalProperties).toBe(false)
		expect(contract.schema.properties?.category?.enum).toEqual(['comment'])
	})

	it('generates a guard-valid value, deterministic per seed', () => {
		const first = contract.generate(seededRandom(TEST_SEED))
		const second = contract.generate(seededRandom(TEST_SEED))

		expect(contract.is(first)).toBe(true)
		expect(first).toEqual(second)
	})

	it('parses a valid value into a structurally equal rebuild and garbage into undefined', () => {
		const input = { category: 'comment', value: 'x' }

		expect(contract.parse(input)).toEqual(input)
		expect(contract.parse({ category: 'comment' })).toBeUndefined()
	})

	it('infers CommentNode both ways', () => {
		expectTypeOf<Infer<typeof commentShape>>().toEqualTypeOf<CommentNode>()
		expectTypeOf<CommentNode>().toEqualTypeOf<Infer<typeof commentShape>>()
	})
})

describe('doctypeShape', () => {
	const contract = createContract(doctypeShape)

	it('accepts a bare doctype and both legacy identifier forms', () => {
		expect(contract.is({ category: 'doctype', name: 'html' })).toBe(true)
		expect(contract.is({ category: 'doctype', name: 'html', system: 'legacy.dtd' })).toBe(true)
		expect(
			contract.is({
				category: 'doctype',
				name: 'html',
				public: '-//W3C//DTD//EN',
				system: 'x.dtd',
			}),
		).toBe(true)
	})

	it('rejects a missing name, a non-string identifier, and an extra key', () => {
		expect(contract.is({ category: 'doctype' })).toBe(false)
		expect(contract.is({ category: 'doctype', name: 'html', public: 1 })).toBe(false)
		expect(contract.is({ category: 'doctype', name: 'html', value: 'x' })).toBe(false)
	})

	it('declares a closed schema whose identifiers are optional', () => {
		expect(contract.schema.required).toEqual(['category', 'name'])
		expect(contract.schema.required).not.toContain('public')
		expect(contract.schema.required).not.toContain('system')
		expect(contract.schema.additionalProperties).toBe(false)
	})

	it('generates a guard-valid value, deterministic per seed', () => {
		const first = contract.generate(seededRandom(TEST_SEED))
		const second = contract.generate(seededRandom(TEST_SEED))

		expect(contract.is(first)).toBe(true)
		expect(first).toEqual(second)
	})

	it('parses a valid value into a structurally equal rebuild and garbage into undefined', () => {
		const input = { category: 'doctype', name: 'html', system: 'legacy.dtd' }

		expect(contract.parse(input)).toEqual(input)
		expect(contract.parse(input)).not.toBe(input)
		expect(contract.parse({ category: 'doctype' })).toBeUndefined()
	})

	it('accepts every doctype the parser produces', () => {
		const source = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "legacy.dtd">'
		const doctype = parseDocument(source).children[0]

		expect(contract.is(doctype)).toBe(true)
	})

	it('infers DoctypeNode both ways', () => {
		expectTypeOf<Infer<typeof doctypeShape>>().toEqualTypeOf<DoctypeNode>()
		expectTypeOf<DoctypeNode>().toEqualTypeOf<Infer<typeof doctypeShape>>()
	})
})
