import type { CollectionMutation } from './setup.js'
import type { HTMLDocument, HTMLNode } from '@src/core'
import { MAX_DEPTH } from '@src/core'
import { describe, expect, it } from 'vitest'
import WHATWG_ENTITIES from './src/core/fixtures/entities.json' with { type: 'json' }
import {
	attemptCollectionMutation,
	buildBranchingHTMLElement,
	buildCyclicHTMLNode,
	buildDeepHTMLDocument,
	buildDeepHTMLInput,
	buildDeepHTMLNode,
	buildDiamondHTMLDocument,
	buildEncodedHTMLSchemeCorpus,
	buildHTMLAttributeInput,
	buildHTMLCommentEnumeration,
	buildHTMLEntityURLCorpus,
	buildHTMLPageInput,
	buildHTMLRoundtripCorpus,
	buildHTMLSanitizerCorpus,
	buildHostileHTMLAllowlists,
	buildHostileHTMLNode,
	buildHostileHTMLPrototype,
	buildMixedHTMLInput,
	buildRevokedHTMLNode,
	buildShadowedHTMLAllowlist,
	buildSharedHTMLPreDocument,
	buildURLSafetyCorpus,
	extractHTMLText,
	hasAdjacentHTMLText,
	measureHTMLDepth,
	restoreCollectionMutation,
	returnHTMLNonIterator,
	throwHostileHTMLAccess,
	throwHostileHTMLGetter,
	URL_SAFETY_GROUPS,
	WHATWG_NAMED_ENTITIES,
} from './setup.js'

// The behavior tests/setup.ts exports to the workspace's suites, one case per contract those
// suites rely on. Production behavior is out of scope here: helpers.test.ts pins
// NAMED_ENTITIES against WHATWG_NAMED_ENTITIES, and it pins URL_SAFETY_GROUPS against the
// groups buildURLSafetyCorpus carries, so neither equality is restated in the cases that
// follow. TEST_SEED is a shared constant with no behavior of its own - `seededRandom` owns
// the determinism factories.test.ts and shapers.test.ts consume through it.
//
// Every expectation is derived by a route the module cannot share: the entity table is checked
// against the vendored fixture read directly and against WHATWG values written by hand, the
// enumerations are rebuilt by an independent odometer, the encoded corpora are decoded by an
// independent character-reference pass, and the graph builders are compared against hand-written
// documents and identity walks.

describe('setup - WHATWG entity table', () => {
	it('exposes every semicolon-terminated fixture name bare and excludes the rest', () => {
		const expected: string[] = []
		for (const name of Object.keys(WHATWG_ENTITIES)) {
			if (/^&[^&;]+;$/.test(name)) expected.push(name.slice(1, -1))
		}
		expect(Object.keys(WHATWG_NAMED_ENTITIES).sort()).toEqual(expected.sort())
		// `&amp` sits in the fixture beside `&amp;`; unfiltered it would arrive as `am`.
		expect(Object.hasOwn(WHATWG_NAMED_ENTITIES, 'amp')).toBe(true)
		expect(Object.hasOwn(WHATWG_NAMED_ENTITIES, 'am')).toBe(false)
	})

	it('maps each name to the fixture character string rather than its codepoints', () => {
		const fixture = new Map<string, string>()
		for (const [name, entry] of Object.entries(WHATWG_ENTITIES)) {
			fixture.set(name, entry.characters)
		}
		const mismatched: Array<{ readonly name: string; readonly value: string }> = []
		for (const [name, value] of Object.entries(WHATWG_NAMED_ENTITIES)) {
			if (fixture.get(`&${name};`) !== value) mismatched.push({ name, value })
		}
		expect(mismatched).toEqual([])
		// Values written from the WHATWG reference, so a codepoint-array table cannot pass.
		expect(WHATWG_NAMED_ENTITIES.amp).toBe('&')
		expect(WHATWG_NAMED_ENTITIES.copy).toBe('©')
		expect(WHATWG_NAMED_ENTITIES.fjlig).toBe('fj')
		expect(WHATWG_NAMED_ENTITIES.NotEqualTilde).toBe('≂̸')
	})

	it('refuses every mutation of the table', () => {
		expect(Object.isFrozen(WHATWG_NAMED_ENTITIES)).toBe(true)
		expect(Reflect.set(WHATWG_NAMED_ENTITIES, 'amp', 'mutated')).toBe(false)
		expect(Reflect.deleteProperty(WHATWG_NAMED_ENTITIES, 'amp')).toBe(false)
		expect(() => Object.defineProperty(WHATWG_NAMED_ENTITIES, 'added', { value: 'x' })).toThrow(
			TypeError,
		)
		expect(WHATWG_NAMED_ENTITIES.amp).toBe('&')
	})
})

