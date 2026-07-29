import type { ElementNode, HTMLDocument, HTMLHandlers, HTMLNode } from '@src/core'
import {
	MAX_DEPTH,
	attributeOf,
	collapseSpace,
	encodeAttribute,
	encodeText,
	escapeMarkdown,
	foldNode,
	parseDocument,
	renderHTML,
	renderMarkdown,
	renderText,
	resolveURL,
	rewriteDocument,
	sanitizeURL,
	walkNodes,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	buildDeepHTMLDocument,
	buildHTMLRoundtripCorpus,
	hasAdjacentHTMLText,
} from '../../setup.js'

describe('HTML escaping and URL helpers', () => {
	it('encodes HTML text minimally', () => {
		expect(encodeText('&<>"\'')).toBe('&amp;&lt;&gt;"\'')
	})

	it('encodes double-quoted attribute values minimally', () => {
		expect(encodeAttribute('&"<>\'')).toBe("&amp;&quot;<>'")
	})

	it('escapes every supported markdown syntax marker in literal text', () => {
		expect(escapeMarkdown('\\*_`[]#>|+-')).toBe('\\\\\\*\\_\\`\\[\\]\\#\\>\\|\\+\\-')
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
		expect(renderMarkdown(document)).toBe('\\*literal\\* \\[text\\] \\# mark\n\nsecond')
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
