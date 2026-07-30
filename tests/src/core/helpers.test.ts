import type { ElementNode, HTMLDocument, HTMLHandlers, HTMLNode } from '@src/core'
import {
	MAX_DEPTH,
	NAMED_ENTITIES,
	SAFE_ATTRIBUTES,
	SAFE_URL_SCHEMES,
	attributeOf,
	collapseSpace,
	collapseText,
	encodeAttribute,
	encodeText,
	extractRegion,
	foldNode,
	isSafeURL,
	mergeText,
	parseDocument,
	pruneDocument,
	renderHTML,
	renderText,
	resolveAttributes,
	resolveURL,
	rewriteDocument,
	sanitizeAttributes,
	sanitizeURL,
	walkNodes,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	URL_SAFETY_GROUPS,
	buildDeepHTMLDocument,
	buildBranchingHTMLElement,
	buildDiamondHTMLDocument,
	buildHTMLEntityURLCorpus,
	buildHTMLRoundtripCorpus,
	buildSharedHTMLPreDocument,
	buildURLSafetyCorpus,
	createRecorder,
	hasAdjacentHTMLText,
} from '../../setup.js'

describe('HTML escaping and URL helpers', () => {
	it('encodes HTML text minimally', () => {
		expect(encodeText('&<>"\'')).toBe('&amp;&lt;&gt;"\'')
	})

	it('encodes double-quoted attribute values minimally', () => {
		expect(encodeAttribute('&"<>\'')).toBe("&amp;&quot;<>'")
	})

	it('sanitizes adversarial URL forms after entity and control decoding', () => {
		const schemes = new Set(['http', 'https', 'mailto'])
		const rejected = [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			'java\tscript:alert(1)',
			'&#106;avascript:alert(1)',
			'data:text/html,x',
			'//host/path',
			'\\\\host\\path',
			'/\\host/path',
			'\\/\u0068ost/path',
			'\0java\nscript:alert(1)',
			'file:///tmp/value',
			'vbscript:run',
		]
		for (const value of rejected) expect(sanitizeURL(value, schemes)).toBe('')
		expect(sanitizeURL('./docs/page.html', schemes)).toBe('./docs/page.html')
		expect(sanitizeURL('/root/path', schemes)).toBe('/root/path')
		expect(sanitizeURL('https://example.test/a b', schemes)).toBe('https://example.test/ab')
		expect(sanitizeURL('mailto:test@example.test', schemes)).toBe('mailto:test@example.test')
		expect(sanitizeURL('tel:+12025550123', schemes)).toBe('')
	})

	it('keeps hard-banned schemes forbidden even when callers allow them', () => {
		const schemes = new Set(['javascript', 'data', 'vbscript', 'file'])
		for (const scheme of schemes) {
			expect(sanitizeURL(`${scheme}:payload`, schemes)).toBe('')
		}
	})

	it('decodes URL entities to a bounded fixpoint and fails closed beyond the bound', () => {
		expect(sanitizeURL('&amp;#106;avascript:x', SAFE_URL_SCHEMES)).toBe('')
		expect(sanitizeURL('&amp;amp;#x6A;avascript:x', SAFE_URL_SCHEMES)).toBe('')
		expect(sanitizeURL(`&${'amp;'.repeat(10)}#106;avascript:x`, SAFE_URL_SCHEMES)).toBe('')
	})

	it('sanitizes the complete reviewed named-entity URL corpus', () => {
		for (const threat of buildHTMLEntityURLCorpus()) {
			expect({ name: threat.name, value: sanitizeURL(threat.source, SAFE_URL_SCHEMES) }).toEqual({
				name: threat.name,
				value: threat.value ?? '',
			})
		}
	})

	it('honors eight changing decode passes and fails closed before a ninth rewrite', () => {
		const bounded = `&${'amp;'.repeat(7)}colon;`
		const excessive = `&${'amp;'.repeat(8)}colon;`
		expect(sanitizeURL(bounded, SAFE_URL_SCHEMES)).toBe(':')
		expect(sanitizeURL(excessive, SAFE_URL_SCHEMES)).toBe('')
		expect(sanitizeURL(excessive, SAFE_URL_SCHEMES)).toBe('')
	})

	it('terminates without oscillation for every named entity value', () => {
		for (const name of Object.keys(NAMED_ENTITIES)) {
			const sanitized = sanitizeURL(`&${name};`, SAFE_URL_SCHEMES)
			expect({ name, repeated: sanitizeURL(sanitized, SAFE_URL_SCHEMES) }).toEqual({
				name,
				repeated: sanitized,
			})
		}
	})

	it('keeps the URL predicate and sanitizer on one C1-aware security floor', () => {
		const schemes = new Set(['ftp', 'http', 'https'])
		const values = [
			'',
			'/relative',
			'//host/path',
			'\\\\host\\path',
			'https://example.test/path',
			'ftp://example.test/path',
			'javascript:alert(1)',
			'java\u0085script:alert(1)',
			'da\u009Fta:text/html,x',
			'custom:value',
		]
		for (const value of values) {
			expect(isSafeURL(value, schemes)).toBe(sanitizeURL(value, schemes) !== '')
		}
	})

	it('resolves WHATWG URLs and preserves an unresolvable value', () => {
		expect(resolveURL('../asset.png', 'https://example.test/docs/page')).toBe(
			'https://example.test/asset.png',
		)
		expect(resolveURL('https://other.test/x', 'https://example.test/base')).toBe(
			'https://other.test/x',
		)
		expect(resolveURL('relative', 'not a base')).toBe('relative')
	})

	it('looks up attributes case-insensitively and distinguishes presence from absence', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'input',
			attributes: [{ name: 'DISABLED' }, { name: 'title', value: '' }],
			children: [],
		}
		expect(attributeOf(element, 'disabled')).toBe('')
		expect(attributeOf(element, 'TITLE')).toBe('')
		expect(attributeOf(element, 'missing')).toBeUndefined()
	})

	it('collapses inter-word whitespace and trims edges', () => {
		expect(collapseSpace(' \talpha\r\n beta  gamma\n')).toBe('alpha beta gamma')
	})
})