describe('setup - collection mutation', () => {
	it('refuses a frozen array and a frozen record, and restores an unfrozen collection', () => {
		// The unfrozen pair is the control. An attempt that lands nothing would report every
		// frozen collection immutable without ever having tried a write that works, and a
		// restore that lands nothing would read the same way.
		const frozenList: readonly string[] = Object.freeze(['area', 'base'])
		const frozenTable: Readonly<Record<string, string>> = Object.freeze({ p: 'block' })
		const list = ['area', 'base']
		const table: Record<string, string> = { p: 'block' }
		const mutations: readonly CollectionMutation[] = [
			{ collection: frozenList, remove: 'area', key: 'area', value: 'p', original: 'area' },
			{ collection: frozenTable, remove: 'p', key: 'p', value: 'x', original: 'block' },
			{ collection: list, remove: 'area', key: 'area', value: 'p', original: 'area' },
			{ collection: table, remove: 'p', key: 'p', value: 'x', original: 'block' },
		]

		for (const mutation of mutations) attemptCollectionMutation(mutation)
		expect(Object.isFrozen(frozenList)).toBe(true)
		expect(Object.isFrozen(frozenTable)).toBe(true)
		expect([...frozenList]).toEqual(['area', 'base'])
		expect({ ...frozenTable }).toEqual({ p: 'block' })
		expect([...list]).not.toEqual(['area', 'base'])
		expect({ ...table }).not.toEqual({ p: 'block' })

		for (const mutation of mutations) restoreCollectionMutation(mutation)
		expect(Object.isFrozen(frozenList)).toBe(true)
		expect(Object.isFrozen(frozenTable)).toBe(true)
		expect([...frozenList]).toEqual(['area', 'base'])
		expect({ ...frozenTable }).toEqual({ p: 'block' })
		// Restoration returns the members. A named property the mutation cycle wrote beside them
		// is left behind - `area` on the array, `0` on the record - which is why a caller reads
		// the collection rather than the object.
		expect([...list]).toEqual(['area', 'base'])
		expect(table.p).toBe('block')
	})
})

