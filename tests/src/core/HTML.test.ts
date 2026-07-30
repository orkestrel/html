import type {
	DistillOptions,
	ElementNode,
	HTMLDocument,
	HTMLHandlers,
	HTMLNode,
	SanitizeOptions,
	TextNode,
} from '@src/core'
import {
	BOILERPLATE_ELEMENTS,
	CONTENT_ELEMENTS,
	HTML,
	MAX_DEPTH,
	SAFE_ATTRIBUTES,
	SAFE_ELEMENTS,
	SAFE_URL_SCHEMES,
	UNSAFE_ELEMENTS,
	URL_ATTRIBUTES,
	isEmptyElement,
	isElementNode,
	isHTMLDocument,
	isTextNode,
	parseDocument,
	renderHTML,
	renderMarkdown,
} from '@src/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	buildDeepHTMLDocument,
	buildEncodedHTMLSchemeCorpus,
	buildHTMLEntityURLCorpus,
	buildHTMLPageInput,
	buildHTMLRoundtripCorpus,
	buildHTMLSanitizerCorpus,
	buildHostileHTMLAllowlists,
	buildShadowedHTMLAllowlist,
	collectStream,
	hasAdjacentHTMLText,
	throwHostileHTMLAccess,
} from '../../setup.js'

// The HTML CLASS - the handle around a parsed HTMLDocument: construction, the one traversal
// its queries share, the copy-on-write rewrite, the total fold, the backpressured stream, and
// the two document-shaping engines. Parser recovery and renderer output have their own
// mirrored suites (parsers.test.ts / helpers.test.ts); the parses here are vehicles.

describe('HTML - construction', () => {
	it('parses an HTML string into the document tree', () => {
		const page = new HTML('<h1>Title</h1><p>Body</p>')
		expect(page.document.category).toBe('document')
		expect(
			page.document.children.map((node) => (node.category === 'element' ? node.name : '')),
		).toEqual(['h1', 'p'])
	})

	it('adopts an existing document by reference', () => {
		const document: HTMLDocument = { category: 'document', children: [] }
		expect(new HTML(document).document).toBe(document)
	})

	it('produces an empty root for an empty string', () => {
		expect(new HTML('').document).toEqual({ category: 'document', children: [] })
	})

	it('recovers from malformed markup without throwing', () => {
		expect(() => new HTML('<p>a<<b</p></unknown>')).not.toThrow()
	})
})

describe('HTML - document', () => {
	it('returns the stored root, stable across repeated access', () => {
		const page = new HTML('<p>Body</p>')
		expect(page.document).toBe(page.document)
		expect(isHTMLDocument(page.document)).toBe(true)
	})
})

describe('HTML - walk', () => {
	it('yields the root first, then depth-first pre-order', () => {
		const page = new HTML('<div><p>x<strong>y</strong></p><br></div>')
		expect(
			[...page.walk()].map((node) => (node.category === 'element' ? node.name : node.category)),
		).toEqual(['document', 'div', 'p', 'text', 'strong', 'text', 'br'])
	})

	it('yields the stored root instance itself', () => {
		const page = new HTML('<p>x</p>')
		expect([...page.walk()][0]).toBe(page.document)
	})

	it('is lazy - one pull does not force the rest', () => {
		const page = new HTML('<p>x</p><p>y</p>')
		const iterator = page.walk()
		const first = iterator.next()
		expect(first.done).toBe(false)
		expect(first.value).toBe(page.document)
	})

	it('terminates cleanly on an early break', () => {
		const page = new HTML('<div><p>x</p></div>')
		const seen: string[] = []
		expect(() => {
			for (const node of page.walk()) {
				seen.push(node.category)
				if (node.category === 'element') break
			}
		}).not.toThrow()
		expect(seen).toEqual(['document', 'element'])
	})

	it('is consumable by for await, yielding the same sequence', async () => {
		const page = new HTML('<div><p>x</p></div>')
		const collected: HTMLNode[] = []
		for await (const node of page.walk()) collected.push(node)
		expect(collected).toEqual([...page.walk()])
	})
})

describe('HTML - find', () => {
	it('narrows through the type-guard overload', () => {
		const page = new HTML('<div><p>x</p></div>')
		const element = page.find(isElementNode)
		if (element === undefined) throw new Error('expected an element')
		expect(element.name).toBe('div')
		expectTypeOf(page.find(isElementNode)).toEqualTypeOf<ElementNode | undefined>()
	})

	it('accepts the boolean-predicate overload', () => {
		const page = new HTML('<div><p>x</p></div>')
		const found = page.find((node) => node.category === 'element' && node.name === 'p')
		expect(found?.category).toBe('element')
		expectTypeOf(page.find(() => true)).toEqualTypeOf<HTMLNode | undefined>()
	})

	it('returns the FIRST match in depth-first pre-order', () => {
		const page = new HTML('<div><span>nested</span></div><span>later</span>')
		const span = page.find((node) => node.category === 'element' && node.name === 'span')
		if (span?.category !== 'element') throw new Error('expected a span')
		expect(span.children[0]).toEqual({ category: 'text', value: 'nested' })
	})

	it('returns undefined when nothing matches, and can find the root itself', () => {
		const page = new HTML('plain text')
		expect(page.find(isElementNode)).toBeUndefined()
		expect(page.find(isHTMLDocument)).toBe(page.document)
	})
})