// The scheme and control floor `sanitizeURL` enforces, driven from `buildURLSafetyCorpus`
// so the whole floor reads as one list of vectors and dispositions (guides/src/html.md §
// The sanitize floor states the rules). The three tests after the corpus sweep are the
// rules that follow from WHERE this sanitizer sits — on the AST, upstream of the
// serializer, behind a caller-replaceable allowlist — each pinned by name rather than
// left implicit in a corpus row.
describe('sanitizeURL — URL-safety corpus', () => {
	it('disposes of every vector exactly as the corpus records', () => {
		for (const threat of buildURLSafetyCorpus()) {
			expect({ name: threat.name, value: sanitizeURL(threat.source, SAFE_URL_SCHEMES) }).toEqual({
				name: threat.name,
				value: threat.value ?? '',
			})
		}
	})

	it('covers every threat group', () => {
		const groups = [...new Set(buildURLSafetyCorpus().map((threat) => threat.group))]
		expect(groups).toEqual([...URL_SAFETY_GROUPS])
	})

	// Rule 1 — escaping position. The raw surviving value is retained and encoded later, in
	// `renderHTML`'s serializer, because sanitizing happens on the AST and serialization is
	// a separate downstream pass.
	it('keeps a surviving URL unescaped for the serializer', () => {
		const source = 'https://ok.dev/?a=1&b=2'
		expect(sanitizeURL(source, SAFE_URL_SCHEMES)).toBe(source)
		expect(encodeAttribute(sanitizeURL(source, SAFE_URL_SCHEMES))).toBe(
			'https://ok.dev/?a=1&amp;b=2',
		)
		// The quote survivor is the one that matters: it cannot break out of the attribute,
		// because the serializer — not the sanitizer — is what encodes it.
		expect(encodeAttribute(sanitizeURL('https://ok.dev/"onmouseover=x', SAFE_URL_SCHEMES))).toBe(
			'https://ok.dev/&quot;onmouseover=x',
		)
	})

	// Rule 2 — the entity-decode pass. Character references decode to a bounded fixpoint
	// before the scheme is read, because a hand-built AST can defer decoding to a later
	// serialize/reparse; a value that decodes to a dangerous scheme is refused, and one that
	// decodes to an ALLOWED scheme survives decoded.
	it('refuses an entity-encoded scheme outright', () => {
		expect(sanitizeURL('&#106;avascript:x', SAFE_URL_SCHEMES)).toBe('')
		expect(sanitizeURL('javascript&colon;x', SAFE_URL_SCHEMES)).toBe('')
		expect(sanitizeURL('&sol;&sol;evil.dev', SAFE_URL_SCHEMES)).toBe('')
		expect(sanitizeURL('https&colon;&sol;&sol;ok.dev', SAFE_URL_SCHEMES)).toBe('https://ok.dev')
	})

	// Rule 3 — allowlist shape. The allowlist comes from the caller and REPLACES the
	// default, so the four dangerous schemes need an unwidenable refusal of their own: a
	// widened allowlist still admits its safe entries and still cannot buy `javascript`.
	it('refuses a caller-widened dangerous scheme while honoring the same allowlist for safe ones', () => {
		const widened = new Set(['http', 'https', 'javascript', 'data', 'vbscript', 'file'])
		for (const scheme of ['javascript', 'data', 'vbscript', 'file']) {
			expect(sanitizeURL(`${scheme}:payload`, widened)).toBe('')
		}
		expect(sanitizeURL('https://ok.dev', widened)).toBe('https://ok.dev')
		expect([...SAFE_URL_SCHEMES].sort()).toEqual(['http', 'https', 'mailto', 'tel'])
		for (const scheme of ['javascript', 'data', 'vbscript', 'file']) {
			expect(SAFE_URL_SCHEMES.includes(scheme)).toBe(false)
		}
	})
})