describe('setup - HTML source builders', () => {
	it('carries every region the distiller prunes in one page', () => {
		const page = buildHTMLPageInput()
		const missing: string[] = []
		const regions = [
			'<!DOCTYPE html>',
			'<script>track()</script>',
			'<nav>',
			'<header hidden>',
			'<p aria-hidden="true">',
			'<div class="wrap">',
			'<pre><code class="language-ts">',
			'<div></div>',
			'<footer>',
			'<main><article>',
		]
		for (const region of regions) if (!page.includes(region)) missing.push(region)
		expect(missing).toEqual([])
	})

	it('nests the requested depth around the leaf and defaults the leaf text', () => {
		expect(buildDeepHTMLInput(2, 'x')).toBe('<div><div>x</div></div>')
		expect(buildDeepHTMLInput(1)).toBe('<div>leaf</div>')
		expect(buildDeepHTMLInput(0, 'bare')).toBe('bare')
		const deep = buildDeepHTMLInput(5_000, 'deep text')
		expect(deep.split('<div>').length - 1).toBe(5_000)
		expect(deep.split('</div>').length - 1).toBe(5_000)
		expect(deep.includes('<div>deep text</div>')).toBe(true)
	})

	it('builds one start tag carrying the requested count of duplicate empty attributes', () => {
		expect(buildHTMLAttributeInput(3)).toBe('<x a="" a="" a="" ></x>')
		const wide = buildHTMLAttributeInput(2_000)
		expect(wide.split('a=""').length - 1).toBe(2_000)
		expect(wide.startsWith('<x ')).toBe(true)
		expect(wide.endsWith('></x>')).toBe(true)
	})

	it('concatenates every parser-pressure family at the requested size', () => {
		expect(buildMixedHTMLInput(2)).toBe(
			'<x a="" a="" ></x><script></script><script></script><x><x></y></y>',
		)
		const mixed = buildMixedHTMLInput(500)
		expect(mixed.split('a=""').length - 1).toBe(500)
		expect(mixed.split('<script></script>').length - 1).toBe(500)
		expect(mixed.split('</y>').length - 1).toBe(500)
	})

	it('enumerates every bounded comment source over every introducer exactly once', () => {
		const alphabet = ['<', '!', '-', '>', 'x']
		const expected = new Set<string>()
		for (const prefix of ['<!--', '<!', '<?']) {
			for (let length = 0; length <= 6; length += 1) {
				for (let index = 0; index < alphabet.length ** length; index += 1) {
					let suffix = ''
					let remainder = index
					for (let position = 0; position < length; position += 1) {
						const character = alphabet[remainder % alphabet.length]
						if (character !== undefined) suffix = character + suffix
						remainder = Math.floor(remainder / alphabet.length)
					}
					expected.add(prefix + suffix)
				}
			}
		}
		const sources = buildHTMLCommentEnumeration()
		expect(new Set(sources).size).toBe(sources.length)
		expect(new Set(sources)).toEqual(expected)
	})

	it('parses every roundtrip source into a document spanning the recovery families', () => {
		const corpus = buildHTMLRoundtripCorpus()
		const categories = new Set<string>()
		let empty = 0
		for (const document of corpus) {
			expect(document.category).toBe('document')
			if (document.children.length === 0) empty += 1
			const pending: HTMLNode[] = [...document.children]
			while (pending.length > 0) {
				const node = pending.pop()
				if (node === undefined) continue
				categories.add(node.category)
				if (node.category === 'element') pending.push(...node.children)
			}
		}
		expect([...categories].sort()).toEqual(['comment', 'doctype', 'element', 'text'])
		// The empty source and the depth-saturating source are the boundaries the roundtrip
		// laws need, so a corpus that lost either would stop covering them.
		expect(empty).toBe(1)
		expect(corpus.some((document) => measureHTMLDepth(document) >= MAX_DEPTH)).toBe(true)
	})
})