describe('HTML - filter', () => {
	it('collects every narrowed match in walk order', () => {
		const page = new HTML('<p>one</p><p>two</p>')
		expect(page.filter(isTextNode).map((node) => node.value)).toEqual(['one', 'two'])
		expectTypeOf(page.filter(isTextNode)).toEqualTypeOf<readonly TextNode[]>()
	})

	it('accepts the boolean-predicate overload and returns a fresh array per call', () => {
		const page = new HTML('<p>one</p>')
		expect(page.filter((node) => node.category === 'element')).toHaveLength(1)
		expect(page.filter(isTextNode)).not.toBe(page.filter(isTextNode))
		expectTypeOf(page.filter(() => true)).toEqualTypeOf<readonly HTMLNode[]>()
	})

	it('returns an empty array when nothing matches', () => {
		expect(new HTML('plain text').filter(isElementNode)).toEqual([])
	})
})

describe('HTML - map', () => {
	it('returns a NEW instance and leaves the original document untouched', () => {
		const page = new HTML('<p>lower</p>')
		const shouted = page.map((node) =>
			isTextNode(node) ? { category: 'text', value: node.value.toUpperCase() } : node,
		)
		expect(shouted).not.toBe(page)
		expect(page.filter(isTextNode)[0]?.value).toBe('lower')
		expect(shouted.filter(isTextNode)[0]?.value).toBe('LOWER')
	})

	it('shares the whole tree for an identity rewrite', () => {
		const page = new HTML('<div><p>x</p></div>')
		const rewritten = page.map((node) => node)
		expect(rewritten.document).toBe(page.document)
	})

	it('rewrites bottom-up - a parent sees its children already rewritten', () => {
		const page = new HTML('<p>x</p>')
		const seen: string[] = []
		page.map((node) => {
			if (node.category === 'element') {
				const child = node.children[0]
				if (child?.category === 'text') seen.push(child.value)
			}
			return node
		})
		expect(seen).toEqual(['x'])
	})

	it('chains - each rewrite applies in turn', () => {
		const page = new HTML('<p>hi</p>')
		const chained = page
			.map((node) =>
				isTextNode(node) ? { category: 'text', value: node.value.toUpperCase() } : node,
			)
			.map((node) => (isTextNode(node) ? { category: 'text', value: `${node.value}!` } : node))
		expect(chained.filter(isTextNode)[0]?.value).toBe('HI!')
	})
})

describe('HTML - reduce', () => {
	it('accumulates in depth-first pre-order', () => {
		const page = new HTML('<p>x</p>')
		expect(
			page.reduce<string[]>((categories, node) => {
				categories.push(node.category)
				return categories
			}, []),
		).toEqual(['document', 'element', 'text'])
	})

	it('counts exactly the nodes walk yields', () => {
		const page = new HTML('<div><p>x<em>y</em></p><!--c--></div>')
		expect(page.reduce((count) => count + 1, 0)).toBe([...page.walk()].length)
	})
})

describe('HTML - fold', () => {
	const counted: HTMLHandlers<number> = {
		document: (_node, children) => 1 + children.reduce((total, count) => total + count, 0),
		element: (_node, children) => 1 + children.reduce((total, count) => total + count, 0),
		text: () => 1,
		comment: () => 1,
		doctype: () => 1,
	}

	it('is total over all five categories and agrees with reduce', () => {
		const page = new HTML('<!DOCTYPE html><p>x</p><!--note-->')
		const categories = new Set(page.reduce<string[]>((seen, node) => [...seen, node.category], []))
		expect([...categories].sort()).toEqual(['comment', 'doctype', 'document', 'element', 'text'])
		expect(page.fold(counted)).toBe(page.reduce((count) => count + 1, 0))
	})

	it('folds children before their parent, so a table can rebuild a rendering', () => {
		const page = new HTML('<h1>Hi <em>there</em></h1>')
		const rendered: HTMLHandlers<string> = {
			document: (_node, children) => children.join(''),
			element: (node, children) => `<${node.name}>${children.join('')}</${node.name}>`,
			text: (node) => node.value,
			comment: () => '',
			doctype: () => '',
		}
		expect(page.fold(rendered)).toBe('<h1>Hi <em>there</em></h1>')
	})

	it('hands the innermost handler an empty child list at the depth cap', () => {
		const page = new HTML(buildDeepHTMLDocument(MAX_DEPTH + 20))
		const empties: boolean[] = []
		expect(() =>
			page.fold<number>({
				document: (_node, children) => children.length,
				element: (_node, children) => {
					empties.push(children.length === 0)
					return children.length
				},
				text: () => 1,
				comment: () => 0,
				doctype: () => 0,
			}),
		).not.toThrow()
		expect(empties).toContain(true)
	})

	it('contains rewrite failures but propagates query, reduce, and fold callback failures', () => {
		const page = new HTML('<p>x</p>')
		const handlers: HTMLHandlers<never> = {
			document: throwHostileHTMLAccess,
			element: throwHostileHTMLAccess,
			text: throwHostileHTMLAccess,
			comment: throwHostileHTMLAccess,
			doctype: throwHostileHTMLAccess,
		}
		expect(page.map(throwHostileHTMLAccess).document).toBe(page.document)
		expect(() => page.find(throwHostileHTMLAccess)).toThrow('hostile option access')
		expect(() => page.filter(throwHostileHTMLAccess)).toThrow('hostile option access')
		expect(() => page.reduce(throwHostileHTMLAccess, 0)).toThrow('hostile option access')
		expect(() => page.fold(handlers)).toThrow('hostile option access')
	})
})