describe('sanitizeAttributes', () => {
	it('keeps and normalizes only the closed table-cell alignment values', () => {
		const cases = [
			{ source: 'left', value: 'left' },
			{ source: 'right', value: 'right' },
			{ source: 'center', value: 'center' },
			{ source: ' LEFT ', value: 'left' },
			{ source: 'CeNtEr', value: 'center' },
		]
		for (const name of ['td', 'th']) {
			for (const alignment of cases) {
				const element: ElementNode = {
					category: 'element',
					name,
					attributes: [{ name: 'align', value: alignment.source }],
					children: [],
				}
				expect(sanitizeAttributes(element, ['align'], SAFE_URL_SCHEMES)).toEqual([
					{ name: 'align', value: alignment.value },
				])
			}
		}
	})

	it('removes table alignment from every non-cell element even when allowlisted', () => {
		for (const name of ['div', 'p', 'img', 'table', 'tr', 'thead']) {
			const element: ElementNode = {
				category: 'element',
				name,
				attributes: [{ name: 'align', value: 'left' }],
				children: [],
			}
			expect({
				name,
				attributes: sanitizeAttributes(element, ['align'], SAFE_URL_SCHEMES),
			}).toEqual({ name, attributes: [] })
		}
	})

	it('removes every alignment value outside the exact closed vocabulary', () => {
		const values: readonly (string | undefined)[] = [
			'justify',
			'middle',
			'',
			undefined,
			'left;color:red',
			'left right',
			'<left>',
			'le\u0007ft',
			'xleft',
			'leftx',
		]
		for (const value of values) {
			const element: ElementNode = {
				category: 'element',
				name: 'td',
				attributes: [value === undefined ? { name: 'align' } : { name: 'align', value }],
				children: [],
			}
			expect({
				value,
				attributes: sanitizeAttributes(element, new Set(['align']), SAFE_URL_SCHEMES),
			}).toEqual({ value, attributes: [] })
		}
	})

	it('keeps allowlisted attributes in source order and preserves valuelessness', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'th',
			attributes: [
				{ name: 'COLSPAN', value: '2' },
				{ name: 'title' },
				{ name: 'dir', value: 'rtl' },
			],
			children: [],
		}
		expect(sanitizeAttributes(element, SAFE_ATTRIBUTES, SAFE_URL_SCHEMES)).toEqual([
			{ name: 'colspan', value: '2' },
			{ name: 'title' },
			{ name: 'dir', value: 'rtl' },
		])
	})

	it('removes handler, styling, namespaced, and unwritable names even when allowlisted', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'p',
			attributes: [
				{ name: 'onclick', value: 'x()' },
				{ name: 'ONLOAD', value: 'y()' },
				{ name: 'style', value: 'color:red' },
				{ name: 'srcdoc', value: '<p>' },
				{ name: 'xlink:href', value: '#x' },
				{ name: 'xmlns', value: 'urn:x' },
				{ name: 'bad name', value: 'x' },
				{ name: '', value: 'x' },
				{ name: 'title', value: 'kept' },
			],
			children: [],
		}
		const attributes = new Set([
			'onclick',
			'onload',
			'style',
			'srcdoc',
			'xlink:href',
			'xmlns',
			'bad name',
			'',
			'title',
		])
		expect(sanitizeAttributes(element, attributes, SAFE_URL_SCHEMES)).toEqual([
			{ name: 'title', value: 'kept' },
		])
	})

	it('removes an unsafe or valueless URL attribute rather than emptying it', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'a',
			attributes: [
				{ name: 'href', value: 'javascript:alert(1)' },
				{ name: 'cite', value: '//evil.test/x' },
				{ name: 'title' },
			],
			children: [],
		}
		expect(sanitizeAttributes(element, SAFE_ATTRIBUTES, SAFE_URL_SCHEMES)).toEqual([
			{ name: 'title' },
		])
		const bare: ElementNode = {
			category: 'element',
			name: 'a',
			attributes: [{ name: 'href' }],
			children: [],
		}
		expect(sanitizeAttributes(bare, SAFE_ATTRIBUTES, SAFE_URL_SCHEMES)).toEqual([])
	})

	it('keeps a URL its scheme allowlist admits, in the decoded form', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'a',
			attributes: [{ name: 'href', value: 'https://example.test/a b' }],
			children: [],
		}
		expect(sanitizeAttributes(element, SAFE_ATTRIBUTES, SAFE_URL_SCHEMES)).toEqual([
			{ name: 'href', value: 'https://example.test/ab' },
		])
		expect(sanitizeAttributes(element, SAFE_ATTRIBUTES, new Set(['mailto']))).toEqual([])
	})

	it('deduplicates hand-built attributes with conservative first-wins semantics', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'a',
			attributes: [
				{ name: 'href', value: 'javascript:x' },
				{ name: 'HREF', value: '/safe' },
				{ name: 'title', value: 'first' },
				{ name: 'TITLE', value: 'second' },
			],
			children: [],
		}
		expect(sanitizeAttributes(element, SAFE_ATTRIBUTES, SAFE_URL_SCHEMES)).toEqual([
			{ name: 'title', value: 'first' },
		])
	})
})