describe('setup - adversarial corpora', () => {
	it('keeps every sanitizer token lowercase and non-empty for the consuming sweep', () => {
		// HTML.test.ts lowercases the serialized AST and the rendered HTML before matching, so an
		// uppercase token could never match and its absence assertion would pass vacuously.
		const corpus = buildHTMLSanitizerCorpus()
		expect(corpus.length).toBeGreaterThan(0)
		const unmatchable: Array<{ readonly name: string; readonly token: string }> = []
		const tokenless: string[] = []
		for (const threat of corpus) {
			if (threat.ast.length === 0 || threat.html.length === 0) tokenless.push(threat.name)
			for (const token of [...threat.ast, ...threat.html]) {
				if (token !== token.toLowerCase()) unmatchable.push({ name: threat.name, token })
			}
			if (threat.source.length === 0) tokenless.push(threat.name)
		}
		expect(unmatchable).toEqual([])
		expect(tokenless).toEqual([])
	})

	it('inventories the sanitizer corpus by contiguous family under unique names', () => {
		const corpus = buildHTMLSanitizerCorpus()
		const families: string[] = []
		for (const threat of corpus) {
			if (families.at(-1) !== threat.group) families.push(threat.group)
		}
		expect(families).toEqual(['attributes', 'urls', 'elements', 'recovery', 'text'])
		const names = corpus.map((threat) => `${threat.group}/${threat.name}`)
		expect(new Set(names).size).toBe(names.length)
	})

	it('groups the URL-safety corpus into one contiguous block per family', () => {
		// helpers.test.ts reads the corpus's families by first appearance and compares them
		// against URL_SAFETY_GROUPS, so a family reappearing after another begins would leave
		// that comparison reporting an order the corpus does not have.
		const corpus = buildURLSafetyCorpus()
		const blocks: string[] = []
		for (const threat of corpus) if (blocks.at(-1) !== threat.group) blocks.push(threat.group)
		expect(blocks).toEqual([...new Set(blocks)])
		const names = corpus.map((threat) => `${threat.group}/${threat.name}`)
		expect(new Set(names).size).toBe(names.length)
	})

	it('refuses every mutation of the URL-safety group list', () => {
		// helpers.test.ts compares the corpus's families against this list, so a suite that
		// pushed, replaced, or removed a member would move the population that comparison
		// reads rather than reporting the drift it exists to catch.
		const original = [...URL_SAFETY_GROUPS]
		expect(Object.isFrozen(URL_SAFETY_GROUPS)).toBe(true)
		expect(Reflect.set(URL_SAFETY_GROUPS, '0', 'mutated')).toBe(false)
		expect(Reflect.deleteProperty(URL_SAFETY_GROUPS, '0')).toBe(false)
		expect(() => Reflect.apply(Array.prototype.push, URL_SAFETY_GROUPS, ['added'])).toThrow(
			TypeError,
		)
		expect([...URL_SAFETY_GROUPS]).toEqual(original)
	})

	it('declares a retained value on every kept vector and none on a refused one', () => {
		const missing: string[] = []
		const retained: string[] = []
		for (const threat of buildURLSafetyCorpus()) {
			if (threat.group === 'kept' || threat.group === 'escaping') {
				if (threat.value === undefined) missing.push(threat.name)
			}
			if (threat.group === 'controls' || threat.group === 'schemes') {
				if (threat.value !== undefined) retained.push(threat.name)
			}
		}
		expect(missing).toEqual([])
		expect(retained).toEqual([])
	})

	it('obfuscates every entity URL and retains only the decoded allowed scheme', () => {
		const corpus = buildHTMLEntityURLCorpus()
		const plain: string[] = []
		const kept: string[] = []
		for (const threat of corpus) {
			if (!threat.source.includes('&')) plain.push(threat.name)
			if (threat.value !== undefined) kept.push(threat.name)
		}
		expect(plain).toEqual([])
		expect(kept).toEqual(['allowed named HTTPS'])
		const allowed = corpus.find((threat) => threat.value !== undefined)
		const decoded = allowed?.source.replace(
			/&([a-zA-Z][a-zA-Z0-9]*);/g,
			(match: string, name: string) => WHATWG_NAMED_ENTITIES[name] ?? match,
		)
		expect(decoded).toBe(allowed?.value)
		expect(decoded).toBe('https://host')
	})

	it('encodes every banned scheme as a direct, numeric, hexadecimal, and doubled form', () => {
		const shapes = new Map<string, Set<string>>()
		for (const value of buildEncodedHTMLSchemeCorpus()) {
			let decoded = value
			for (let pass = 0; pass < 4; pass += 1) {
				decoded = decoded
					.replace(/&#x([0-9a-fA-F]+);/g, (_match: string, hex: string) =>
						String.fromCodePoint(Number.parseInt(hex, 16)),
					)
					.replace(/&#(\d+);/g, (_match: string, digits: string) =>
						String.fromCodePoint(Number.parseInt(digits, 10)),
					)
					.replaceAll('&amp;', '&')
			}
			expect(decoded.endsWith(':payload')).toBe(true)
			const scheme = decoded.slice(0, decoded.indexOf(':'))
			let shape = 'direct'
			if (value.startsWith('&amp;')) shape = 'doubled'
			else if (value.startsWith('&#x')) shape = 'hexadecimal'
			else if (value.startsWith('&#')) shape = 'numeric'
			const shapesForScheme = shapes.get(scheme) ?? new Set<string>()
			shapesForScheme.add(shape)
			shapes.set(scheme, shapesForScheme)
		}
		expect([...shapes.keys()].sort()).toEqual(['data', 'file', 'javascript', 'vbscript'])
		for (const [scheme, forms] of shapes) {
			expect({ scheme, forms: [...forms].sort() }).toEqual({
				scheme,
				forms: ['direct', 'doubled', 'hexadecimal', 'numeric'],
			})
		}
	})
})

