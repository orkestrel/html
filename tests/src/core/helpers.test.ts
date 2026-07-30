import type { ElementNode, HTMLDocument, HTMLHandlers, HTMLNode } from '@src/core'
import {
	MAX_DEPTH,
	SAFE_ATTRIBUTES,
	SAFE_URL_SCHEMES,
	attributeOf,
	collapseSpace,
	collapseText,
	createHTML,
	encodeAttribute,
	encodeText,
	escapeMarkdown,
	extractRegion,
	foldNode,
	isSafeURL,
	mergeText,
	parseDocument,
	pruneDocument,
	renderHTML,
	renderMarkdown,
	renderText,
	resolveAttributes,
	resolveURL,
	rewriteDocument,
	sanitizeAttributes,
	sanitizeURL,
	walkNodes,
} from '@src/core'
import {
	parseDocument as parseMarkdown,
	renderMarkdown as renderCanonicalMarkdown,
} from '@orkestrel/markdown'
import { describe, expect, it } from 'vitest'
import {
	buildDeepHTMLDocument,
	buildHTMLRoundtripCorpus,
	buildMarkdownPipelineInput,
	buildMarkdownProjectionInputs,
	hasAdjacentHTMLText,
	parseMarkdownProjection,
} from '../../setup.js'

describe('HTML escaping and URL helpers', () => {
	it('encodes HTML text minimally', () => {
		expect(encodeText('&<>"\'')).toBe('&amp;&lt;&gt;"\'')
	})

	it('encodes double-quoted attribute values minimally', () => {
		expect(encodeAttribute('&"<>\'')).toBe("&amp;&quot;<>'")
	})

	it('escapes every supported markdown syntax marker in literal text', () => {
		expect(escapeMarkdown('\\*_`[]#>|+-')).toBe('\\\\\\*\\_\\`\\[\\]#>\\|+-')
	})

	it('escapes markdown block markers only at line starts', () => {
		expect(escapeMarkdown('# h')).toBe('\\# h')
		expect(escapeMarkdown('> q')).toBe('\\> q')
		expect(escapeMarkdown('- x')).toBe('\\- x')
		expect(escapeMarkdown('+ y')).toBe('\\+ y')
		expect(escapeMarkdown('1. x')).toBe('1\\. x')
		expect(escapeMarkdown('10) x')).toBe('10\\) x')
		expect(escapeMarkdown('a # b')).toBe('a # b')
		expect(escapeMarkdown('a - b')).toBe('a - b')
		expect(escapeMarkdown('x 1. y')).toBe('x 1. y')
		expect(escapeMarkdown('a\n# h')).toBe('a\n\\# h')
		expect(escapeMarkdown('-nospace')).toBe('-nospace')
		expect(escapeMarkdown('a | b')).toBe('a \\| b')
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

describe('sanitizeAttributes', () => {
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

describe('renderMarkdown projection', () => {
	it('projects h1 through h6 and paragraphs', () => {
		const document = parseDocument(
			'<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6><p>Body</p>',
		)
		expect(renderMarkdown(document)).toBe(
			'# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nBody',
		)
	})

	it('projects nested unordered and ordered lists with continuation indentation', () => {
		const document = parseDocument(
			'<ul><li>one<ul><li>two</li></ul></li><li>three</li></ul><ol start=3><li>four<ol><li>five</li></ol></li></ol>',
		)
		expect(renderMarkdown(document)).toBe('- one\n  - two\n- three\n\n3. four\n   1. five')
	})

	it('projects blockquotes line by line', () => {
		const document = parseDocument('<blockquote><p>one</p><p>two</p></blockquote>')
		expect(renderMarkdown(document)).toBe('> one\n>\n> two')
	})

	it('projects pre-code with a language class to a safe-width fence', () => {
		const document = parseDocument(
			'<pre><code class="other language-ts">const fence = ```;</code></pre>',
		)
		expect(renderMarkdown(document)).toBe('````ts\nconst fence = ```;\n````')
	})

	it('projects links, strong, emphasis, inline code, images, and hard breaks', () => {
		const document = parseDocument(
			'<p><a href="/guide(a)">link</a> <strong>strong</strong> <b>bold</b> <em>em</em> <i>italic</i> <code>x`y</code><br><img alt="a*b" src="/x.png"></p>',
		)
		expect(renderMarkdown(document)).toBe(
			'[link](/guide\\(a\\)) **strong** **bold** *em* *italic* ``x`y``  \n![a\\*b](/x.png)',
		)
	})

	it('bounds inline and fenced code descendant walks by depth', () => {
		let descendant: HTMLNode = { category: 'text', value: 'beyond-depth' }
		for (let depth = 0; depth < MAX_DEPTH + 5; depth += 1) {
			descendant = {
				category: 'element',
				name: 'span',
				attributes: [],
				children: [descendant],
			}
		}
		const inline: ElementNode = {
			category: 'element',
			name: 'code',
			attributes: [],
			children: [descendant],
		}
		const fenced: ElementNode = {
			category: 'element',
			name: 'pre',
			attributes: [],
			children: [{ ...inline, attributes: [{ name: 'class', value: 'language-ts' }] }],
		}
		expect(renderMarkdown(inline)).not.toContain('beyond-depth')
		expect(renderMarkdown(fenced)).not.toContain('beyond-depth')
	})

	it('terminates a cyclic inline-code descendant walk within the shared bound', () => {
		const children: HTMLNode[] = []
		const code: ElementNode = {
			category: 'element',
			name: 'code',
			attributes: [],
			children,
		}
		children.push(code)
		const rendered = renderMarkdown(code)
		expect(rendered.length).toBeLessThanOrEqual(MAX_DEPTH * 4)
	})

	it('projects horizontal rules and GFM tables', () => {
		const document = parseDocument(
			'<hr><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>a|b</td><td>1</td></tr><tr><td>c</td></tr></tbody></table>',
		)
		expect(renderMarkdown(document)).toBe(
			'---\n\n| Name | Value |\n| --- | --- |\n| a\\|b | 1 |\n| c |  |',
		)
	})

	it('unwraps unknown elements and escapes literal markdown syntax', () => {
		const document = parseDocument(
			'<section><p>*literal* [text] # mark</p><wrapper><p>second</p></wrapper></section>',
		)
		expect(renderMarkdown(document)).toBe('\\*literal\\* \\[text\\] # mark\n\nsecond')
	})
})

describe('renderMarkdown markdown-package interop', () => {
	const inputs = buildMarkdownProjectionInputs()

	it('reparses headings one through six and a paragraph as the expected blocks', () => {
		expect(parseMarkdownProjection(inputs.headings)).toEqual({
			element: 'document',
			children: [
				{ element: 'heading', level: 1, children: [{ element: 'text', value: 'One' }] },
				{ element: 'heading', level: 2, children: [{ element: 'text', value: 'Two' }] },
				{ element: 'heading', level: 3, children: [{ element: 'text', value: 'Three' }] },
				{ element: 'heading', level: 4, children: [{ element: 'text', value: 'Four' }] },
				{ element: 'heading', level: 5, children: [{ element: 'text', value: 'Five' }] },
				{ element: 'heading', level: 6, children: [{ element: 'text', value: 'Six' }] },
				{ element: 'paragraph', children: [{ element: 'text', value: 'Body' }] },
			],
		})
	})

	it('reparses nested unordered and ordered lists with their structure and ordinal', () => {
		expect(parseMarkdownProjection(inputs.lists)).toEqual({
			element: 'document',
			children: [
				{
					element: 'list',
					ordered: false,
					start: 1,
					items: [
						{
							element: 'listItem',
							children: [
								{ element: 'paragraph', children: [{ element: 'text', value: 'one' }] },
								{
									element: 'list',
									ordered: false,
									start: 1,
									items: [
										{
											element: 'listItem',
											children: [
												{
													element: 'paragraph',
													children: [{ element: 'text', value: 'two' }],
												},
											],
										},
									],
								},
							],
						},
						{
							element: 'listItem',
							children: [
								{
									element: 'paragraph',
									children: [{ element: 'text', value: 'three' }],
								},
							],
						},
					],
				},
				{
					element: 'list',
					ordered: true,
					start: 3,
					items: [
						{
							element: 'listItem',
							children: [
								{
									element: 'paragraph',
									children: [{ element: 'text', value: 'four' }],
								},
								{
									element: 'list',
									ordered: true,
									start: 1,
									items: [
										{
											element: 'listItem',
											children: [
												{
													element: 'paragraph',
													children: [{ element: 'text', value: 'five' }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		})
	})

	it('reparses blockquotes and language-tagged fenced code as nested blocks', () => {
		expect(parseMarkdownProjection(inputs.quote)).toEqual({
			element: 'document',
			children: [
				{
					element: 'blockquote',
					children: [
						{
							element: 'paragraph',
							children: [{ element: 'text', value: 'quoted' }],
						},
						{
							element: 'list',
							ordered: false,
							start: 1,
							items: [
								{
									element: 'listItem',
									children: [
										{
											element: 'paragraph',
											children: [{ element: 'text', value: 'nested' }],
										},
									],
								},
							],
						},
					],
				},
			],
		})
		expect(parseMarkdownProjection(inputs.code)).toEqual({
			element: 'document',
			children: [{ element: 'codeBlock', lang: 'ts', code: 'const value = 1' }],
		})
	})

	it('reparses links, emphasis, inline code, images, and hard breaks without data loss', () => {
		expect(parseMarkdownProjection(inputs.inline)).toEqual({
			element: 'document',
			children: [
				{
					element: 'paragraph',
					children: [
						{
							element: 'link',
							href: 'https://example.test/guide',
							children: [{ element: 'text', value: 'guide' }],
						},
						{ element: 'text', value: ' ' },
						{
							element: 'emphasis',
							strong: true,
							children: [{ element: 'text', value: 'strong' }],
						},
						{ element: 'text', value: ' ' },
						{
							element: 'emphasis',
							strong: false,
							children: [{ element: 'text', value: 'emphasis' }],
						},
						{ element: 'text', value: ' ' },
						{ element: 'codeSpan', value: 'inline' },
						{ element: 'text', value: '\nnext !' },
						{
							element: 'link',
							href: 'https://example.test/image.png',
							children: [{ element: 'text', value: 'portrait' }],
						},
					],
				},
			],
		})
	})

	it('reparses thematic breaks and GFM tables with cells and default alignments intact', () => {
		expect(parseMarkdownProjection(inputs.table)).toEqual({
			element: 'document',
			children: [
				{ element: 'thematicBreak' },
				{
					element: 'table',
					header: [[{ element: 'text', value: 'Name' }], [{ element: 'text', value: 'Value' }]],
					rows: [
						[[{ element: 'text', value: 'Alpha|Beta' }], [{ element: 'text', value: '1' }]],
						[[{ element: 'text', value: 'Gamma' }], [{ element: 'text', value: '2' }]],
					],
					align: ['none', 'none'],
				},
			],
		})
	})

	it('keeps adversarial markdown syntax in literal paragraph text nodes', () => {
		const source = [
			'<p>* _ ` [ ]</p>',
			'<p>| Head | Value |\n| --- | --- |</p>',
			'<p># heading</p>',
			'<p>&gt; quote</p>',
			'<p>1. ordered</p>',
			'<p>- bullet</p>',
		].join('')
		expect(parseMarkdownProjection(source)).toEqual({
			element: 'document',
			children: [
				{
					element: 'paragraph',
					children: [{ element: 'text', value: '* _ ` [ ]' }],
				},
				{
					element: 'paragraph',
					children: [{ element: 'text', value: '| Head | Value |\n| --- | --- |' }],
				},
				{ element: 'paragraph', children: [{ element: 'text', value: '# heading' }] },
				{ element: 'paragraph', children: [{ element: 'text', value: '> quote' }] },
				{ element: 'paragraph', children: [{ element: 'text', value: '1. ordered' }] },
				{ element: 'paragraph', children: [{ element: 'text', value: '- bullet' }] },
			],
		})
	})

	it('keeps structure and neutralizes boilerplate and javascript through the full pipeline', () => {
		const markdown = renderMarkdown(
			createHTML(buildMarkdownPipelineInput())
				.sanitize()
				.distill({ base: 'https://example.test/docs/page.html' }).document,
		)
		expect(markdown).not.toContain('Noise')
		expect(markdown).not.toContain('Menu')
		expect(markdown).not.toContain('Promoted')
		expect(markdown).not.toContain('Copyright')
		expect(markdown).not.toContain('javascript:')
		expect(parseMarkdown(markdown)).toEqual({
			element: 'document',
			children: [
				{
					element: 'heading',
					level: 1,
					children: [{ element: 'text', value: 'Interop' }],
				},
				{
					element: 'paragraph',
					children: [
						{ element: 'text', value: 'Read the ' },
						{
							element: 'link',
							href: 'https://example.test/guide',
							children: [{ element: 'text', value: 'guide' }],
						},
						{ element: 'text', value: ' and ' },
						{
							element: 'link',
							href: '',
							children: [{ element: 'text', value: 'unsafe' }],
						},
						{ element: 'text', value: ' link.' },
					],
				},
				{
					element: 'list',
					ordered: false,
					start: 1,
					items: [
						{
							element: 'listItem',
							children: [
								{
									element: 'paragraph',
									children: [{ element: 'text', value: 'Alpha' }],
								},
							],
						},
						{
							element: 'listItem',
							children: [
								{
									element: 'paragraph',
									children: [{ element: 'text', value: 'Beta' }],
								},
							],
						},
					],
				},
			],
		})
	})

	it('stabilizes every HTML projection after one markdown canonicalization cycle', () => {
		for (const source of Object.values(inputs)) {
			const once = renderCanonicalMarkdown(parseMarkdownProjection(source))
			expect(renderCanonicalMarkdown(parseMarkdown(once))).toBe(once)
		}
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
		expect(() => renderMarkdown(document)).not.toThrow()
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
		const children: HTMLNode[] = []
		const element: ElementNode = {
			category: 'element',
			name: 'div',
			attributes: [],
			children,
		}
		children.push(element)
		const document: HTMLDocument = { category: 'document', children: [element] }
		expect(() => renderHTML(document)).not.toThrow()
		expect(() => renderText(document)).not.toThrow()
		expect(() => renderMarkdown(document)).not.toThrow()
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
	})
})