describe('resolveAttributes', () => {
	it('resolves every URL attribute and leaves the others alone', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'a',
			attributes: [
				{ name: 'HREF', value: '../asset.png' },
				{ name: 'src', value: 'https://other.test/x' },
				{ name: 'title', value: '../not-a-url' },
				{ name: 'download' },
			],
			children: [],
		}
		expect(resolveAttributes(element, 'https://example.test/docs/page')).toEqual([
			{ name: 'href', value: 'https://example.test/asset.png' },
			{ name: 'src', value: 'https://other.test/x' },
			{ name: 'title', value: '../not-a-url' },
			{ name: 'download' },
		])
	})

	it('leaves a value the platform cannot resolve exactly as written', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'a',
			attributes: [{ name: 'href', value: 'relative' }],
			children: [],
		}
		expect(resolveAttributes(element, 'not a base')).toEqual([{ name: 'href', value: 'relative' }])
	})
})

describe('mergeText', () => {
	it('joins adjacent text, drops empty text, and passes other nodes through', () => {
		const element: ElementNode = { category: 'element', name: 'b', attributes: [], children: [] }
		expect(
			mergeText([
				{ category: 'text', value: 'a' },
				{ category: 'text', value: '' },
				{ category: 'text', value: 'b' },
				element,
				{ category: 'text', value: 'c' },
			]),
		).toEqual([{ category: 'text', value: 'ab' }, element, { category: 'text', value: 'c' }])
	})

	it('returns an empty list for an empty or wholly empty-text list', () => {
		expect(mergeText([])).toEqual([])
		expect(mergeText([{ category: 'text', value: '' }])).toEqual([])
	})
})