describe('setup - hostile test values', () => {
	it('throws on every call and returns a non-object from the iterator stand-in', () => {
		expect(throwHostileHTMLAccess).toThrow('hostile option access')
		expect(throwHostileHTMLGetter).toThrow('hostile HTML getter')
		expect(returnHTMLNonIterator()).toBe(0)
		expect(typeof returnHTMLNonIterator()).not.toBe('object')
	})

	it('fails each hostile allowlist at its own collection seam', () => {
		const outcomes: string[] = []
		for (const allowlist of buildHostileHTMLAllowlists()) {
			try {
				const members = [...allowlist]
				outcomes.push(`iterated ${members.length}`)
			} catch (error) {
				if (error instanceof TypeError) outcomes.push('TypeError')
				else if (error instanceof Error) outcomes.push(error.message)
				else outcomes.push('unknown')
			}
		}
		// A throwing iterator, a proxy trapping every read, and an iterator returning a
		// non-object - the malformed one fails the protocol rather than the access.
		expect(outcomes).toEqual(['hostile option access', 'hostile option access', 'TypeError'])
	})

	it('keeps the shadowed allowlist iterable while its query members throw', () => {
		const allowlist = buildShadowedHTMLAllowlist()
		expect([...allowlist]).toEqual(['script', 'p', 'onclick', 'href', 'javascript'])
		expect(() => allowlist.has('p')).toThrow('hostile option access')
		expect(() => allowlist.size).toThrow('hostile option access')
	})

	it('throws from every hostile value a structural read touches', () => {
		expect(() => JSON.stringify(buildHostileHTMLNode())).toThrow('hostile HTML getter')
		expect(() => JSON.stringify(buildRevokedHTMLNode())).toThrow(TypeError)
	})

	it('inherits the hostile prototype property and throws only when it is read', () => {
		const prototype = buildHostileHTMLPrototype()
		expect(Object.getOwnPropertyDescriptor(prototype, 'poison')?.enumerable).toBe(true)
		const child: object = Object.create(prototype)
		expect(Object.keys(child)).toEqual([])
		expect(() => Reflect.get(child, 'poison')).toThrow('hostile HTML getter')
	})
})

describe('setup - graph builders', () => {
	it('nests exactly the requested depth above one text leaf in both node shapes', () => {
		const expected: HTMLDocument = {
			category: 'document',
			children: [
				{
					category: 'element',
					name: 'div',
					attributes: [],
					children: [
						{
							category: 'element',
							name: 'div',
							attributes: [],
							children: [{ category: 'text', value: 'leaf' }],
						},
					],
				},
			],
		}
		expect(buildDeepHTMLDocument(2)).toEqual(expected)
		expect(buildDeepHTMLNode(2)).toEqual(expected)
		expect(buildDeepHTMLDocument(0)).toEqual({
			category: 'document',
			children: [{ category: 'text', value: 'leaf' }],
		})
		const deep = JSON.stringify(buildDeepHTMLNode(MAX_DEPTH + 1))
		expect(deep.split('"name":"div"').length - 1).toBe(MAX_DEPTH + 1)
	})

	it('shares one node per diamond layer so the node count stays linear', () => {
		const depth = 20
		const document = buildDiamondHTMLDocument(depth)
		const root = document.children.at(0)
		expect(root?.category === 'element' && root.children[0] === root.children[1]).toBe(true)
		const visited = new Set<HTMLNode>()
		const pending: HTMLNode[] = [...document.children]
		while (pending.length > 0) {
			const node = pending.pop()
			if (node === undefined || visited.has(node)) continue
			visited.add(node)
			if (node.category === 'element') pending.push(...node.children)
		}
		// One `span` per layer plus the single text leaf, however many paths reach it.
		expect(visited.size).toBe(depth + 1)
		expect(measureHTMLDepth(document)).toBe(depth)
	})

	it('gives every pre element the same comment-bearing child', () => {
		const count = 4
		const document = buildSharedHTMLPreDocument(count)
		const names: string[] = []
		const children = new Set<HTMLNode>()
		for (const child of document.children) {
			if (child.category !== 'element') continue
			names.push(child.name)
			const only = child.children.at(0)
			if (only !== undefined) children.add(only)
		}
		expect(names).toEqual(['pre', 'pre', 'pre', 'pre'])
		expect(children.size).toBe(1)
		const shared = [...children].at(0)
		const values =
			shared?.category === 'element'
				? shared.children.map((node) => (node.category === 'comment' ? node.value : node.category))
				: []
		expect(values).toEqual(['comment-0', 'comment-1', 'comment-2', 'comment-3'])
	})

	it('points both branching children and the cyclic node back at their own element', () => {
		const element = buildBranchingHTMLElement('section')
		expect(element.name).toBe('section')
		expect(element.children[0]).toBe(element)
		expect(element.children[1]).toBe(element)
		expect(() => JSON.stringify(element)).toThrow(TypeError)
		expect(() => JSON.stringify(buildCyclicHTMLNode())).toThrow(TypeError)
	})
})