describe('HTML - stream', () => {
	it('returns a web-standard ReadableStream over the root children', async () => {
		const page = new HTML('<h1>a</h1><p>b</p><hr>')
		expect(page.stream()).toBeInstanceOf(ReadableStream)
		expect(await collectStream(page.stream())).toEqual(page.document.children)
	})

	it('reports done after the last node, with no extra value', async () => {
		const reader = new HTML('<p>a</p>').stream().getReader()
		await reader.read()
		expect(await reader.read()).toEqual({ done: true, value: undefined })
	})

	it('is pull-based - one read yields exactly one node and leaves the rest undemanded', async () => {
		const page = new HTML('<h1>a</h1><h2>b</h2><h3>c</h3>')
		const reader = page.stream().getReader()
		const first = await reader.read()
		expect(first.done).toBe(false)
		expect(first.value).toBe(page.document.children[0])
		await reader.cancel()
		expect(await collectStream(page.stream())).toHaveLength(3)
	})

	it('cancels mid-stream and reports done afterwards', async () => {
		const reader = new HTML('<p>a</p><p>b</p>').stream().getReader()
		await reader.read()
		await expect(reader.cancel()).resolves.toBeUndefined()
		await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
	})

	it('is shallow - descendants never reach the stream', async () => {
		const page = new HTML('<div><p>deep</p></div>')
		expect(await collectStream(page.stream())).toHaveLength(1)
	})

	it('yields an empty stream for an empty document and replays independently', async () => {
		const page = new HTML('')
		expect(await collectStream(page.stream())).toEqual([])
		const other = new HTML('<p>a</p>')
		expect(await collectStream(other.stream())).toEqual(await collectStream(other.stream()))
	})

	it('pipes through a TransformStream', async () => {
		const page = new HTML('<h1>a</h1><p>b</p>')
		const names = new TransformStream<HTMLNode, string>({
			transform(node, controller) {
				controller.enqueue(node.category === 'element' ? node.name : node.category)
			},
		})
		const reader = page.stream().pipeThrough(names).getReader()
		const collected: string[] = []
		for (let result = await reader.read(); !result.done; result = await reader.read()) {
			collected.push(result.value)
		}
		expect(collected).toEqual(['h1', 'p'])
	})
})