describe('collapseText', () => {
	it('collapses whitespace runs in text children while keeping edge spaces', () => {
		const element: ElementNode = { category: 'element', name: 'b', attributes: [], children: [] }
		expect(
			collapseText([
				{ category: 'text', value: ' a \n  b ' },
				element,
				{ category: 'text', value: '\t' },
			]),
		).toEqual([{ category: 'text', value: ' a b ' }, element, { category: 'text', value: ' ' }])
	})
})

describe('extractRegion', () => {
	it('re-roots at the sole occurrence of the first qualifying name', () => {
		const document = parseDocument('<p>outside</p><main><p>inside</p></main>')
		expect(renderHTML(extractRegion(document, ['main', 'article']))).toBe('<p>inside</p>')
	})

	it('skips an absent or repeated name and falls through to the next', () => {
		const document = parseDocument('<article><p>only</p></article>')
		expect(renderHTML(extractRegion(document, ['main', 'article']))).toBe('<p>only</p>')
		const repeated = parseDocument('<main><p>a</p></main><MAIN><p>b</p></MAIN>')
		expect(extractRegion(repeated, ['main'])).toBe(repeated)
		expect(extractRegion(parseDocument('<p>a</p>'), ['main', 'article'])).toEqual({
			category: 'document',
			children: [
				{
					category: 'element',
					name: 'p',
					attributes: [],
					children: [{ category: 'text', value: 'a' }],
				},
			],
		})
	})
})

