// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The `@src/core` imports, the constants
// that follow them, and the closing `flagship fences` block are this package's own, and
// are the only parts a sibling package changes.

import type { HTMLHandlerMap, HTMLNode } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	attributeOf,
	collapseSpace,
	collapseText,
	createHTML,
	decodeEntities,
	encodeAttribute,
	encodeText,
	extractRegion,
	foldNode,
	HTML,
	isBlockElement,
	isElementNode,
	isEmptyElement,
	isHTMLCodePoint,
	isHTMLDocument,
	isHTMLNode,
	isLiteralElement,
	isRawElement,
	isSafeURL,
	isTextNode,
	isVoidElement,
	lowercaseASCII,
	mergeText,
	normalizeSource,
	parseDocument,
	parseProvenance,
	parseStartTag,
	projectSpan,
	pruneDocument,
	REGION_ELEMENTS,
	renderHTML,
	renderText,
	resolveAttributes,
	resolveURL,
	rewriteDocument,
	SAFE_ATTRIBUTES,
	SAFE_ELEMENTS,
	SAFE_URL_SCHEMES,
	sanitizeAttributes,
	sanitizeURL,
	scanAttributes,
	scanComment,
	scanDoctype,
	scanRawText,
	scanTag,
	walkNodes,
} from '@src/core'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { readFileSync } from 'node:fs'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({ '@orkestrel/html': 'src/core', '@src/core': 'src/core' })
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows it fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md'])

const root = new URL('../', import.meta.url)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sources = createSourceManager({ files, modules: MODULES })

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('re-exports every direct declaration that is not named internal', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
		})
		it('re-exports only direct declarations', () => {
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
		})
		it('documents every barrel export', () => {
			expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		})
		it('documents only barrel exports', () => {
			expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(computeSymbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every API Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.keyword === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			for (const fence of fences) {
				for (const { specifier, names } of extractFenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					const surface = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, surface)).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
		})
	})
}

