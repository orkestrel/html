import type { ElementNode, HTMLDocument, HTMLHandlers, HTMLNode, HTMLStartTag } from '@src/core'
import {
	MAX_DEPTH,
	NAMED_ENTITIES,
	SAFE_ATTRIBUTES,
	SAFE_URL_SCHEMES,
	attributeOf,
	collapseSpace,
	collapseText,
	decodeEntities,
	encodeAttribute,
	encodeText,
	extractRegion,
	foldNode,
	isSafeURL,
	lowercaseASCII,
	mergeText,
	parseDocument,
	parseStartTag,
	pruneDocument,
	renderHTML,
	renderText,
	resolveAttributes,
	resolveURL,
	rewriteDocument,
	sanitizeAttributes,
	sanitizeURL,
	scanAttributes,
	scanComment,
	scanDoctype,
	scanRawText,
	scanTag,
	walkNodes,
} from '@src/core'
import { bench, describe, expect, it } from 'vitest'
import { createRecorder } from '@orkestrel/test'
import {
	URL_SAFETY_GROUPS,
	WHATWG_NAMED_ENTITIES,
	buildDeepHTMLDocument,
	buildBranchingHTMLElement,
	buildDiamondHTMLDocument,
	buildHTMLEntityURLCorpus,
	buildHTMLRoundtripCorpus,
	buildSharedHTMLPreDocument,
	buildURLSafetyCorpus,
	hasAdjacentHTMLText,
} from '../../setup.js'