describe('pruneDocument', () => {
	it('drops, unwraps, and keeps nodes from one bottom-up pass', () => {
		const document = parseDocument('<div><span>a</span><!--c--><p>b</p></div>')
		const pruned = pruneDocument(document, (node) => {
			if (node.category === 'comment') return []
			if (node.category === 'element' && node.name === 'span') return node.children
			return [node]
		})
		expect(renderHTML(pruned)).toBe('<div>a<p>b</p></div>')
	})

	it('hands each node its children already pruned, bottom-up, root last', () => {
		const document = parseDocument('<div><span>drop</span><p>a</p></div>')
		const seen: string[] = []
		const rendered: string[] = []
		pruneDocument(document, (node) => {
			seen.push(node.category === 'element' ? node.name : node.category)
			if (node.category === 'element' && node.name === 'span') return []
			if (node.category === 'element' && node.name === 'div') rendered.push(renderHTML(node))
			return [node]
		})
		expect(seen).toEqual(['text', 'span', 'text', 'p', 'div', 'document'])
		expect(rendered).toEqual(['<div><p>a</p></div>'])
	})

	it('keeps the reference of a subtree nothing changed', () => {
		const document = parseDocument('<div><p>a</p></div>')
		expect(pruneDocument(document, (node) => [node])).toBe(document)
	})

	it('rebuilds a root from replacements that are not a document', () => {
		const document = parseDocument('<p>a</p>')
		expect(pruneDocument(document, (node) => (node.category === 'document' ? [] : [node]))).toEqual(
			{
				category: 'document',
				children: [],
			},
		)
	})

	it('stays total and depth-capped over a hostile deep document', () => {
		const document = buildDeepHTMLDocument(MAX_DEPTH + 500)
		let count = 0
		const pruned = pruneDocument(document, (node) => {
			count += 1
			return [node]
		})
		expect(count).toBeLessThanOrEqual(MAX_DEPTH + 2)
		expect(pruned.category).toBe('document')
	})

	it('hands a node at the depth cap no children, so a policy cannot keep what it cannot see', () => {
		const document = buildDeepHTMLDocument(MAX_DEPTH + 5)
		const deepest: number[] = []
		pruneDocument(document, (node) => {
			if (node.category === 'element') deepest.push(node.children.length)
			return [node]
		})
		expect(deepest[0]).toBe(0)
	})

	// The throw originates INSIDE the handler, after it has already kept several nodes, so
	// this exercises the `prune(candidate)` call itself rather than an earlier traversal
	// read. Fail-closed means the nodes it successfully kept are discarded too: a partial
	// document would be one a policy never finished vetting.
	it('fails closed when the prune handler throws, discarding even the nodes it already kept', () => {
		const script: ElementNode = {
			category: 'element',
			name: 'script',
			attributes: [],
			children: [{ category: 'text', value: 'alert(1)' }],
		}
		const document: HTMLDocument = {
			category: 'document',
			children: [{ category: 'text', value: 'keep me' }, script],
		}
		const recorder = createRecorder<[HTMLNode]>()
		const pruned = pruneDocument(document, (node) => {
			recorder.handler(node)
			if (node.category === 'element' && node.name === 'script') {
				throw new Error('hostile handler')
			}
			return [node]
		})

		expect(recorder.count).toBeGreaterThan(1)
		expect(pruned).toEqual({ category: 'document', children: [] })
		expect(renderHTML(pruned)).toBe('')
		expect(JSON.stringify(pruned)).not.toContain('keep me')
		expect(JSON.stringify(pruned)).not.toContain('script')
	})
})

describe('renderHTML', () => {
	it('serializes canonical tags, attributes, void elements, comments, and doctypes', () => {
		const document = parseDocument(
			'<!doctype HTML><DIV DISABLED title=\'a &amp; "b"\'><!--note--><BR></DIV>',
		)
		expect(renderHTML(document)).toBe(
			'<!DOCTYPE html><div disabled title="a &amp; &quot;b&quot;"><!--note--><br></div>',
		)
	})

	it('roundtrips representative parser-produced comments without losing content', () => {
		const sources = [
			'<!-->x-->',
			'<!--->x-->',
			'<!--a--!>tail',
			'<!--a--b-->',
			'<!--a---->',
			'<!--one--two--three-->',
			'<!--open',
		]
		for (const source of sources) {
			const document = parseDocument(source)
			expect(parseDocument(renderHTML(document))).toEqual(document)
		}
		expect(renderText(parseDocument('<!-->x-->'))).toBe('x-->')
		expect(renderText(parseDocument('<!--->x-->'))).toBe('x-->')
		expect(renderText(parseDocument('<!--a--!>tail'))).toBe('tail')
	})

	it('drops hand-built comments containing a genuine close sequence instead of emitting markup', () => {
		const values = ['x--><script>alert(1)</script>', 'x--!><img src=x onerror=alert(1)>']
		for (const value of values) {
			const document: HTMLDocument = {
				category: 'document',
				children: [{ category: 'comment', value }],
			}
			const rendered = renderHTML(document)
			expect(rendered).toBe('')
			expect(parseDocument(rendered).children.some((node) => node.category === 'element')).toBe(
				false,
			)
		}
	})

	it('preserves raw text verbatim and re-encodes literal text minimally', () => {
		const document = parseDocument(
			'<script>if (a < b) x &amp; y</script><title>&lt;x&gt; &amp;</title>',
		)
		expect(renderHTML(document)).toBe(
			'<script>if (a < b) x &amp; y</script><title>&lt;x&gt; &amp;</title>',
		)
	})

	it('drops a raw body containing its own case-insensitive close-tag sequence', () => {
		const script: ElementNode = {
			category: 'element',
			name: 'SCRIPT',
			attributes: [],
			children: [{ category: 'text', value: 'before</ScRiPt>after' }],
		}
		expect(renderHTML(script)).toBe('<script></script>')
	})

	it('drops colon-bearing attributes from a hand-built element', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'a',
			attributes: [
				{ name: 'xlink:href', value: 'javascript:alert(1)' },
				{ name: 'title', value: 'safe' },
			],
			children: [{ category: 'text', value: 'link' }],
		}
		expect(renderHTML(element)).toBe('<a title="safe">link</a>')
	})

	it('unwraps an invalid element name instead of writing an unsafe tag', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'bad name',
			attributes: [],
			children: [{ category: 'text', value: '<safe>' }],
		}
		expect(renderHTML(element)).toBe('&lt;safe&gt;')
	})

	it('ignores children carried by a hand-built void element', () => {
		const element: ElementNode = {
			category: 'element',
			name: 'BR',
			attributes: [{ name: 'DATA-X', value: 'a&b' }],
			children: [{ category: 'text', value: 'ignored' }],
		}
		expect(renderHTML(element)).toBe('<br data-x="a&amp;b">')
	})

	it('AST fixpoint: parseDocument(renderHTML(d)) deep-equals d', () => {
		for (const document of buildHTMLRoundtripCorpus()) {
			expect(hasAdjacentHTMLText(document)).toBe(false)
			expect(parseDocument(renderHTML(document))).toEqual(document)
		}
	})

	it('Canonical idempotence: renderHTML(parseDocument(renderHTML(d))) equals renderHTML(d)', () => {
		for (const document of buildHTMLRoundtripCorpus()) {
			const canonical = renderHTML(document)
			expect(renderHTML(parseDocument(canonical))).toBe(canonical)
		}
	})
})