describe('setup - document traversal helpers', () => {
	it('collects every text value in source order at any depth', () => {
		const document: HTMLDocument = {
			category: 'document',
			children: [
				{ category: 'doctype', name: 'html' },
				{
					category: 'element',
					name: 'p',
					attributes: [],
					children: [
						{ category: 'text', value: 'one ' },
						{ category: 'comment', value: 'skipped' },
						{
							category: 'element',
							name: 'b',
							attributes: [],
							children: [{ category: 'text', value: 'two ' }],
						},
						{ category: 'text', value: 'three ' },
					],
				},
				{ category: 'text', value: 'four' },
			],
		}
		expect(extractHTMLText(document)).toBe('one two three four')
		expect(extractHTMLText({ category: 'document', children: [] })).toBe('')
		// The traversal is iterative, so a document far past any call-stack budget still returns.
		expect(extractHTMLText(buildDeepHTMLDocument(50_000))).toBe('leaf')
	})

	it('detects adjacent text siblings at any depth and passes a separated list', () => {
		const separated: HTMLDocument = {
			category: 'document',
			children: [
				{ category: 'text', value: 'a' },
				{
					category: 'element',
					name: 'b',
					attributes: [],
					children: [{ category: 'text', value: 'inner' }],
				},
				{ category: 'text', value: 'c' },
			],
		}
		expect(hasAdjacentHTMLText(separated)).toBe(false)
		const adjacent: HTMLDocument = {
			category: 'document',
			children: [
				{
					category: 'element',
					name: 'div',
					attributes: [],
					children: [
						{
							category: 'element',
							name: 'p',
							attributes: [],
							children: [
								{ category: 'text', value: 'a' },
								{ category: 'text', value: 'b' },
							],
						},
					],
				},
			],
		}
		expect(hasAdjacentHTMLText(adjacent)).toBe(true)
		expect(hasAdjacentHTMLText(buildDeepHTMLDocument(50_000))).toBe(false)
	})

	it('measures the greatest element depth and ignores every other category', () => {
		const document: HTMLDocument = {
			category: 'document',
			children: [
				{ category: 'text', value: 'root text' },
				{ category: 'comment', value: 'root comment' },
				{
					category: 'element',
					name: 'p',
					attributes: [],
					children: [{ category: 'text', value: 'shallow' }],
				},
				{
					category: 'element',
					name: 'div',
					attributes: [],
					children: [
						{
							category: 'element',
							name: 'span',
							attributes: [],
							children: [
								{
									category: 'element',
									name: 'b',
									attributes: [],
									children: [{ category: 'text', value: 'deep' }],
								},
							],
						},
					],
				},
			],
		}
		expect(measureHTMLDepth(document)).toBe(3)
		expect(measureHTMLDepth({ category: 'document', children: [] })).toBe(0)
		expect(
			measureHTMLDepth({
				category: 'document',
				children: [{ category: 'text', value: 'flat' }],
			}),
		).toBe(0)
		expect(measureHTMLDepth(buildDeepHTMLDocument(500))).toBe(500)
	})
})