// The EXECUTED half. Every preceding check reads a name, and a name that resolves proves
// nothing about the sentence beside it, so a fence documenting a value the code
// contradicts passes all of them. The cases run every fence in the `guides/html.md` guide
// and the usage and start-tag fences in the `README.md` file, and assert the values their
// trailing comments claim. Change a fence, change the transcription beside it.
describe('flagship fences', () => {
	const guideText = requireValue(files['guides/html.md'], 'Missing file: guides/html.md')
	const readmeText = readFileSync(new URL('README.md', root), 'utf8')

	it('parses a page, then queries it by guard, walk order, and span', () => {
		const page = createHTML('<h1>Title</h1><p>A <b>bold</b> word.</p>')

		expect(page.document.children[0]).toEqual({
			category: 'element',
			name: 'h1',
			attributes: [],
			children: [{ category: 'text', value: 'Title' }],
		})
		expect(page.span(page.document)).toEqual({ start: 0, end: 40 })
		expect(page.find(isElementNode)?.name).toBe('h1')
		expect(page.filter(isElementNode).map((element) => element.name)).toEqual(['h1', 'p', 'b'])

		const categories: string[] = []
		for (const node of page.walk()) categories.push(node.category)
		expect(categories).toEqual([
			'document',
			'element',
			'text',
			'element',
			'text',
			'element',
			'text',
			'text',
		])
	})

	it('adopts a foreign document through the total guard and refuses a bogus one', () => {
		const candidate: unknown = { category: 'document', children: [] }
		const adopted = isHTMLDocument(candidate) ? new HTML(candidate) : undefined
		expect(adopted).toBeInstanceOf(HTML)

		const bogus: unknown = { category: 'bogus' }
		const refused = isHTMLDocument(bogus) ? new HTML(bogus) : undefined
		expect(refused).toBeUndefined()

		expect(isHTMLNode({ category: 'text', value: 'a & b' })).toBe(true)
	})

	it('rewrites with map, counts with reduce, and projects with fold', () => {
		const page = createHTML('<h1>Title</h1><p>A <b>bold</b> word.</p>')

		const shouted = page.map((node) =>
			node.category === 'text' ? { category: 'text', value: node.value.toUpperCase() } : node,
		)
		expect(renderHTML(shouted.document)).toBe('<h1>TITLE</h1><p>A <b>BOLD</b> WORD.</p>')
		expect(renderHTML(page.document)).toBe('<h1>Title</h1><p>A <b>bold</b> word.</p>')

		expect(
			page.reduce((total, node) => (isTextNode(node) ? total + node.value.length : total), 0),
		).toBe(17)

		const elements: HTMLHandlerMap<number> = {
			document: (_, children) => children.reduce((total, value) => total + value, 0),
			element: (_, children) => 1 + children.reduce((total, value) => total + value, 0),
			text: () => 0,
			comment: () => 0,
			doctype: () => 0,
		}
		expect(page.fold(elements)).toBe(3)
	})

	it("streams the root's direct children through a reader and an async iteration", async () => {
		const page = createHTML('<h1>Title</h1><p>First.</p><p>Second.</p>')

		const read: string[] = []
		const reader = page.stream().getReader()
		for (let result = await reader.read(); !result.done; result = await reader.read()) {
			read.push(result.value.category)
		}
		expect(read).toEqual(['element', 'element', 'element'])

		const iterated: string[] = []
		for await (const node of page.stream()) iterated.push(node.category)
		expect(iterated).toEqual(read)
	})

	it('sanitizes to the floor whatever the element and attribute allowlists say', () => {
		const page = createHTML(
			'<div id="wrap"><p onclick="steal()">Hi <script>steal()</script>' +
				'<a href="javascript:alert(1)">bad</a></p><!-- note --></div>',
		)

		expect(renderHTML(page.sanitize().document)).toBe('<div><p>Hi <a>bad</a></p></div>')
		expect(renderHTML(page.sanitize({ comments: true }).document)).toBe(
			'<div><p>Hi <a>bad</a></p><!-- note --></div>',
		)
		expect(renderHTML(page.sanitize({ elements: new Set(['p']) }).document)).toBe('<p>Hi bad</p>')
		expect(renderHTML(page.sanitize({ elements: ['p'] }).document)).toBe('<p>Hi bad</p>')
		expect(renderHTML(page.sanitize({ elements: SAFE_ELEMENTS, comments: true }).document)).toBe(
			'<div><p>Hi <a>bad</a></p><!-- note --></div>',
		)

		const link = createHTML('<a href="/guide" onclick="steal()" title="Guide">g</a>')
		expect(renderHTML(link.sanitize({ attributes: new Set(['href', 'onclick']) }).document)).toBe(
			'<a href="/guide">g</a>',
		)

		expect(renderHTML(createHTML('<img src="/x.png" alt="x">').sanitize().document)).toBe(
			'<img alt="x">',
		)
		expect(
			renderHTML(createHTML('<a href="java&#115;cript:alert(1)">bad</a>').sanitize().document),
		).toBe('<a>bad</a>')
		expect(
			renderHTML(
				createHTML(
					'<table><tr><td align=" Center ">c</td></tr></table><p align="center">p</p>',
				).sanitize({ attributes: ['align'] }).document,
			),
		).toBe('<table><tr><td align="center">c</td></tr></table><p>p</p>')
	})

	it('distills a page to its content and keeps the handle a projection choice', () => {
		const content = {
			html: '<nav>Menu</nav><main><h1>Title</h1><p>Read the <a href="/b">guide</a>.</p></main>',
			url: 'https://x.dev/docs/page',
		}
		const page = createHTML(content.html)

		const safe = page.sanitize()
		const article = page.distill({ base: content.url })

		expect(renderHTML(article.document)).toBe(
			'<h1>Title</h1><p>Read the <a href="https://x.dev/b">guide</a>.</p>',
		)
		expect(renderText(article.document)).toBe('Title\nRead the guide.')
		expect(renderText(safe.document)).toBe('Menu\nTitle\nRead the guide.')

		const narrow = page.distill({ boilerplate: ['footer'], elements: new Set(['h1', 'p', 'a']) })
		expect(narrow.document.category).toBe('document')
	})

	it('drives the standalone leaves on a bare node with no handle at all', () => {
		const [document, spans] = parseProvenance('<nav>x</nav><main><p>Keep<!-- drop --></p></main>')
		expect(spans.get(document)).toEqual({ start: 0, end: 49 })

		const [region] = extractRegion(document, REGION_ELEMENTS)
		const [pruned] = pruneDocument(region, (node) => (node.category === 'comment' ? [] : [node]))
		expect(renderHTML(pruned)).toBe('<p>Keep</p>')

		const [lowered] = rewriteDocument(document, (node) =>
			node.category === 'text' ? { category: 'text', value: node.value.toLowerCase() } : node,
		)
		expect(renderText(lowered)).toBe('x\nkeep')

		expect([...walkNodes(region)].map((node) => node.category)).toEqual([
			'document',
			'element',
			'text',
			'comment',
		])

		const leaves: HTMLHandlerMap<number> = {
			document: (_, children) => children.reduce((total, value) => total + value, 0),
			element: (_, children) => children.reduce((total, value) => total + value, 0),
			text: () => 1,
			comment: () => 1,
			doctype: () => 1,
		}
		expect(foldNode(region, leaves)).toBe(2)

		const joined: readonly HTMLNode[] = mergeText([
			{ category: 'text', value: 'a ' },
			{ category: 'text', value: 'b' },
		])
		expect(joined).toEqual([{ category: 'text', value: 'a b' }])
		expect(collapseText([{ category: 'text', value: ' a \n b ' }])[0]).toEqual([
			{ category: 'text', value: ' a b ' },
		])
	})

	it('scans one construct at a time and reports each exact end offset', () => {
		const [normalized, offsets] = normalizeSource('A\r\n\u{1d54f}')
		expect(normalized).toBe('A\n\u{1d54f}')
		expect(projectSpan(offsets, 2, 4)).toEqual({ start: 3, end: 5 })
		expect(projectSpan([0, 1], 1, 2)).toBeUndefined()

		expect(parseStartTag('<html lang="en" data-bs-theme="light">', 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'lang', value: 'en' },
				{ name: 'data-bs-theme', value: 'light' },
			],
			slashed: false,
			next: 38,
		})
		expect(parseStartTag('<html data-note="unterminated>', 0)).toBeUndefined()

		expect(scanTag('<IMG SRC="x.png" alt=hi />', 0)).toEqual({
			name: 'img',
			attributes: [
				{ name: 'src', value: 'x.png' },
				{ name: 'alt', value: 'hi' },
			],
			closing: false,
			next: 26,
		})

		expect(scanAttributes(' HREF="/a" disabled href="/b"')).toEqual([
			{ name: 'href', value: '/a' },
			{ name: 'disabled' },
		])

		expect(scanComment('<![CDATA[x]]>', 0)).toEqual({
			node: { category: 'comment', value: '[CDATA[x]]' },
			next: 13,
		})
		expect(scanDoctype('<!DOCTYPE html>', 0)).toEqual({
			node: { category: 'doctype', name: 'html' },
			next: 15,
		})
		expect(scanRawText('a < b</SCRIPT>tail', 0, 'script')).toEqual({
			node: { category: 'text', value: 'a < b' },
			span: { start: 0, end: 5 },
			next: 14,
			closed: true,
		})

		expect(decodeEntities('a &amp; b &#169; c &bogus;')).toBe('a & b \u{a9} c &bogus;')
		expect(lowercaseASCII('HTML-\u{3a9}')).toBe('html-\u{3a9}')
		expect(isHTMLCodePoint(0x1f600)).toBe(true)
		expect(isHTMLCodePoint(0xd800)).toBe(false)
	})

	it('escapes, resolves, and inspects one attribute at a time', () => {
		expect(encodeText('a & b < c')).toBe('a &amp; b &lt; c')
		expect(encodeAttribute('a "b" & c')).toBe('a &quot;b&quot; &amp; c')
		expect(collapseSpace('  a \n\t b  ')).toBe('a b')

		expect(sanitizeURL('java&#115;cript:alert(1)', SAFE_URL_SCHEMES)).toBe('')
		expect(sanitizeURL('/docs/page', SAFE_URL_SCHEMES)).toBe('/docs/page')
		expect(resolveURL('../a', 'https://x.dev/docs/page')).toBe('https://x.dev/a')

		const parsed = parseDocument('<a href="javascript:alert(1)" title="Home" onclick="x()">t</a>')
			.children[0]
		const anchor = requireValue(
			isElementNode(parsed) ? parsed : undefined,
			'The anchor fence parsed no element',
		)
		expect(attributeOf(anchor, 'TITLE')).toBe('Home')
		expect(sanitizeAttributes(anchor, SAFE_ATTRIBUTES, SAFE_URL_SCHEMES)).toEqual([
			{ name: 'title', value: 'Home' },
		])
		// The fence claims base resolution over every URL attribute and a lowercased name on
		// the rest. An absolute `javascript:` URL resolves to itself, so the value survives
		// exactly as written - the pass-through half of the same claim.
		expect(resolveAttributes(anchor, 'https://x.dev/docs/')).toEqual([
			{ name: 'href', value: 'javascript:alert(1)' },
			{ name: 'title', value: 'Home' },
			{ name: 'onclick', value: 'x()' },
		])
	})

	it('answers a name predicate, a URL predicate, and an emptiness predicate', () => {
		expect(isVoidElement('BR')).toBe(true)
		expect(isRawElement('script')).toBe(true)
		expect(isLiteralElement('title')).toBe(true)
		expect(isBlockElement('p')).toBe(true)

		expect(isSafeURL('/a')).toBe(true)
		expect(isSafeURL('javascript:x')).toBe(false)
		expect(isSafeURL('ftp://x.dev', new Set(['ftp']))).toBe(true)

		const image = requireValue(
			parseDocument('<img src="a.png" alt="A">').children.find(isElementNode),
			'The image fence parsed no element',
		)
		expect(isEmptyElement(image)).toBe(true)
	})

	it('holds the AST fixpoint, canonical idempotence, and sanitize fixpoint laws', () => {
		const page = createHTML('<P CLASS=a>x<BR/></P>')

		expect(renderHTML(page.document)).toBe('<p class="a">x<br></p>')
		expect(parseDocument(renderHTML(page.document))).toEqual(page.document)
		expect(renderHTML(parseDocument(renderHTML(page.document)))).toBe(renderHTML(page.document))

		const clean = page.sanitize().document
		expect(renderHTML(createHTML(clean).sanitize().document)).toBe(renderHTML(clean))
		expect(renderHTML(createHTML(renderHTML(clean)).sanitize().document)).toBe(renderHTML(clean))
	})

	it('answers the README usage and start-tag fences with the values they claim', () => {
		const page = createHTML(
			'<nav>Menu</nav><main><h1>Title</h1><p>Read the <a href="/b">guide</a>.</p></main>',
		)
		const article = page.distill({ base: 'https://x.dev/docs/page' })

		expect(renderHTML(article.document)).toBe(
			'<h1>Title</h1><p>Read the <a href="https://x.dev/b">guide</a>.</p>',
		)
		expect(renderText(article.document)).toBe('Title\nRead the guide.')

		expect(parseStartTag('<html lang="en" data-note="a>b">', 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'lang', value: 'en' },
				{ name: 'data-note', value: 'a>b' },
			],
			slashed: false,
			next: 32,
		})
		expect(parseStartTag('<html data-note="unterminated>', 0)).toBeUndefined()
	})

	// The presence guards beside the transcriptions. Each proves the transcribed line is
	// still the documented one and nothing whatever about behavior, so a fence input or a
	// documented value edited away from its transcription reddens here rather than leaving a
	// stale proof green.
	it('carries every guide fence line whose input or documented value a transcription reuses', () => {
		const claims = [
			"const page = createHTML('<h1>Title</h1><p>A <b>bold</b> word.</p>')",
			"page.document.children[0] // { category: 'element', name: 'h1', attributes: [], children: [...] }",
			'page.span(page.document) // { start: 0, end: 40 }',
			"page.find(isElementNode)?.name // 'h1'",
			"page.filter(isElementNode).map((element) => element.name) // ['h1', 'p', 'b']",
			"// ['document', 'element', 'text', 'element', 'text', 'element', 'text', 'text']",
			"adopt({ category: 'document', children: [] }) // an HTML handle",
			"adopt({ category: 'bogus' }) // undefined - rejected before any handle exists",
			"isHTMLNode({ category: 'text', value: 'a & b' }) // true - one leaf, validated from unknown",
			"node.category === 'text' ? { category: 'text', value: node.value.toUpperCase() } : node,",
			"renderHTML(shouted.document) // '<h1>TITLE</h1><p>A <b>BOLD</b> WORD.</p>'",
			"renderHTML(page.document) // '<h1>Title</h1><p>A <b>bold</b> word.</p>' - never mutated",
			'page.reduce((total, node) => (isTextNode(node) ? total + node.value.length : total), 0) // 17',
			'const elements: HTMLHandlerMap<number> = {\n\tdocument: (_, children) => children.reduce((total, value) => total + value, 0),\n\telement: (_, children) => 1 + children.reduce((total, value) => total + value, 0),\n\ttext: () => 0,\n\tcomment: () => 0,\n\tdoctype: () => 0,\n}',
			'page.fold(elements) // 3',
			"const page = createHTML('<h1>Title</h1><p>First.</p><p>Second.</p>')",
			"result.value.category // 'element' - the root's direct children only",
			'\'<div id="wrap"><p onclick="steal()">Hi <script>steal()</script>\' +',
			'\'<a href="javascript:alert(1)">bad</a></p><!-- note --></div>\',',
			"renderHTML(page.sanitize().document)\n// '<div><p>Hi <a>bad</a></p></div>'",
			"renderHTML(page.sanitize({ comments: true }).document)\n// '<div><p>Hi <a>bad</a></p><!-- note --></div>'",
			"renderHTML(page.sanitize({ elements: new Set(['p']) }).document)\n// '<p>Hi bad</p>'",
			"renderHTML(page.sanitize({ elements: ['p'] }).document) // '<p>Hi bad</p>' - same as the preceding Set",
			"renderHTML(page.sanitize({ elements: SAFE_ELEMENTS, comments: true }).document)\n// '<div><p>Hi <a>bad</a></p><!-- note --></div>'",
			'const link = createHTML(\'<a href="/guide" onclick="steal()" title="Guide">g</a>\')',
			"renderHTML(link.sanitize({ attributes: new Set(['href', 'onclick']) }).document)\n// '<a href=\"/guide\">g</a>'",
			'renderHTML(createHTML(\'<img src="/x.png" alt="x">\').sanitize().document)\n// \'<img alt="x">\' - alt kept, resource src removed by the default attributes',
			"renderHTML(createHTML('<a href=\"java&#115;cript:alert(1)\">bad</a>').sanitize().document)\n// '<a>bad</a>' - the entity-obfuscated scheme is decoded and refused",
			'renderHTML(\n\tcreateHTML(\'<table><tr><td align=" Center ">c</td></tr></table><p align="center">p</p>\').sanitize(\n\t\t{ attributes: [\'align\'] },\n\t).document,\n)\n// \'<table><tr><td align="center">c</td></tr></table><p>p</p>\' - only a cell keeps trimmed lowercase align',
			'html: \'<nav>Menu</nav><main><h1>Title</h1><p>Read the <a href="/b">guide</a>.</p></main>\',',
			"url: 'https://x.dev/docs/page',",
			'const safe = page.sanitize()',
			'const article = page.distill({ base: content.url })',
			'renderHTML(article.document) // \'<h1>Title</h1><p>Read the <a href="https://x.dev/b">guide</a>.</p>\'',
			"renderText(article.document) // 'Title\\nRead the guide.'",
			"renderText(safe.document) // 'Menu\\nTitle\\nRead the guide.'",
			"const narrow = page.distill({ boilerplate: ['footer'], elements: new Set(['h1', 'p', 'a']) })",
			"narrow.document.category // 'document' - always a handle, never a string",
			"const [document, spans] = parseProvenance('<nav>x</nav><main><p>Keep<!-- drop --></p></main>')",
			'spans.get(document) // { start: 0, end: 49 }',
			'const [region] = extractRegion(document, REGION_ELEMENTS)',
			"const [pruned] = pruneDocument(region, (node) => (node.category === 'comment' ? [] : [node]))",
			"renderHTML(pruned)\n// '<p>Keep</p>' - [] drops, node.children unwraps, [node] keeps",
			"node.category === 'text' ? { category: 'text', value: node.value.toLowerCase() } : node,",
			"renderText(lowered) // 'x\\nkeep'",
			'const categories = [...walkNodes(region)].map((node) => node.category)',
			"// ['document', 'element', 'text', 'comment'] - depth-first, pre-order, root included",
			'const leaves: HTMLHandlerMap<number> = {\n\tdocument: (_, children) => children.reduce((total, value) => total + value, 0),\n\telement: (_, children) => children.reduce((total, value) => total + value, 0),\n\ttext: () => 1,\n\tcomment: () => 1,\n\tdoctype: () => 1,\n}',
			'foldNode(region, leaves) // 2',
			"mergeText([\n\t{ category: 'text', value: 'a ' },\n\t{ category: 'text', value: 'b' },\n]) // [{ category: 'text', value: 'a b' }]",
			"collapseText([{ category: 'text', value: ' a \\n b ' }])[0]\n// [{ category: 'text', value: ' a b ' }]",
			// Every line carrying a non-ASCII literal is written as a code-point escape, here and
			// in the transcription it guards, because a retyped character would compare against
			// itself and pass while documenting a different one: U+03A9 and U+2126 render
			// identically.
			"const [normalized, offsets] = normalizeSource('A\\r\\n\u{1d54f}')",
			"normalized // 'A\\n\u{1d54f}'",
			"lowercaseASCII('HTML-\u{3a9}') // 'html-\u{3a9}' - Unicode is preserved",
			'projectSpan(offsets, 2, 4) // { start: 3, end: 5 }',
			'projectSpan([0, 1], 1, 2) // undefined - boundary 2 is uncovered',
			"parseStartTag('<html lang=\"en\" data-bs-theme=\"light\">', 0)\n// { name: 'html', attributes: [{ name: 'lang', value: 'en' }, { name: 'data-bs-theme', value: 'light' }], slashed: false, next: 38 }",
			"parseStartTag('<html data-note=\"unterminated>', 0) // undefined",
			"scanTag('<IMG SRC=\"x.png\" alt=hi />', 0)\n// { name: 'img', attributes: [{ name: 'src', value: 'x.png' }, { name: 'alt', value: 'hi' }], closing: false, next: 26 }",
			"scanAttributes(' HREF=\"/a\" disabled href=\"/b\"')\n// [{ name: 'href', value: '/a' }, { name: 'disabled' }] - lowercased, first wins, valueless stays valueless",
			"scanComment('<![CDATA[x]]>', 0) // { node: { category: 'comment', value: '[CDATA[x]]' }, next: 13 }",
			"scanDoctype('<!DOCTYPE html>', 0) // { node: { category: 'doctype', name: 'html' }, next: 15 }",
			"scanRawText('a < b</SCRIPT>tail', 0, 'script')\n// { node: { category: 'text', value: 'a < b' }, span: { start: 0, end: 5 }, next: 14, closed: true }",
			"decodeEntities('a &amp; b &#169; c &bogus;') // 'a & b \u{a9} c &bogus;'",
			'isHTMLCodePoint(0x1f600) // true',
			'isHTMLCodePoint(0xd800) // false - surrogate',
			"encodeText('a & b < c') // 'a &amp; b &lt; c'",
			"encodeAttribute('a \"b\" & c') // 'a &quot;b&quot; &amp; c'",
			"collapseSpace('  a \\n\\t b  ') // 'a b'",
			"sanitizeURL('java&#115;cript:alert(1)', SAFE_URL_SCHEMES) // '' - decoded first, then refused",
			"sanitizeURL('/docs/page', SAFE_URL_SCHEMES) // '/docs/page' - relative is always allowed",
			"resolveURL('../a', 'https://x.dev/docs/page') // 'https://x.dev/a'",
			'const anchor = parseDocument(\'<a href="javascript:alert(1)" title="Home" onclick="x()">t</a>\')',
			"attributeOf(anchor, 'TITLE') // 'Home' - case-insensitive; '' would mean present-but-valueless",
			"sanitizeAttributes(anchor, SAFE_ATTRIBUTES, SAFE_URL_SCHEMES) // [{ name: 'title', value: 'Home' }]",
			"resolveAttributes(anchor, 'https://x.dev/docs/') // href resolved, other names lowercased",
			"isVoidElement('BR') // true - case-insensitive, derived from the name, never stored",
			"isRawElement('script') // true",
			"isLiteralElement('title') // true",
			"isBlockElement('p') // true",
			"isSafeURL('/a') // true - relative",
			"isSafeURL('javascript:x') // false - refused whatever the scheme set says",
			"isSafeURL('ftp://x.dev', new Set(['ftp'])) // true - a caller may widen the safe schemes",
			'const image = parseDocument(\'<img src="a.png" alt="A">\').children[0]',
			'isEmptyElement(image) // true',
			"const page = createHTML('<P CLASS=a>x<BR/></P>')",
			'renderHTML(page.document) // \'<p class="a">x<br></p>\' - canonical, not byte-identical to the input',
			'parseDocument(renderHTML(page.document)) // deep-equals page.document',
			'renderHTML(parseDocument(renderHTML(page.document))) === renderHTML(page.document) // true',
			'const clean = page.sanitize().document',
			'renderHTML(createHTML(clean).sanitize().document) === renderHTML(clean) // true',
			'renderHTML(createHTML(renderHTML(clean)).sanitize().document) === renderHTML(clean) // true',
		]
		expect(claims.filter((claim) => !guideText.includes(claim))).toEqual([])
	})

	it('carries every README fence line whose input or documented value the transcription reuses', () => {
		const claims = [
			'\'<nav>Menu</nav><main><h1>Title</h1><p>Read the <a href="/b">guide</a>.</p></main>\',',
			"const article = page.distill({ base: 'https://x.dev/docs/page' })",
			'renderHTML(article.document) // \'<h1>Title</h1><p>Read the <a href="https://x.dev/b">guide</a>.</p>\'',
			"renderText(article.document) // 'Title\\nRead the guide.'",
			"parseStartTag('<html lang=\"en\" data-note=\"a>b\">', 0)\n// { name: 'html', attributes: [{ name: 'lang', value: 'en' }, { name: 'data-note', value: 'a>b' }], slashed: false, next: 32 }",
			"parseStartTag('<html data-note=\"unterminated>', 0) // undefined",
		]
		expect(claims.filter((claim) => !readmeText.includes(claim))).toEqual([])
	})
})