describe('renderText', () => {
	it('uses block and line-break boundaries while collapsing inline whitespace', () => {
		const document = parseDocument(
			'<div> Alpha <span> beta </span><p>Gamma<br>Delta</p><p>Epsilon</p></div>',
		)
		expect(renderText(document)).toBe('Alpha beta\nGamma\nDelta\nEpsilon')
	})

	it('excludes raw script and style text while retaining title and textarea text', () => {
		const document = parseDocument(
			'<script>bad</script><style>worse</style><title>Title </title><textarea> Area</textarea>',
		)
		expect(renderText(document)).toBe('Title Area')
	})
})

describe('AST walkers', () => {
	it('walkNodes yields depth-first pre-order with the root included', () => {
		const document = parseDocument('<div><p>x<strong>y</strong></p><br></div>')
		expect(
			[...walkNodes(document)].map((node) =>
				node.category === 'element' ? node.name : node.category,
			),
		).toEqual(['document', 'div', 'p', 'text', 'strong', 'text', 'br'])
	})

	it('foldNode is a total children-first catamorphism', () => {
		const document = parseDocument('<p>x<strong>y</strong></p><!--z-->')
		const handlers: HTMLHandlers<number> = {
			document: (_node, children) => 1 + children.reduce((total, count) => total + count, 0),
			element: (_node, children) => 1 + children.reduce((total, count) => total + count, 0),
			text: () => 1,
			comment: () => 1,
			doctype: () => 1,
		}
		expect(foldNode(document, handlers)).toBe([...walkNodes(document)].length)
	})

	it('rewriteDocument preserves every reference for an identity rewrite', () => {
		const document = parseDocument('<div><p>x</p><p>y</p></div>')
		const div = document.children[0]
		const rewritten = rewriteDocument(document, (node) => node)
		expect(rewritten).toBe(document)
		expect(rewritten.children[0]).toBe(div)
	})

	it('rewriteDocument invokes its handler bottom-up, including the document root', () => {
		const document = parseDocument('<p>x</p>')
		const order: string[] = []
		rewriteDocument(document, (node) => {
			order.push(node.category === 'element' ? node.name : node.category)
			return node
		})
		expect(order).toEqual(['text', 'p', 'document'])
	})

	it('rewriteDocument changes only the rewritten path and retains untouched siblings', () => {
		const document = parseDocument('<div><p>x</p><p>y</p></div>')
		const div = document.children[0]
		if (div?.category !== 'element') throw new Error('expected div')
		const first = div.children[0]
		const second = div.children[1]
		const rewritten = rewriteDocument(
			document,
			(node): HTMLNode =>
				node.category === 'text' && node.value === 'x' ? { category: 'text', value: 'X' } : node,
		)
		const rewrittenDiv = rewritten.children[0]
		if (rewrittenDiv?.category !== 'element') throw new Error('expected rewritten div')
		expect(rewritten).not.toBe(document)
		expect(rewrittenDiv).not.toBe(div)
		expect(rewrittenDiv.children[0]).not.toBe(first)
		expect(rewrittenDiv.children[1]).toBe(second)
		expect(renderText(rewritten)).toBe('X\ny')
	})

	it('keeps all iterative engines total and depth-capped on a hostile deep AST', () => {
		const document: HTMLDocument = buildDeepHTMLDocument(MAX_DEPTH + 1_000)
		expect(() => renderHTML(document)).not.toThrow()
		expect(() => renderText(document)).not.toThrow()
		expect(() => [...walkNodes(document)]).not.toThrow()
		expect(() =>
			foldNode(document, {
				document: (_node, children) => children.length,
				element: (_node, children) => children.length,
				text: () => 1,
				comment: () => 1,
				doctype: () => 1,
			}),
		).not.toThrow()
		expect(() => rewriteDocument(document, (node) => node)).not.toThrow()
		expect([...walkNodes(document)].length).toBeLessThanOrEqual(MAX_DEPTH + 2)
	})

	it('keeps all iterative engines total on a cyclic adopted AST', () => {
		const element = buildBranchingHTMLElement('div')
		const document: HTMLDocument = { category: 'document', children: [element] }
		expect(() => renderHTML(document)).not.toThrow()
		expect(() => renderText(document)).not.toThrow()
		expect(() => [...walkNodes(document)]).not.toThrow()
		expect(() =>
			foldNode(document, {
				document: (_node, folded) => folded.length,
				element: (_node, folded) => folded.length,
				text: () => 1,
				comment: () => 1,
				doctype: () => 1,
			}),
		).not.toThrow()
		expect(() => rewriteDocument(document, (node) => node)).not.toThrow()
		expect(() => pruneDocument(document, (node) => [node])).not.toThrow()
		expect([...walkNodes(document)].length).toBeLessThanOrEqual(3)
	})

	it('visits a shared diamond graph by node identity instead of by exponential path count', () => {
		const document = buildDiamondHTMLDocument(MAX_DEPTH)
		expect(renderHTML(document).length).toBeLessThan(MAX_DEPTH * 32)
		expect(renderText(document).length).toBeLessThan(MAX_DEPTH * 8)
		expect([...walkNodes(document)].length).toBeLessThanOrEqual(MAX_DEPTH + 2)
		expect(
			foldNode(document, {
				document: (_node, folded) => 1 + folded.reduce((sum, value) => sum + value, 0),
				element: (_node, folded) => 1 + folded.reduce((sum, value) => sum + value, 0),
				text: () => 1,
				comment: () => 1,
				doctype: () => 1,
			}),
		).toBeLessThanOrEqual(MAX_DEPTH * 3)
		expect(() => rewriteDocument(document, (node) => node)).not.toThrow()
		expect(() => pruneDocument(document, (node) => [node])).not.toThrow()
	})

	it('bounds every renderer on the shared pre-fallback graph', () => {
		const count = 4_000
		const document = buildSharedHTMLPreDocument(count)
		expect(renderHTML(document).length).toBeLessThan(count * 50)
		expect(renderText(document)).toBe('')
	})
})