describe('HTML - sanitize floor', () => {
	it('accepts exported arrays and caller sets for every sanitize allowlist', () => {
		expectTypeOf<SanitizeOptions['elements']>().toEqualTypeOf<
			ReadonlySet<string> | readonly string[] | undefined
		>()
		const source =
			'<p title="kept" onclick="drop()">text</p><a href="https://example.test">link</a>'
		const arrays = new HTML(source).sanitize({
			elements: SAFE_ELEMENTS,
			attributes: SAFE_ATTRIBUTES,
			schemes: SAFE_URL_SCHEMES,
		}).document
		const sets = new HTML(source).sanitize({
			elements: new Set(SAFE_ELEMENTS),
			attributes: new Set(SAFE_ATTRIBUTES),
			schemes: new Set(SAFE_URL_SCHEMES),
		}).document
		expect(arrays).toEqual(sets)
		expect(renderHTML(arrays)).toBe(
			'<p title="kept">text</p><a href="https://example.test">link</a>',
		)
	})

	it('keeps the sanitize floor beneath array and Set allowlists', () => {
		const source = '<script>drop</script><p onclick="x()">keep</p><a href="javascript:x">link</a>'
		const policies = [
			{
				elements: Object.freeze(['p', 'script']),
				attributes: Object.freeze(['onclick', 'href']),
				schemes: Object.freeze(['javascript']),
			},
			{
				elements: new Set(['p', 'script']),
				attributes: new Set(['onclick', 'href']),
				schemes: new Set(['javascript']),
			},
		]
		for (const policy of policies) {
			expect(renderHTML(new HTML(source).sanitize(policy).document)).toBe('<p>keep</p>link')
		}
	})

	it('fails closed for every hostile sanitize allowlist field and iterator shape', () => {
		const page = new HTML(
			'<script>drop</script><p onclick="x()">keep</p><a href="javascript:x">link</a>',
		)
		for (const allowlist of buildHostileHTMLAllowlists()) {
			const outputs = [
				page.sanitize({ elements: allowlist }),
				page.sanitize({ attributes: allowlist }),
				page.sanitize({ schemes: allowlist }),
			]
			for (const output of outputs) {
				expect(output.document).toEqual({ category: 'document', children: [] })
				expect(renderHTML(output.document)).toBe('')
			}
		}
	})

	it('fails closed when reading the sanitize options object or comment policy throws', () => {
		const trapped: SanitizeOptions = new Proxy({}, { get: throwHostileHTMLAccess })
		const comments: SanitizeOptions = {}
		Object.defineProperty(comments, 'comments', { get: throwHostileHTMLAccess })
		for (const options of [trapped, comments]) {
			const clean = new HTML('<script>drop</script><p onclick="x()">keep</p>').sanitize(options)
			expect(clean.document).toEqual({ category: 'document', children: [] })
			expect(renderHTML(clean.document)).toBe('')
		}
	})

	it('normalizes sanitize allowlists without consulting hostile has or size members', () => {
		const page = new HTML(
			'<script>drop</script><p onclick="x()">keep</p><a href="javascript:x">link</a>',
		)
		const allowlist = buildShadowedHTMLAllowlist()
		const outputs = [
			page.sanitize({ elements: allowlist }),
			page.sanitize({ attributes: allowlist }),
			page.sanitize({ schemes: allowlist }),
		]
		for (const output of outputs) {
			const rendered = renderHTML(output.document)
			expect(rendered).not.toContain('<script')
			expect(rendered).not.toContain('onclick')
			expect(rendered).not.toContain('javascript:')
		}
	})

	it('removes an unsafe subtree whole instead of unwrapping it', () => {
		const page = new HTML('<div>before<script>alert(1)</script><style>b{}</style>after</div>')
		expect(renderHTML(page.sanitize().document)).toBe('<div>beforeafter</div>')
	})

	it('strips every handler, styling, and namespaced attribute even when the allowlist names it', () => {
		const page = new HTML(
			'<p onclick="x()" ONMOUSEOVER="y" style="color:red" srcdoc="z" xlink:href="w" xmlns="v" title="t">a</p>',
		)
		const attributes = new Set([
			'onclick',
			'onmouseover',
			'style',
			'srcdoc',
			'xlink:href',
			'xmlns',
			'title',
		])
		expect(renderHTML(page.sanitize({ attributes }).document)).toBe('<p title="t">a</p>')
	})

	it('keeps an unsafe element unsafe even when the element allowlist names it', () => {
		const page = new HTML('<p>keep<script>alert(1)</script></p>')
		const elements = new Set(['p', 'script'])
		expect(renderHTML(page.sanitize({ elements }).document)).toBe('<p>keep</p>')
	})

	it('removes a dangerous or protocol-relative URL rather than emptying it', () => {
		const page = new HTML(
			'<a href="javascript:alert(1)">a</a><a href="//evil.test/x">b</a><a href="/safe">c</a>',
		)
		expect(renderHTML(page.sanitize().document)).toBe('<a>a</a><a>b</a><a href="/safe">c</a>')
	})

	it('refuses a hard-banned scheme even when the scheme allowlist names it', () => {
		const page = new HTML('<a href="javascript:alert(1)">a</a><a href="ftp://host/x">b</a>')
		const schemes = new Set(['javascript', 'ftp'])
		expect(renderHTML(page.sanitize({ schemes }).document)).toBe(
			'<a>a</a><a href="ftp://host/x">b</a>',
		)
	})

	it('proves each replacement allowlist cannot lower the sanitizer floor', () => {
		const page = new HTML(
			'<p title="removed" onclick="x()">keep</p><script>drop</script>' +
				'<a href="javascript:x">link</a>',
		)
		expect(renderHTML(page.sanitize({ attributes: new Set(['onclick']) }).document)).toBe(
			'<p>keep</p><a>link</a>',
		)
		expect(renderHTML(page.sanitize({ elements: new Set(['script']) }).document)).toBe('keeplink')
		expect(renderHTML(page.sanitize({ schemes: new Set(['javascript']) }).document)).toBe(
			'<p title="removed">keep</p><a>link</a>',
		)
	})

	it('keeps the sanitizer floor after consumers attempt to mutate exported policy collections', () => {
		const deleteUnsafe = Reflect.get(UNSAFE_ELEMENTS, 'delete')
		const deleteURL = Reflect.get(URL_ATTRIBUTES, 'delete')
		const addElement = Reflect.get(SAFE_ELEMENTS, 'add')
		const addScheme = Reflect.get(SAFE_URL_SCHEMES, 'add')
		try {
			if (typeof deleteUnsafe === 'function') {
				Reflect.apply(deleteUnsafe, UNSAFE_ELEMENTS, ['script'])
			} else {
				const index = Reflect.apply(Array.prototype.indexOf, UNSAFE_ELEMENTS, ['script'])
				if (typeof index === 'number' && index >= 0) {
					Reflect.deleteProperty(UNSAFE_ELEMENTS, String(index))
				}
			}
			if (typeof deleteURL === 'function') {
				Reflect.apply(deleteURL, URL_ATTRIBUTES, ['href'])
			} else {
				const index = Reflect.apply(Array.prototype.indexOf, URL_ATTRIBUTES, ['href'])
				if (typeof index === 'number' && index >= 0) {
					Reflect.deleteProperty(URL_ATTRIBUTES, String(index))
				}
			}
			if (typeof addElement === 'function') Reflect.apply(addElement, SAFE_ELEMENTS, ['script'])
			if (typeof addScheme === 'function') {
				Reflect.apply(addScheme, SAFE_URL_SCHEMES, ['javascript'])
			}
			const page = new HTML(
				'<script>alert(1)</script><p onclick="run()">text</p>' +
					'<a href="javascript:alert(2)">link</a>',
			)
			expect(Object.isFrozen(UNSAFE_ELEMENTS)).toBe(true)
			expect(Object.isFrozen(URL_ATTRIBUTES)).toBe(true)
			expect(renderHTML(page.sanitize().document)).toBe('<p>text</p><a>link</a>')
		} finally {
			const addUnsafe = Reflect.get(UNSAFE_ELEMENTS, 'add')
			const addURL = Reflect.get(URL_ATTRIBUTES, 'add')
			const deleteElement = Reflect.get(SAFE_ELEMENTS, 'delete')
			const deleteScheme = Reflect.get(SAFE_URL_SCHEMES, 'delete')
			if (typeof addUnsafe === 'function') Reflect.apply(addUnsafe, UNSAFE_ELEMENTS, ['script'])
			if (typeof addURL === 'function') Reflect.apply(addURL, URL_ATTRIBUTES, ['href'])
			if (typeof deleteElement === 'function') {
				Reflect.apply(deleteElement, SAFE_ELEMENTS, ['script'])
			}
			if (typeof deleteScheme === 'function') {
				Reflect.apply(deleteScheme, SAFE_URL_SCHEMES, ['javascript'])
			}
		}
	})

	it('unwraps a safe element outside the allowlist and keeps its content', () => {
		const page = new HTML('<my-widget><p>kept</p></my-widget>')
		expect(renderHTML(page.sanitize().document)).toBe('<p>kept</p>')
		expect(renderHTML(page.sanitize({ elements: new Set(['div']) }).document)).toBe('kept')
	})

	it('rejoins the text that unwrapping splices together', () => {
		const clean = new HTML('<my-widget>a</my-widget>b').sanitize()
		expect(clean.document.children).toEqual([{ category: 'text', value: 'ab' }])
		expect(hasAdjacentHTMLText(clean.document)).toBe(false)
	})

	it('drops comments by default and keeps them on request', () => {
		const page = new HTML('<p>a<!--note--></p>')
		expect(renderHTML(page.sanitize().document)).toBe('<p>a</p>')
		expect(renderHTML(page.sanitize({ comments: true }).document)).toBe('<p>a<!--note--></p>')
	})

	it('neutralizes every retained-comment close variant and preserves the sanitize reparse law', () => {
		const sources = [
			'<!--x--!><script>alert(1)</script>-->',
			'<!--><script>alert(1)</script>-->',
			'<!---><script>alert(1)</script>-->',
		]
		for (const source of sources) {
			const clean = new HTML(source).sanitize({ comments: true }).document
			const rendered = renderHTML(clean)
			expect(rendered).not.toContain('--!>')
			expect(rendered).not.toContain('<!-->')
			expect(rendered).not.toContain('<!--->')
			const reparsed = parseDocument(rendered)
			expect(
				reparsed.children.some(
					(node) => node.category === 'element' && node.name.toLowerCase() === 'script',
				),
			).toBe(false)
			expect(reparsed).toEqual(clean)
			expect(new HTML(reparsed).sanitize({ comments: true }).document).toEqual(clean)
		}
	})

	it('drops hand-built close-sequence comments through sanitize and preserves law three', () => {
		const values = ['x--><script>alert(1)</script>', 'x--!><img src=x onerror=alert(1)>']
		for (const value of values) {
			const document: HTMLDocument = {
				category: 'document',
				children: [{ category: 'comment', value }],
			}
			const clean = new HTML(document).sanitize({ comments: true }).document
			const rendered = renderHTML(clean)
			const reparsed = parseDocument(rendered)
			expect(reparsed.children.some((node) => node.category === 'element')).toBe(false)
			expect(new HTML(reparsed).sanitize({ comments: true }).document).toEqual(clean)
		}
	})

	it('keeps a doctype, which carries structure rather than risk', () => {
		const page = new HTML('<!DOCTYPE html><p>a</p>')
		expect(renderHTML(page.sanitize().document)).toBe('<!DOCTYPE html><p>a</p>')
	})

	it('canonicalizes unsafe doctype identifiers without serializing a live element', () => {
		const document: HTMLDocument = {
			category: 'document',
			children: [
				{
					category: 'doctype',
					name: 'html',
					public: '"\'><script>alert(1)</script><x "',
				},
			],
		}
		expect(renderHTML(document)).not.toContain('<script>')
		const clean = new HTML(document).sanitize().document
		const rendered = renderHTML(clean)
		expect(rendered).not.toContain('<script>')
		expect(new HTML(parseDocument(rendered)).sanitize().document).toEqual(clean)
	})

	it('fails closed when a hostile children read interrupts sanitizing', () => {
		const script: ElementNode = {
			category: 'element',
			name: 'script',
			attributes: [],
			children: [{ category: 'text', value: 'alert(1)' }],
		}
		const document: HTMLDocument = { category: 'document', children: [script] }
		let reads = 0
		Object.defineProperty(document, 'children', {
			get() {
				reads += 1
				if (reads === 1) throw new Error('hostile children')
				return [script]
			},
		})
		const clean = new HTML(document).sanitize().document
		expect(renderHTML(clean)).toBe('')
		expect(JSON.stringify(clean)).not.toContain('script')
	})

	it('strips hidden and aria-hidden, the evidence distill therefore reads before sanitizing', () => {
		const page = new HTML('<p hidden aria-hidden="true">a</p>')
		expect(renderHTML(page.sanitize().document)).toBe('<p>a</p>')
	})

	it('keeps an image description and loses its download', () => {
		const page = new HTML('<img alt="a portrait" src="/photo.png" width="4">')
		expect(renderHTML(page.sanitize().document)).toBe('<img alt="a portrait" width="4">')
	})
})

