import { MAX_DEPTH, isHTMLDocument, parseDocument } from '@src/core'
import { expect, it } from 'vitest'
import { buildHTMLAttributeInput, buildMixedHTMLInput } from '../../setup.js'

const rawElements = '<script></script>'.repeat(15_000)
const closeSoupSmall = `${'<x>'.repeat(12_000)}${'</y>'.repeat(12_000)}`
const closeSoupLarge = `${'<x>'.repeat(24_000)}${'</y>'.repeat(24_000)}`
const strayCloseSmall = `${'<x>'.repeat(MAX_DEPTH)}${'</y>'.repeat(50_000)}`
const strayCloseLarge = `${'<x>'.repeat(MAX_DEPTH)}${'</y>'.repeat(100_000)}`
const attributesSmall = buildHTMLAttributeInput(96_000)
const attributesLarge = buildHTMLAttributeInput(192_000)
const mixedSmall = buildMixedHTMLInput(10_000)
const mixedLarge = buildMixedHTMLInput(20_000)

it('parseDocument — 15,000 repeated raw elements', async ({ bench }) => {
	await bench('parseDocument — 15,000 repeated raw elements', {}, () => {
		parseDocument(rawElements)
	}).run()
	expect(isHTMLDocument(parseDocument(rawElements))).toBe(true)
})

it('parseDocument — 12,000 opens then 12,000 unmatched closes', async ({ bench }) => {
	await bench('parseDocument — 12,000 opens then 12,000 unmatched closes', {}, () => {
		parseDocument(closeSoupSmall)
	}).run()
	expect(isHTMLDocument(parseDocument(closeSoupSmall))).toBe(true)
})

it('parseDocument — 24,000 opens then 24,000 unmatched closes', async ({ bench }) => {
	await bench('parseDocument — 24,000 opens then 24,000 unmatched closes', {}, () => {
		parseDocument(closeSoupLarge)
	}).run()
	expect(isHTMLDocument(parseDocument(closeSoupLarge))).toBe(true)
})

it('parseDocument — 50,000 unmatched closes against a full stack', async ({ bench }) => {
	await bench('parseDocument — 50,000 unmatched closes against a full stack', {}, () => {
		parseDocument(strayCloseSmall)
	}).run()
	expect(isHTMLDocument(parseDocument(strayCloseSmall))).toBe(true)
})

it('parseDocument — 100,000 unmatched closes against a full stack', async ({ bench }) => {
	await bench('parseDocument — 100,000 unmatched closes against a full stack', {}, () => {
		parseDocument(strayCloseLarge)
	}).run()
	expect(isHTMLDocument(parseDocument(strayCloseLarge))).toBe(true)
})

it('parseDocument — 96,000 duplicate quoted attributes', async ({ bench }) => {
	await bench('parseDocument — 96,000 duplicate quoted attributes', {}, () => {
		parseDocument(attributesSmall)
	}).run()
	expect(isHTMLDocument(parseDocument(attributesSmall))).toBe(true)
})

it('parseDocument — 192,000 duplicate quoted attributes', async ({ bench }) => {
	await bench('parseDocument — 192,000 duplicate quoted attributes', {}, () => {
		parseDocument(attributesLarge)
	}).run()
	expect(isHTMLDocument(parseDocument(attributesLarge))).toBe(true)
})

it('parseDocument — mixed pressure at 10,000 per family', async ({ bench }) => {
	await bench('parseDocument — mixed pressure at 10,000 per family', {}, () => {
		parseDocument(mixedSmall)
	}).run()
	expect(isHTMLDocument(parseDocument(mixedSmall))).toBe(true)
})

it('parseDocument — mixed pressure at 20,000 per family', async ({ bench }) => {
	await bench('parseDocument — mixed pressure at 20,000 per family', {}, () => {
		parseDocument(mixedLarge)
	}).run()
	expect(isHTMLDocument(parseDocument(mixedLarge))).toBe(true)
})