describe('HTML escaping and URL helpers', () => {
	it('lowercaseASCII folds only ASCII uppercase characters', () => {
		expect(lowercaseASCII('HTML-İ-Ω-ω')).toBe('html-İ-Ω-ω')
	})

	it('decodeEntities decodes decimal, hexadecimal, invalid-scalar, and named references', () => {
		expect(decodeEntities('&#65; &#x1F600;')).toBe('A 😀')
		expect(decodeEntities('&#0; &#xD800; &#1114112;')).toBe('\uFFFD \uFFFD \uFFFD')
		expect(decodeEntities('&amp; &copy; &Alpha; &nbsp;')).toBe('& © Α \u00A0')
		expect(decodeEntities('&unknown; &amp')).toBe('&unknown; &amp')
	})

	it('decodes every semicolon-terminated WHATWG named entity exactly', () => {
		expect(Object.isFrozen(NAMED_ENTITIES)).toBe(true)
		expect(NAMED_ENTITIES).toEqual(WHATWG_NAMED_ENTITIES)
		for (const [name, value] of Object.entries(WHATWG_NAMED_ENTITIES)) {
			expect({ name, decoded: decodeEntities(`&${name};`) }).toEqual({ name, decoded: value })
		}
	})

	it('decodes multi-codepoint values and digit-bearing names', () => {
		expect(decodeEntities('&fjlig;&NotEqualTilde;&ThickSpace;&race;')).toBe(
			'fj\u2242\u0338\u205F\u200A\u223D\u0331',
		)
		expect(decodeEntities('&frac12;&sup1;&blk12;')).toBe('\u00BD\u00B9\u2592')
	})

	it('keeps unknown, wrong-case, prototype-like, and unterminated names literal', () => {
		const literal = [
			'&definitelyUnknown;',
			'&aMp;',
			'&constructor;',
			'&__proto__;',
			'&hasOwnProperty;',
			'&copy',
			'&NotEqualTilde',
			'&frac12',
		].join('|')
		expect(decodeEntities(literal)).toBe(literal)
	})

	it('audits every security-relevant generated entity value against the reviewed set', () => {
		const controls: string[] = []
		const punctuation: string[] = []
		for (const [name, value] of Object.entries(NAMED_ENTITIES)) {
			if (
				[...value].some((character) => {
					const point = character.codePointAt(0)
					return point !== undefined && (point <= 0x1f || point === 0x7f || character === '&')
				})
			) {
				controls.push(name)
			}
			if (value === ':' || value === '/' || value === '\\') punctuation.push(name)
		}
		expect(controls).toEqual(['AMP', 'NewLine', 'Tab', 'amp'])
		expect(punctuation).toEqual(['bsol', 'colon', 'sol'])
	})

	it('preserves the AST roundtrip law across every entity parsing context', () => {
		const references = Object.keys(NAMED_ENTITIES).map((name) => `&${name};`)
		const text = parseDocument(references.join('|'))
		const literal = parseDocument(
			`<title>${references.join('|')}</title><textarea>${references.join('|')}</textarea>`,
		)
		const attributes = parseDocument(
			references.map((reference) => `<p title="${reference}"></p>`).join(''),
		)
		for (const document of [text, literal, attributes]) {
			expect(parseDocument(renderHTML(document))).toEqual(document)
		}
	})

	// Timeout basis: the three decodes together measured 101–116 ms across the scoped
	// `test:src:core` runs on 2026-08-24, so 30 s is far past any loaded-host reading and catches
	// a hang rather than grading the decode. The growth pairs these inputs came from live in the
	// benchmark block at the end of this file.
	it('decodes large recognized, unknown, and nested entity inputs to their exact values', () => {
		const recognized = '&NotEqualTilde;'.repeat(80_000)
		expect(decodeEntities(recognized)).toBe('\u2242\u0338'.repeat(80_000))

		const unknown = `&${'unknown'.repeat(60_000)};`
		expect(decodeEntities(unknown)).toBe(unknown)

		// One decode pass, not a fixpoint: the inner reference survives as literal text.
		const nested = '&amp;amp;'.repeat(80_000)
		expect(decodeEntities(nested)).toBe('&amp;'.repeat(80_000))
	}, 30_000)

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

describe('scanning pieces', () => {
	it('scanAttributes handles quoted, unquoted, minimized, duplicate, and hostile names', () => {
		expect(
			scanAttributes(' ID="first" id=second disabled empty="" title=\'a &amp; b\' __proto__=safe'),
		).toEqual([
			{ name: 'id', value: 'first' },
			{ name: 'disabled' },
			{ name: 'empty', value: '' },
			{ name: 'title', value: 'a & b' },
			{ name: '__proto__', value: 'safe' },
		])
	})

	it('scanAttributes minimizes an unterminated quoted value', () => {
		expect(scanAttributes(' title="unterminated')).toEqual([{ name: 'title' }])
	})

	it('scanTag scans lowercased start and close tags and rejects incomplete tags', () => {
		expect(scanTag('<DIV A=1>', 0)).toEqual({
			name: 'div',
			attributes: [{ name: 'a', value: '1' }],
			closing: false,
			next: 9,
		})
		expect(scanTag('x</DiV >y', 1)).toEqual({
			name: 'div',
			attributes: [],
			closing: true,
			next: 8,
		})
		expect(scanTag('<div', 0)).toBeUndefined()
	})

	it('uses one ASCII-folding and HTML-whitespace grammar across recovery paths', () => {
		expect(scanTag('<p Ω=one>', 0)?.attributes).toEqual([{ name: 'Ω', value: 'one' }])
		expect(scanTag('<p Ω=one Ω=two>', 0)?.attributes).toEqual([{ name: 'Ω', value: 'one' }])
		expect(scanTag('<p lang=en\u00a0>', 0)?.attributes).toEqual([
			{ name: 'lang', value: 'en\u00a0' },
		])
		expect(scanTag('<p a\u00a0b=c a\u00a0b=d>', 0)?.attributes).toEqual([
			{ name: 'a\u00a0b', value: 'c' },
		])
	})

	it('scanComment handles standard, bogus, CDATA, and unterminated comments', () => {
		expect(scanComment('<!--hello-->x', 0)).toEqual({
			node: { category: 'comment', value: 'hello' },
			next: 12,
		})
		expect(scanComment('<?work?>', 0)?.node.value).toBe('work?')
		expect(scanComment('<![CDATA[x<y]]>', 0)?.node.value).toBe('[CDATA[x<y]]')
		expect(scanComment('<!--open', 0)).toEqual({
			node: { category: 'comment', value: 'open' },
			next: 8,
		})
	})

	it('scanComment closes abrupt and incorrectly closed forms into representable tokens', () => {
		expect(scanComment('<!-->x-->', 0)).toEqual({
			node: { category: 'comment', value: '' },
			next: 5,
		})
		expect(scanComment('<!--->x-->', 0)).toEqual({
			node: { category: 'comment', value: '' },
			next: 6,
		})
		expect(scanComment('<!--x--!>tail', 0)).toEqual({
			node: { category: 'comment', value: 'x' },
			next: 9,
		})
	})

	it('scanDoctype handles simple, public, and system declarations', () => {
		expect(scanDoctype('<!DOCTYPE HTML>', 0)?.node).toEqual({
			category: 'doctype',
			name: 'html',
		})
		expect(
			scanDoctype('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "legacy.dtd">', 0)?.node,
		).toEqual({
			category: 'doctype',
			name: 'html',
			public: '-//W3C//DTD HTML 4.01//EN',
			system: 'legacy.dtd',
		})
		expect(scanDoctype('<!doctype html SYSTEM "about:legacy-compat">', 0)?.node).toEqual({
			category: 'doctype',
			name: 'html',
			system: 'about:legacy-compat',
		})
		expect(scanDoctype('<!doctype html SYSTEM "identifier>part">', 0)?.node).toEqual({
			category: 'doctype',
			name: 'html',
			system: 'identifier>part',
		})
		expect(scanDoctype('<!doctype html', 0)).toBeUndefined()
	})

	it('scanRawText finds a case-insensitive close and optionally decodes entities', () => {
		expect(scanRawText('a <b>&amp;</b></ScRiPt>x', 0, 'script')).toEqual({
			node: { category: 'text', value: 'a <b>&amp;</b>' },
			next: 23,
			closed: true,
		})
		expect(scanRawText('&lt;b&gt;</TITLE>', 0, 'title', true)).toEqual({
			node: { category: 'text', value: '<b>' },
			next: 17,
			closed: true,
		})
		expect(scanRawText('unterminated', 0, 'style')).toEqual({
			node: { category: 'text', value: 'unterminated' },
			next: 12,
			closed: false,
		})
	})
})

describe('strict start tag parsing', () => {
	it('returns exact source boundaries for unambiguous start tags', () => {
		const source = 'x<HTML lang="en" data-note="a>b">tail'
		const next = source.indexOf('>tail') + 1
		const parsed: HTMLStartTag | undefined = parseStartTag(source, 1)

		expect(parsed).toEqual({
			name: 'html',
			attributes: [
				{ name: 'lang', value: 'en' },
				{ name: 'data-note', value: 'a>b' },
			],
			slashed: false,
			next,
		})
		expect(source.slice(1, parsed?.next)).toBe('<HTML lang="en" data-note="a>b">')
	})

	it('preserves valueless, empty, quoted, unquoted, and decoded attribute values', () => {
		const source = '<html data-empty="" disabled lang=en data-note=\'a>b\' data-code="&gt;">'

		expect(parseStartTag(source, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'data-empty', value: '' },
				{ name: 'disabled' },
				{ name: 'lang', value: 'en' },
				{ name: 'data-note', value: 'a>b' },
				{ name: 'data-code', value: '>' },
			],
			slashed: false,
			next: source.length,
		})
	})

	it('accepts HTML whitespace and reports the trailing solidus without inventing semantics', () => {
		const spaced = '<html\tlang="en"\rdata-note=\'a>b\'\n>'

		expect(parseStartTag(spaced, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'lang', value: 'en' },
				{ name: 'data-note', value: 'a>b' },
			],
			slashed: false,
			next: spaced.length,
		})
		expect(parseStartTag('<html/>', 0)).toEqual({
			name: 'html',
			attributes: [],
			slashed: true,
			next: 7,
		})
		expect(parseStartTag('<html disabled/>', 0)).toEqual({
			name: 'html',
			attributes: [{ name: 'disabled' }],
			slashed: true,
			next: 16,
		})
		expect(parseStartTag('<html lang=en/>', 0)).toEqual({
			name: 'html',
			attributes: [{ name: 'lang', value: 'en/' }],
			slashed: false,
			next: 15,
		})
	})

	it('tracks UTF-16 offsets exactly', () => {
		const source = '😀<html data-note="ok">'
		const offset = source.indexOf('<')

		expect(parseStartTag(source, offset)?.next).toBe(source.length)
		expect(source.slice(offset, parseStartTag(source, offset)?.next)).toBe('<html data-note="ok">')
	})

	it('folds only ASCII attribute-name case and preserves distinct Unicode names', () => {
		const source = '<html DATA-X=one İ=two Ω=three ω=four>'

		expect(parseStartTag(source, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: 'data-x', value: 'one' },
				{ name: 'İ', value: 'two' },
				{ name: 'Ω', value: 'three' },
				{ name: 'ω', value: 'four' },
			],
			slashed: false,
			next: source.length,
		})
	})

	it('accepts Unicode scalar values and refuses surrogates and noncharacters', () => {
		const valid = '<html 😀="🦅" data=🦅>'
		const rejected = [
			'<html \ud800=x>',
			'<html \udfff=x>',
			'<html data="\ud800">',
			'<html data="\udfff">',
			'<html data=\ud800>',
			'<html data=\udfff>',
			'<html data="\u{1fffe}">',
		]

		expect(parseStartTag(valid, 0)).toEqual({
			name: 'html',
			attributes: [
				{ name: '😀', value: '🦅' },
				{ name: 'data', value: '🦅' },
			],
			slashed: false,
			next: valid.length,
		})
		for (const source of rejected) expect(parseStartTag(source, 0)).toBeUndefined()
	})

	it('refuses malformed, ambiguous, duplicated, closing, and incomplete source', () => {
		const rejected = [
			'<html',
			'</html>',
			'< html>',
			'<1html>',
			'<html data=>',
			'<html data="unterminated>',
			"<html data='unterminated>",
			'<html data="ok"x>',
			'<html data=one=two>',
			'<html data<bad>',
			'<html data"bad>',
			'<html data=`bad`>',
			'<x-élément>',
			'<html data="ok"data-next="bad">',
			'<html id=first ID=second>',
			'<html data=\0>',
			'<html / >',
			'<html/ >',
			'<html\u00a0lang="en">',
			'<html\vlang="en">',
		]

		for (const source of rejected) expect(parseStartTag(source, 0)).toBeUndefined()
	})

	it('refuses every invalid source offset', () => {
		const source = '<html>'
		const offsets = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, source.length]

		for (const offset of offsets) expect(parseStartTag(source, offset)).toBeUndefined()
	})

	it('leaves total scanner and document recovery unchanged', () => {
		const source = '<div disabled title="oops><p>safe</p>'

		expect(parseStartTag(source, 0)).toBeUndefined()
		expect(scanTag(source, 0)).toEqual({
			name: 'div',
			attributes: [{ name: 'disabled' }, { name: 'title' }],
			closing: false,
			next: 26,
		})
		expect(renderHTML(parseDocument(source))).toBe('<div disabled title><p>safe</p></div>')
	})

	it('handles large valid and unterminated quoted inputs', () => {
		const attributes = Array.from(
			{ length: 10_000 },
			(_, index) => ` data-${index}="${index}>value"`,
		).join('')
		const valid = `<html${attributes}>`
		const unterminated = `<html data-note="${'>'.repeat(100_000)}`

		expect(parseStartTag(valid, 0)?.attributes).toHaveLength(10_000)
		expect(parseStartTag(valid, 0)?.next).toBe(valid.length)
		expect(parseStartTag(unterminated, 0)).toBeUndefined()
	})
})