describe('HTML - sanitize laws', () => {
	it('returns a NEW instance and never mutates the original', () => {
		const page = new HTML('<p onclick="x()">a</p>')
		const before = renderHTML(page.document)
		const clean = page.sanitize()
		expect(clean).not.toBe(page)
		expect(clean.document).not.toBe(page.document)
		expect(renderHTML(page.document)).toBe(before)
	})

	it('is a fixpoint, directly and through a reparse of its own output', () => {
		for (const document of buildHTMLRoundtripCorpus()) {
			const once = new HTML(document).sanitize().document
			expect(new HTML(once).sanitize().document).toEqual(once)
			expect(new HTML(parseDocument(renderHTML(once))).sanitize().document).toEqual(once)
		}
	})

	it('leaves an already-safe document identical', () => {
		const page = new HTML('<main><h1>Title</h1><p>Body <a href="/x">link</a></p></main>')
		expect(page.sanitize().document).toEqual(page.document)
	})

	it('stays total over a hostile deep and a cyclic adopted AST', () => {
		const deep = new HTML(buildDeepHTMLDocument(MAX_DEPTH + 200))
		expect(() => deep.sanitize()).not.toThrow()
		const children: HTMLNode[] = []
		const element: ElementNode = { category: 'element', name: 'div', attributes: [], children }
		children.push(element)
		const cyclic = new HTML({ category: 'document', children: [element] })
		expect(() => cyclic.sanitize()).not.toThrow()
	})

	it('rejects a doubly encoded scheme in a hand-built AST', () => {
		const document: HTMLDocument = {
			category: 'document',
			children: [
				{
					category: 'element',
					name: 'a',
					attributes: [{ name: 'href', value: '&amp;#106;avascript:x' }],
					children: [{ category: 'text', value: 'link' }],
				},
			],
		}
		const clean = new HTML(document).sanitize().document
		expect(renderHTML(clean)).toBe('<a>link</a>')
		expect(new HTML(parseDocument(renderHTML(clean))).sanitize().document).toEqual(clean)
	})

	it('records named-entity URL strengthening in both the AST and rendered output', () => {
		for (const threat of buildHTMLEntityURLCorpus()) {
			const clean = new HTML(`<a href="${threat.source}">link</a>`).sanitize().document
			const attributes = threat.value === undefined ? [] : [{ name: 'href', value: threat.value }]
			const expected: HTMLDocument = {
				category: 'document',
				children: [
					{
						category: 'element',
						name: 'a',
						attributes,
						children: [{ category: 'text', value: 'link' }],
					},
				],
			}
			const html = threat.value === undefined ? '<a>link</a>' : `<a href="${threat.value}">link</a>`
			expect({ name: threat.name, document: clean }).toEqual({
				name: threat.name,
				document: expected,
			})
			expect({ name: threat.name, html: renderHTML(clean) }).toEqual({
				name: threat.name,
				html,
			})
		}
	})

	it('preserves the sanitize reparse fixpoint across encoded-scheme families', () => {
		for (const value of buildEncodedHTMLSchemeCorpus()) {
			const document: HTMLDocument = {
				category: 'document',
				children: [
					{
						category: 'element',
						name: 'a',
						attributes: [{ name: 'href', value }],
						children: [{ category: 'text', value: 'link' }],
					},
				],
			}
			const clean = new HTML(document).sanitize().document
			expect(JSON.stringify(clean)).not.toContain('"name":"href"')
			expect(new HTML(parseDocument(renderHTML(clean))).sanitize().document).toEqual(clean)
		}
	})
})

