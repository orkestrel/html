import { decodeEntities } from '@src/core'
import { expect, it } from 'vitest'

const recognizedSmall = '&NotEqualTilde;'.repeat(40_000)
const recognizedLarge = '&NotEqualTilde;'.repeat(80_000)
const unknownSmall = `&${'unknown'.repeat(30_000)};`
const unknownLarge = `&${'unknown'.repeat(60_000)};`
const nestedSmall = '&amp;amp;'.repeat(40_000)
const nestedLarge = '&amp;amp;'.repeat(80_000)

it('decodeEntities — 40,000 recognized references', async ({ bench }) => {
	await bench('decodeEntities — 40,000 recognized references', {}, () => {
		decodeEntities(recognizedSmall)
	}).run()
	expect(decodeEntities(recognizedSmall)).toBe('\u2242\u0338'.repeat(40_000))
})

it('decodeEntities — 80,000 recognized references', async ({ bench }) => {
	await bench('decodeEntities — 80,000 recognized references', {}, () => {
		decodeEntities(recognizedLarge)
	}).run()
	expect(decodeEntities(recognizedLarge)).toBe('\u2242\u0338'.repeat(80_000))
})

it('decodeEntities — one unknown name of 30,000 segments', async ({ bench }) => {
	await bench('decodeEntities — one unknown name of 30,000 segments', {}, () => {
		decodeEntities(unknownSmall)
	}).run()
	expect(decodeEntities(unknownSmall)).toBe(unknownSmall)
})

it('decodeEntities — one unknown name of 60,000 segments', async ({ bench }) => {
	await bench('decodeEntities — one unknown name of 60,000 segments', {}, () => {
		decodeEntities(unknownLarge)
	}).run()
	expect(decodeEntities(unknownLarge)).toBe(unknownLarge)
})

it('decodeEntities — 40,000 nested references', async ({ bench }) => {
	await bench('decodeEntities — 40,000 nested references', {}, () => {
		decodeEntities(nestedSmall)
	}).run()
	expect(decodeEntities(nestedSmall)).toBe('&amp;'.repeat(40_000))
})

it('decodeEntities — 80,000 nested references', async ({ bench }) => {
	await bench('decodeEntities — 80,000 nested references', {}, () => {
		decodeEntities(nestedLarge)
	}).run()
	expect(decodeEntities(nestedLarge)).toBe('&amp;'.repeat(80_000))
})