// The scheme and control floor `sanitizeURL` enforces, driven from `buildURLSafetyCorpus`
// so the whole floor reads as one list of vectors and dispositions (guides/html.md §
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
		const values: ReadonlyArray<string | undefined> = [
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

	it('separates adjacent table cells with tabs', () => {
		const document = parseDocument('<table><tr><td>a</td><td>b</td></tr></table>')
		expect(renderText(document)).toBe('a\tb')
	})

	it('separates table rows with newlines', () => {
		const document = parseDocument(
			'<table><tr><th>Flag</th><th>Meaning</th></tr>' +
				'<tr><td>--src</td><td>library</td></tr></table>',
		)
		expect(renderText(document)).toBe('Flag\tMeaning\n--src\tlibrary')
	})

	it('keeps block content within a cell while preserving the next cell boundary', () => {
		const document = parseDocument('<table><tr><td><p>a1</p><p>a2</p></td><td>b</td></tr></table>')
		expect(renderText(document)).toBe('a1\na2\tb')
	})

	it('preserves empty table cells as adjacent separators', () => {
		const document = parseDocument('<table><tr><td>a</td><td></td><td>b</td></tr></table>')
		expect(renderText(document)).toBe('a\t\tb')
	})

	it('preserves inherited whitespace within preformatted content', () => {
		const document = parseDocument('<pre><code>line1\n  line2</code></pre>')
		expect(renderText(document)).toBe('line1\n  line2')
	})

	it('collapses code whitespace outside preformatted content', () => {
		const document = parseDocument('<code>line1\nline2</code>')
		expect(renderText(document)).toBe('line1 line2')
	})

	it('preserves blank lines within preformatted content', () => {
		const document = parseDocument('<pre>line1\n\nline3</pre>')
		expect(renderText(document)).toBe('line1\n\nline3')
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
		const rewritten = rewriteDocument(document, (node): HTMLNode =>
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

// How decode cost moves as each entity-pressure input doubles. The suite above proves what the
// decoder returns; these report what it costs and assert nothing, so only `npm run test:bench`
// collects them and no gate reads them. Each pair is the input pair the deleted wall-clock ratio
// assertions used.
if (import.meta.env.MODE === 'benchmark') {
	const recognizedSmall = '&NotEqualTilde;'.repeat(40_000)
	const recognizedLarge = '&NotEqualTilde;'.repeat(80_000)
	const unknownSmall = `&${'unknown'.repeat(30_000)};`
	const unknownLarge = `&${'unknown'.repeat(60_000)};`
	const nestedSmall = '&amp;amp;'.repeat(40_000)
	const nestedLarge = '&amp;amp;'.repeat(80_000)

	bench('decodeEntities — 40,000 recognized references', () => {
		decodeEntities(recognizedSmall)
	})
	bench('decodeEntities — 80,000 recognized references', () => {
		decodeEntities(recognizedLarge)
	})
	bench('decodeEntities — one unknown name of 30,000 segments', () => {
		decodeEntities(unknownSmall)
	})
	bench('decodeEntities — one unknown name of 60,000 segments', () => {
		decodeEntities(unknownLarge)
	})
	bench('decodeEntities — 40,000 nested references', () => {
		decodeEntities(nestedSmall)
	})
	bench('decodeEntities — 80,000 nested references', () => {
		decodeEntities(nestedLarge)
	})
}