describe('HTML - adversarial sanitizer corpus', () => {
	it('removes every dangerous construct from both the AST and rendered HTML', () => {
		for (const threat of buildHTMLSanitizerCorpus()) {
			const clean = new HTML(threat.source).sanitize().document
			const ast = JSON.stringify(clean).toLowerCase()
			const html = renderHTML(clean).toLowerCase()
			for (const token of threat.ast) {
				expect({
					group: threat.group,
					name: threat.name,
					token,
					present: ast.includes(token),
				}).toEqual({ group: threat.group, name: threat.name, token, present: false })
			}
			for (const token of threat.html) {
				expect({
					group: threat.group,
					name: threat.name,
					token,
					present: html.includes(token),
				}).toEqual({ group: threat.group, name: threat.name, token, present: false })
			}
		}
	})

	it('keeps the full corpus at the sanitize and serialize-reparse fixpoints', () => {
		for (const threat of buildHTMLSanitizerCorpus()) {
			const once = new HTML(threat.source).sanitize().document
			expect({ name: threat.name, document: new HTML(once).sanitize().document }).toEqual({
				name: threat.name,
				document: once,
			})
			expect({
				name: threat.name,
				document: new HTML(parseDocument(renderHTML(once))).sanitize().document,
			}).toEqual({ name: threat.name, document: once })
		}
	})

	it('neutralizes markdown-shaped javascript through the distilled projection path', () => {
		const distilled = new HTML(
			'<p>[x](javascript:alert(1)) <a href="javascript:alert(2)">linked</a></p>',
		).distill()
		const markdown = renderMarkdown(distilled.document)
		expect(markdown).toContain('\\[x\\](javascript:alert(1))')
		expect(markdown).not.toContain('[x](javascript:')
		expect(markdown).not.toContain('[linked](javascript:')
	})
})

describe('HTML - distill', () => {
	it('accepts exported arrays and caller sets for both distill allowlists', () => {
		expectTypeOf<DistillOptions['elements']>().toEqualTypeOf<
			ReadonlySet<string> | readonly string[] | undefined
		>()
		expectTypeOf<DistillOptions['boilerplate']>().toEqualTypeOf<
			ReadonlySet<string> | readonly string[] | undefined
		>()
		const source = '<nav>skip</nav><main><h1>Title</h1><p>Body</p></main>'
		const arrays = new HTML(source).distill({
			elements: CONTENT_ELEMENTS,
			boilerplate: BOILERPLATE_ELEMENTS,
		}).document
		const sets = new HTML(source).distill({
			elements: new Set(CONTENT_ELEMENTS),
			boilerplate: new Set(BOILERPLATE_ELEMENTS),
		}).document
		expect(arrays).toEqual(sets)
		expect(renderHTML(arrays)).toBe('<h1>Title</h1><p>Body</p>')
	})

	it('fails closed for every hostile distill allowlist field and iterator shape', () => {
		const page = new HTML(
			'<nav>noise</nav><main><script>drop</script><p onclick="x()">keep</p></main>',
		)
		for (const allowlist of buildHostileHTMLAllowlists()) {
			const outputs = [
				page.distill({ elements: allowlist }),
				page.distill({ boilerplate: allowlist }),
			]
			for (const output of outputs) {
				expect(output.document).toEqual({ category: 'document', children: [] })
				expect(renderHTML(output.document)).toBe('')
			}
		}
	})

	it('fails closed when reading the distill options object or base policy throws', () => {
		const trapped: DistillOptions = new Proxy({}, { get: throwHostileHTMLAccess })
		const base: DistillOptions = {}
		Object.defineProperty(base, 'base', { get: throwHostileHTMLAccess })
		for (const options of [trapped, base]) {
			const distilled = new HTML('<main><script>drop</script><p>keep</p></main>').distill(options)
			expect(distilled.document).toEqual({ category: 'document', children: [] })
			expect(renderHTML(distilled.document)).toBe('')
		}
	})

	it('normalizes distill allowlists without consulting hostile has or size members', () => {
		const page = new HTML(
			'<nav>noise</nav><main><script>drop</script><p onclick="x()">keep</p></main>',
		)
		const allowlist = buildShadowedHTMLAllowlist()
		const outputs = [
			page.distill({ elements: allowlist }),
			page.distill({ boilerplate: allowlist }),
		]
		for (const output of outputs) {
			const rendered = renderHTML(output.document)
			expect(rendered).not.toContain('<script')
			expect(rendered).not.toContain('onclick')
		}
	})

	it('reduces a whole page to its article content', () => {
		const page = new HTML(buildHTMLPageInput())
		expect(renderHTML(page.distill().document)).toBe(
			'<h1> Title here </h1><p>Body <b>bold</b> <a href="page">link</a></p>' +
				'<pre><code class="language-ts">const x  =  1</code></pre>',
		)
	})

	it('projects that content to prompt-ready markdown', () => {
		const page = new HTML(buildHTMLPageInput())
		expect(renderMarkdown(page.distill().document)).toBe(
			'# Title here\n\nBody **bold** [link](page)\n\n```ts\nconst x  =  1\n```',
		)
	})

	it('resolves relative URLs against a base', () => {
		const page = new HTML(buildHTMLPageInput())
		const distilled = page.distill({ base: 'https://example.test/docs/index.html' })
		expect(renderHTML(distilled.document)).toContain('href="https://example.test/docs/page"')
	})

	it('drops a boilerplate region whole, with the content inside it', () => {
		const page = new HTML('<nav><p>menu</p></nav><p>body</p>')
		expect(renderHTML(page.distill().document)).toBe('<p>body</p>')
	})

	it('drops the regions the boilerplate option names instead of the defaults', () => {
		const page = new HTML('<section><p>chrome</p></section><nav><p>menu</p></nav>')
		const boilerplate = new Set(['section'])
		expect(renderHTML(page.distill({ boilerplate }).document)).toBe('<p>menu</p>')
		expect(renderHTML(page.distill().document)).toBe('<p>chrome</p>')
	})

	it('drops an author-hidden element even though sanitizing would erase the evidence', () => {
		const page = new HTML('<p hidden>gone</p><p aria-hidden="TRUE">gone</p><p>kept</p>')
		expect(renderHTML(page.distill().document)).toBe('<p>kept</p>')
	})

	it('re-roots at the single main, then at the single article', () => {
		const main = new HTML('<p>outside</p><main><p>inside</p></main>')
		expect(renderHTML(main.distill().document)).toBe('<p>inside</p>')
		const article = new HTML('<p>outside</p><div><article><p>inside</p></article></div>')
		expect(renderHTML(article.distill().document)).toBe('<p>inside</p>')
	})

	it('keeps the whole document when the region is absent or ambiguous', () => {
		const page = new HTML('<main><p>one</p></main><main><p>two</p></main>')
		expect(renderHTML(page.distill().document)).toBe('<p>one</p><p>two</p>')
	})

	it('unwraps everything outside the content set and honors a narrower set', () => {
		const page = new HTML('<main><p>a</p><ul><li>b</li></ul></main>')
		expect(renderHTML(page.distill().document)).toBe('<p>a</p><ul><li>b</li></ul>')
		expect(renderHTML(page.distill({ elements: new Set(['p']) }).document)).toBe('<p>a</p>b')
	})

	it('collapses an attribute-free element wrapping only its own kind', () => {
		const page = new HTML('<main><strong><strong>x</strong></strong></main>')
		expect(renderHTML(page.distill().document)).toBe('<strong>x</strong>')
	})

	it('does not broaden wrapper collapse beyond attribute-free same-name single children', () => {
		const page = new HTML(
			'<main><strong class="outer"><strong>x</strong></strong>' +
				'<strong><em>y</em></strong></main>',
		)
		expect(renderHTML(page.distill().document)).toBe(
			'<strong class="outer"><strong>x</strong></strong><strong><em>y</em></strong>',
		)
	})

	it('collapses whitespace outside pre and code and preserves it inside', () => {
		const page = new HTML('<main><p>a   b</p><pre><code>a   b</code></pre></main>')
		expect(renderHTML(page.distill().document)).toBe('<p>a b</p><pre><code>a   b</code></pre>')
	})

	it('drops an empty non-void element and keeps a void one', () => {
		const page = new HTML('<main><p></p><p>x</p><br><img alt="a"></main>')
		const empty = page.find(
			(node): node is ElementNode =>
				node.category === 'element' && node.name === 'p' && node.children.length === 0,
		)
		if (empty === undefined) throw new Error('expected empty paragraph')
		expect(isEmptyElement(empty)).toBe(true)
		expect(renderHTML(page.distill().document)).toBe('<p>x</p><br><img alt="a">')
	})

	it('sanitizes before extracting, so no unsafe content survives the pass', () => {
		const page = new HTML('<main><p onclick="x()">a<script>bad</script></p></main>')
		expect(renderHTML(page.distill().document)).toBe('<p>a</p>')
	})

	it('prunes regions before sanitizing and extracting the sole surviving content region', () => {
		const page = new HTML(
			'<nav><main><p>noise</p></main></nav>' +
				'<main hidden><p>hidden</p></main><article><p>kept</p></article>',
		)
		expect(renderHTML(page.distill().document)).toBe('<p>kept</p>')
	})

	it('is idempotent on its own output', () => {
		const page = new HTML(buildHTMLPageInput())
		const options = { base: 'https://example.test/docs/index.html' }
		const once = page.distill(options).document
		expect(new HTML(once).distill(options).document).toEqual(once)
	})

	it('drops a doctype, which is structure rather than content', () => {
		expect(renderHTML(new HTML('<!DOCTYPE html><p>a</p>').distill().document)).toBe('<p>a</p>')
	})

	it('returns a NEW instance, never mutating the original', () => {
		const page = new HTML(buildHTMLPageInput())
		const before = renderHTML(page.document)
		const distilled = page.distill()
		expect(distilled).not.toBe(page)
		expect(renderHTML(page.document)).toBe(before)
		expect(isHTMLDocument(distilled.document)).toBe(true)
	})

	it('stays total over a hostile deep AST', () => {
		expect(() => new HTML(buildDeepHTMLDocument(MAX_DEPTH + 200)).distill()).not.toThrow()
	})
})
