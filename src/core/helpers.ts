import type {
	CommentNode,
	DoctypeNode,
	ElementNode,
	HTMLAttribute,
	HTMLAttributeValue,
	HTMLDerivation,
	HTMLDocument,
	HTMLHandlerMap,
	HTMLNode,
	HTMLOrigin,
	HTMLOpenPosition,
	HTMLPruneHandler,
	HTMLRawText,
	HTMLRewriteHandler,
	HTMLScan,
	HTMLSource,
	HTMLSpan,
	HTMLStartTag,
	HTMLTag,
	TextNode,
} from './types.js'
import { attempt, isFiniteNumber, isFunction, isInteger } from '@orkestrel/contract'
import {
	BLOCK_ELEMENTS,
	HTML_WHITESPACE,
	LITERAL_ELEMENTS,
	MAX_DEPTH,
	NAMED_ENTITIES,
	RAW_ELEMENTS,
	SAFE_URL_SCHEMES,
	TABLE_ALIGNMENTS,
	TABLE_CELL_ELEMENTS,
	URL_ATTRIBUTES,
	VOID_ELEMENTS,
} from './constants.js'
import { isHTMLCodePoint } from './validators.js'

/**
 * Normalizes an HTML input - CRLF and a lone carriage return to one newline, `U+0000` to
 * `U+FFFD` - and maps each normalized boundary to its original UTF-16 offset.
 *
 * @param html - The original HTML input
 * @returns The normalized source and its boundary-to-original offset map
 */
export function normalizeSource(html: string): HTMLSource {
	const segments = [...html.matchAll(/\r\n|[\s\S]/g)].map((match) => {
		const newline = match[0] === '\r\n' || match[0] === '\r'
		return {
			value: newline ? '\n' : match[0] === '\0' ? '\uFFFD' : match[0],
			end: match.index + match[0].length,
		}
	})
	return [
		segments.map((segment) => segment.value).join(''),
		[0, ...segments.map((segment) => segment.end)],
	]
}

/**
 * Projects a normalized half-open region through an original-input boundary map.
 *
 * @param offsets - The boundary map returned by {@link normalizeSource}
 * @param start - The inclusive normalized-source offset
 * @param end - The exclusive normalized-source offset
 * @returns The matching original-input region
 */
export function projectSpan(
	offsets: readonly number[],
	start: number,
	end: number,
): HTMLSpan | undefined {
	const originalStart = offsets[start]
	const originalEnd = offsets[end]
	return originalStart === undefined || originalEnd === undefined
		? undefined
		: { start: originalStart, end: originalEnd }
}

/**
 * Finds the deepest open occurrence of an element name across the parser's represented and
 * depth-overflow stacks.
 *
 * @remarks
 * The overflow stack holds the elements the depth cap refused to represent, so every
 * position recorded there sits deeper than every represented position. An occurrence in
 * overflow therefore wins outright, and only its absence makes the represented stack the
 * answer.
 *
 * @param represented - Each name's recorded positions on the represented element stack
 * @param overflow - Each name's recorded positions on the depth-overflow stack
 * @param name - The lowercased element name
 * @returns The deepest occurrence and the stack that recorded it, or `undefined` when the
 * name has no open occurrence
 *
 * @example
 * ```ts
 * import { findOpenPosition } from '@orkestrel/html'
 *
 * const represented = new Map([['p', [1]]])
 * findOpenPosition(represented, new Map(), 'p') // { overflow: false, position: 1 }
 * findOpenPosition(represented, new Map([['p', [0, 3]]]), 'p') // { overflow: true, position: 3 }
 * findOpenPosition(represented, new Map(), 'div') // undefined
 * ```
 */
export function findOpenPosition(
	represented: ReadonlyMap<string, readonly number[]>,
	overflow: ReadonlyMap<string, readonly number[]>,
	name: string,
): HTMLOpenPosition | undefined {
	const overflowPositions = overflow.get(name)
	const overflowPosition = overflowPositions?.[overflowPositions.length - 1]
	if (overflowPosition !== undefined) return { overflow: true, position: overflowPosition }
	const representedPositions = represented.get(name)
	const representedPosition = representedPositions?.[representedPositions.length - 1]
	return representedPosition === undefined
		? undefined
		: { overflow: false, position: representedPosition }
}

/**
 * Projects one stack position onto the single depth scale the represented and depth-overflow
 * stacks compare on, so an overflow position ranks below every represented one.
 *
 * @param overflow - If `true`, the position indexes the overflow stack and is measured from
 * the represented stack's height; if `false`, it indexes the represented stack directly
 * @param position - The recorded position within its own stack
 * @param height - The represented element stack's height
 * @returns The comparable depth
 *
 * @example
 * ```ts
 * import { projectDepth } from '@orkestrel/html'
 *
 * projectDepth(false, 2, 5) // 2 - a represented position is already comparable
 * projectDepth(true, 2, 5) // 7 - every overflow position sits below the whole stack
 * ```
 */
export function projectDepth(overflow: boolean, position: number, height: number): number {
	return overflow ? height + position : position
}

/**
 * Lowercases only ASCII uppercase characters, preserving every other code point exactly.
 *
 * @remarks
 * The strict and the recovering scanners share this one fold, so a later syntax error can
 * never change how a name was normalized.
 *
 * @param value - The source value
 * @returns The value with `A` through `Z` lowercased
 */
export function lowercaseASCII(value: string): string {
	return value.replace(/[A-Z]/g, (character) => character.toLowerCase())
}

/**
 * Determines whether an element name is void, matching `VOID_ELEMENTS` without case
 * sensitivity.
 *
 * @param name - The element name
 * @returns True if the canonical element set declares the name void; false otherwise
 */
export function isVoidElement(name: string): boolean {
	return VOID_ELEMENTS.includes(name.toLowerCase())
}

/**
 * Determines whether an element name contains verbatim raw text - `script` or `style`, the
 * parser's no-scanning boundary and the renderer's refusal boundary.
 *
 * @param name - The element name
 * @returns True if the name is `script` or `style`; false otherwise
 */
export function isRawElement(name: string): boolean {
	return RAW_ELEMENTS.includes(name.toLowerCase())
}

/**
 * Determines whether an element name contains decoded literal text - `title` or `textarea`,
 * whose body is one text node with character references resolved.
 *
 * @param name - The element name
 * @returns True if the name is `title` or `textarea`; false otherwise
 */
export function isLiteralElement(name: string): boolean {
	return LITERAL_ELEMENTS.includes(name.toLowerCase())
}

/**
 * Determines whether an element name is a block boundary, matching `BLOCK_ELEMENTS`.
 *
 * @param name - The element name
 * @returns True if the canonical block set contains the name; false otherwise
 */
export function isBlockElement(name: string): boolean {
	return BLOCK_ELEMENTS.includes(name.toLowerCase())
}

/**
 * Checks whether an element has no child nodes - the predicate the distill pass consults
 * before dropping an empty non-void element.
 *
 * @param element - The element to inspect
 * @returns True if `children` is empty; false otherwise
 */
export function isEmptyElement(element: ElementNode): boolean {
	return element.children.length === 0
}

/**
 * Decodes numeric and semicolon-terminated WHATWG named character references in a string.
 *
 * @remarks
 * A numeric reference naming an invalid scalar decodes to `U+FFFD`. An unknown named
 * reference stays literal, exactly as the source wrote it.
 *
 * @param value - The source text or attribute value
 * @returns The decoded value, retaining unknown named references literally
 */
export function decodeEntities(value: string): string {
	const parts: string[] = []
	Iterator.from(value.matchAll(/[\s\S]/g)).reduce((next, match) => {
		const index = match.index
		if (index < next) return next
		if (value[index] !== '&') {
			parts.push(value[index] ?? '')
			return index + 1
		}
		if (value[index + 1] === '#') {
			const hexadecimal = value[index + 2] === 'x' || value[index + 2] === 'X'
			const radix = hexadecimal ? 16 : 10
			const digits = index + (hexadecimal ? 3 : 2)
			const end = scanHTMLIndex(digits, value.length, (position) =>
				(radix === 16 ? /[0-9A-Fa-f]/ : /[0-9]/).test(value[position] ?? ''),
			)
			if (end > digits && value[end] === ';') {
				const scalar = Number.parseInt(value.slice(digits, end), radix)
				parts.push(
					isFiniteNumber(scalar) &&
						scalar > 0 &&
						scalar <= 0x10ffff &&
						!(scalar >= 0xd800 && scalar <= 0xdfff)
						? String.fromCodePoint(scalar)
						: '\uFFFD',
				)
				return end + 1
			}
			parts.push(value.slice(index, end))
			return end
		}
		const name = index + 1
		const end = scanHTMLIndex(name, value.length, (position) =>
			/[A-Za-z0-9]/.test(value[position] ?? ''),
		)
		if (end > name && value[end] === ';') {
			const key = value.slice(name, end)
			const entity = Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : undefined
			parts.push(entity ?? value.slice(index, end + 1))
			return end + 1
		}
		parts.push('&')
		return index + 1
	}, 0)
	return parts.join('')
}

/**
 * Scans an attribute source segment into ordered, ASCII-lowercased, first-wins attributes
 * with decoded values.
 *
 * @remarks
 * An unterminated quoted value minimizes to an absent value rather than to invented text.
 *
 * @param source - The part of a start tag after its name and before `>`
 * @returns Parsed attributes with ASCII-lowercased names and decoded values
 */
export function scanAttributes(source: string): readonly HTMLAttribute[] {
	const attributes: HTMLAttribute[] = []
	const names = new Map<string, number>()
	Iterator.from(source.matchAll(/[\s\S]/g)).reduce((next, match) => {
		if (match.index < next) return next
		const start = scanHTMLIndex(next, source.length, (index) =>
			HTML_WHITESPACE.includes(source[index] ?? ''),
		)
		if (start >= source.length || source[start] === '/') return source.length
		const end = scanHTMLIndex(start, source.length, (index) => {
			const character = source[index] ?? ''
			return (
				!HTML_WHITESPACE.includes(character) && !['=', '/', '"', "'", '<', '>'].includes(character)
			)
		})
		if (end === start) return start + 1
		const name = lowercaseASCII(source.slice(start, end))
		const boundary = scanHTMLIndex(end, source.length, (index) =>
			HTML_WHITESPACE.includes(source[index] ?? ''),
		)
		const assigned = source[boundary] === '='
		const valueStart = assigned
			? scanHTMLIndex(boundary + 1, source.length, (index) =>
					HTML_WHITESPACE.includes(source[index] ?? ''),
				)
			: boundary
		const quote = source[valueStart]
		const quoted = assigned && (quote === '"' || quote === "'")
		const content = valueStart + (quoted ? 1 : 0)
		const finish = assigned
			? scanHTMLIndex(content, source.length, (index) =>
					quoted ? source[index] !== quote : !HTML_WHITESPACE.includes(source[index] ?? ''),
				)
			: boundary
		const value =
			assigned && (quoted ? finish < source.length : finish > content)
				? decodeEntities(source.slice(content, finish))
				: undefined
		if (!names.has(name)) {
			names.set(name, start)
			attributes.push(value === undefined ? { name } : { name, value })
		}
		return finish + (quoted && finish < source.length ? 1 : 0)
	}, 0)
	return attributes
}

/**
 * Parses one unambiguous start tag without recovery under the package's ASCII tag-name grammar.
 *
 * @remarks
 * Duplicate or malformed attributes, ambiguous delimiters, an invalid offset, a close tag,
 * and incomplete input each produce no value: this is the fail-closed source boundary, and
 * it never recovers the way the document walk does.
 *
 * @param html - The exact HTML source
 * @param offset - The UTF-16 offset of the opening `<`
 * @returns The start tag and exact next offset, or `undefined` for malformed or incomplete source
 */
export function parseStartTag(html: string, offset: number): HTMLStartTag | undefined {
	if (!isInteger(offset) || offset < 0 || html[offset] !== '<') return undefined
	const nameStart = offset + 1
	if (!/[A-Za-z]/.test(html[nameStart] ?? '')) return undefined
	const nameEnd = scanHTMLIndex(nameStart, html.length, (index) =>
		/[A-Za-z0-9:-]/.test(html[index] ?? ''),
	)
	const name = lowercaseASCII(html.slice(nameStart, nameEnd))
	const steps: Array<{
		readonly next: number
		readonly separated: boolean
		readonly attribute: HTMLAttribute
	}> = []
	const names = new Map<string, number>()
	for (;;) {
		const state = steps.at(-1) ?? { next: nameEnd, separated: false }
		const boundary = html[state.next]
		if (
			boundary !== '>' &&
			boundary !== '/' &&
			!state.separated &&
			(boundary === undefined || !HTML_WHITESPACE.includes(boundary))
		) {
			return undefined
		}
		const index =
			boundary !== '>' && boundary !== '/' && !state.separated
				? scanHTMLIndex(state.next, html.length, (position) =>
						HTML_WHITESPACE.includes(html[position] ?? ''),
					)
				: state.next
		const following = html[index]
		if (following === '>' || following === '/') {
			if (following === '/' && html[index + 1] !== '>') return undefined
			return {
				name,
				attributes: steps.map((step) => step.attribute),
				slashed: following === '/',
				next: index + (following === '/' ? 2 : 1),
			}
		}
		if (following === undefined) return undefined
		const end = scanHTMLIndex(index, html.length, (position) => {
			const character = html[position]
			if (
				character === undefined ||
				HTML_WHITESPACE.includes(character) ||
				['=', '/', '>', '"', "'", '<'].includes(character)
			) {
				return false
			}
			return (
				isHTMLCodePoint(html.codePointAt(position)) ||
				(position > index && (html.codePointAt(position - 1) ?? 0) > 0xffff)
			)
		})
		const delimiter = html[end]
		if (
			end === index ||
			(delimiter !== undefined &&
				!HTML_WHITESPACE.includes(delimiter) &&
				delimiter !== '=' &&
				delimiter !== '/' &&
				delimiter !== '>')
		) {
			return undefined
		}
		const attributeName = lowercaseASCII(html.slice(index, end))
		if (names.has(attributeName)) return undefined
		names.set(attributeName, index)
		const valueStart = scanHTMLIndex(end, html.length, (position) =>
			HTML_WHITESPACE.includes(html[position] ?? ''),
		)
		if (html[valueStart] !== '=') {
			steps.push({
				next: valueStart,
				separated: valueStart > end,
				attribute: { name: attributeName },
			})
			continue
		}
		const content = scanHTMLIndex(valueStart + 1, html.length, (position) =>
			HTML_WHITESPACE.includes(html[position] ?? ''),
		)
		const scanned = scanHTMLAttributeValue(html, content)
		if (scanned === undefined) return undefined
		steps.push({
			next: scanned[1],
			separated: false,
			attribute: { name: attributeName, value: scanned[0] },
		})
	}
}

/**
 * Scans one complete start or close tag.
 *
 * @remarks
 * A trailing solidus is dropped rather than recorded, and an unterminated quoted value
 * recovers at the next `>` instead of trusting the markup that follows it.
 *
 * @param html - The normalized HTML source
 * @param offset - The offset of the opening `<`
 * @returns The tag and next offset, or `undefined` for an invalid or incomplete tag
 */
export function scanTag(html: string, offset: number): HTMLTag | undefined {
	if (html[offset] !== '<') return undefined
	const final = html[offset + 1] === '/'
	if (!final) {
		const parsed = parseStartTag(html, offset)
		if (parsed !== undefined) {
			return { name: parsed.name, attributes: parsed.attributes, final: false, next: parsed.next }
		}
	}
	const start = offset + (final ? 2 : 1)
	if (!/[A-Za-z]/.test(html[start] ?? '')) return undefined
	const attributesStart = scanHTMLIndex(start, html.length, (index) =>
		/[A-Za-z0-9:-]/.test(html[index] ?? ''),
	)
	const name = lowercaseASCII(html.slice(start, attributesStart))
	const parts: Array<{ readonly next: number; readonly value: string }> = []
	for (;;) {
		const index = parts.at(-1)?.next ?? attributesStart
		if (!(index < html.length)) return undefined
		const character = html[index]
		if (character === '>') {
			const source = parts.map((part) => part.value).join('')
			const trailing = scanHTMLIndex(0, source.length, (position) =>
				HTML_WHITESPACE.includes(source[source.length - position - 1] ?? ''),
			)
			const trimmed = source.slice(0, source.length - trailing)
			const attributes =
				trimmed.endsWith('/') &&
				(trimmed.length === 1 || HTML_WHITESPACE.includes(trimmed[trimmed.length - 2] ?? ''))
					? trimmed.slice(0, -1)
					: source
			return { name, attributes: final ? [] : scanAttributes(attributes), final, next: index + 1 }
		}
		if (character !== '"' && character !== "'") {
			parts.push({ next: index + 1, value: html[index] ?? '' })
			continue
		}
		const end = scanHTMLIndex(index + 1, html.length, (position) => {
			return html[position] !== character && html[position] !== '<'
		})
		if (html[end] === character) {
			parts.push({ next: end + 1, value: html.slice(index, end + 1) })
			continue
		}
		const first = html.indexOf('>', index + 1)
		const recovery =
			first >= 0 && first < end
				? first
				: scanHTMLIndex(end, html.length, (position) => html[position] !== '>')
		if (html[recovery] !== '>') return undefined
		const source = [...parts.map((part) => part.value), html.slice(index, recovery)].join('')
		return {
			name,
			attributes: final ? [] : scanAttributes(source),
			final,
			next: recovery + 1,
		}
	}
}

/**
 * Scans a standard or bogus HTML comment.
 *
 * @remarks
 * The bogus forms - `<?…>`, a non-doctype `<!…>`, and a CDATA section - recover to the same
 * comment node, and an unterminated comment runs to the end of input. Every value produced
 * here is representable: it never begins with an abrupt close and never contains one.
 *
 * @param html - The normalized HTML source
 * @param offset - The offset of the opening `<`
 * @returns The comment node and next offset, or `undefined` when no comment starts here
 */
export function scanComment(html: string, offset: number): HTMLScan<CommentNode> | undefined {
	if (html.startsWith('<!--', offset)) {
		const start = offset + 4
		if (html[start] === '>') {
			return { node: { category: 'comment', value: '' }, next: start + 1 }
		}
		if (html[start] === '-' && html[start + 1] === '>') {
			return { node: { category: 'comment', value: '' }, next: start + 2 }
		}
		const index = scanHTMLIndex(start, html.length, (position) => {
			return !html.startsWith('-->', position) && !html.startsWith('--!>', position)
		})
		if (index < html.length) {
			return {
				node: { category: 'comment', value: html.slice(start, index) },
				next: index + (html.startsWith('-->', index) ? 3 : 4),
			}
		}
		return { node: { category: 'comment', value: html.slice(start) }, next: html.length }
	}
	if (!html.startsWith('<!', offset) && !html.startsWith('<?', offset)) return undefined
	const end = scanHTMLIndex(offset + 2, html.length, (index) => html[index] !== '>')
	return end >= html.length
		? { node: { category: 'comment', value: html.slice(offset + 2) }, next: html.length }
		: {
				node: { category: 'comment', value: html.slice(offset + 2, end) },
				next: end + 1,
			}
}

/**
 * Scans an HTML doctype with optional public and system identifiers.
 *
 * @param html - The normalized HTML source
 * @param offset - The offset of the opening `<`
 * @returns The doctype node and next offset, or `undefined` for a non-doctype or incomplete input
 */
export function scanDoctype(html: string, offset: number): HTMLScan<DoctypeNode> | undefined {
	if (!isInteger(offset) || lowercaseASCII(html.slice(offset, offset + 9)) !== '<!doctype') {
		return undefined
	}
	const boundary = html[offset + 9]
	if (boundary !== undefined && boundary !== '>' && !HTML_WHITESPACE.includes(boundary)) {
		return undefined
	}
	const steps: Array<{ readonly value: string; readonly quote: string | undefined }> = []
	const close = Iterator.from(html.slice(offset + 9).matchAll(/[\s\S]/g)).find((match) => {
		const quote = steps.at(-1)?.quote
		const character = match[0]
		if (quote === undefined && character === '>') return true
		const opener = character === '"' || character === "'" ? character : undefined
		const following = quote === undefined ? opener : character === quote ? undefined : quote
		steps.push({ value: character, quote: following })
		return false
	})
	if (close === undefined) return undefined
	const end = offset + 9 + close.index
	const body = steps.map((step) => step.value).join('')
	const nameStart = scanHTMLIndex(0, body.length, (index) =>
		HTML_WHITESPACE.includes(body[index] ?? ''),
	)
	const nameEnd = scanHTMLIndex(nameStart, body.length, (index) => {
		return !HTML_WHITESPACE.includes(body[index] ?? '')
	})
	const name = lowercaseASCII(body.slice(nameStart, nameEnd))
	if (name.length === 0) return undefined
	const keywordStart = scanHTMLIndex(nameEnd, body.length, (index) =>
		HTML_WHITESPACE.includes(body[index] ?? ''),
	)
	const keywordEnd = scanHTMLIndex(keywordStart, body.length, (index) =>
		/[A-Za-z]/.test(body[index] ?? ''),
	)
	const keyword = lowercaseASCII(body.slice(keywordStart, keywordEnd))
	const start = scanHTMLIndex(keywordEnd, body.length, (index) =>
		HTML_WHITESPACE.includes(body[index] ?? ''),
	)
	const quote = body[start]
	const quoted = quote === '"' || quote === "'"
	const identifierEnd = quoted
		? scanHTMLIndex(start + 1, body.length, (index) => body[index] !== quote)
		: start
	const identifier =
		quoted && identifierEnd < body.length ? body.slice(start + 1, identifierEnd) : undefined
	const publicIdentifier = keyword === 'public' ? identifier : undefined
	const systemStart =
		publicIdentifier === undefined
			? start
			: scanHTMLIndex(identifierEnd + 1, body.length, (index) =>
					HTML_WHITESPACE.includes(body[index] ?? ''),
				)
	const systemQuote = body[systemStart]
	const systemQuoted = systemQuote === '"' || systemQuote === "'"
	const systemEnd = systemQuoted
		? scanHTMLIndex(systemStart + 1, body.length, (index) => body[index] !== systemQuote)
		: systemStart
	const systemIdentifier =
		keyword === 'system'
			? identifier
			: publicIdentifier !== undefined && systemQuoted && systemEnd < body.length
				? body.slice(systemStart + 1, systemEnd)
				: undefined
	const node: DoctypeNode = {
		category: 'doctype',
		name,
		...(publicIdentifier === undefined ? {} : { public: publicIdentifier }),
		...(systemIdentifier === undefined ? {} : { system: systemIdentifier }),
	}
	return { node, next: end + 1 }
}

/**
 * Scans text through the case-insensitive matching close tag of a raw or literal element.
 *
 * @param html - The normalized HTML source
 * @param offset - The first content offset after the start tag
 * @param name - The lowercased element name
 * @param entities - If `true`, decodes character references in the scanned text; if `false`,
 * keeps the text verbatim. Default: `false`
 * @returns The text child, its source region, next offset, and whether a complete close was found
 */
export function scanRawText(
	html: string,
	offset: number,
	name: string,
	entities = false,
): HTMLRawText {
	const marker = `</${lowercaseASCII(name)}`
	const attempts: Array<{ readonly next: number; readonly span: HTMLSpan | undefined }> = []
	if (offset < html.length) {
		const start = Math.max(0, Math.trunc(offset))
		for (const match of html.slice(start).matchAll(/</g)) {
			const candidate = start + match.index
			const next = attempts.at(-1)?.next ?? start
			if (candidate < next) continue
			if (lowercaseASCII(html.slice(candidate, candidate + marker.length)) !== marker) {
				attempts.push({ next: candidate + 1, span: undefined })
				continue
			}
			const boundary = html[candidate + marker.length]
			if (boundary !== '>' && (boundary === undefined || !HTML_WHITESPACE.includes(boundary))) {
				attempts.push({ next: candidate + marker.length, span: undefined })
				continue
			}
			const end = html.indexOf('>', candidate + marker.length)
			if (end < 0) break
			attempts.push({ next: end + 1, span: { start: offset, end: candidate } })
			break
		}
	}
	const found = attempts.find((entry) => entry.span !== undefined)
	const span = found?.span ?? { start: offset, end: html.length }
	const value = html.slice(offset, span.end)
	return {
		node: { category: 'text', value: entities ? decodeEntities(value) : value },
		span,
		next: found?.next ?? html.length,
		closed: found !== undefined,
	}
}

/**
 * Encodes the characters that have markup meaning in HTML text - `&`, `<`, and `>`, and
 * nothing else.
 *
 * @param value - The literal text
 * @returns The minimally encoded HTML text
 */
export function encodeText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Encodes the characters that have markup meaning in a double-quoted HTML attribute - `&`
 * and `"`, and nothing else.
 *
 * @param value - The literal attribute value
 * @returns The minimally encoded attribute value
 */
export function encodeAttribute(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/**
 * Decodes and inspects a URL against an explicit scheme allowlist and a fixed dangerous floor.
 *
 * @remarks
 * Entity decoding repeats to a small bounded fixpoint so a hand-built AST cannot defer a
 * dangerous scheme to a later serialize-reparse pass. Input that still changes after the
 * bound fails closed. This is the transform half of the URL floor {@link isSafeURL} shares,
 * and either shape of allowlist works: the frozen constant array, or the `ReadonlySet` a
 * caller passes through `HTMLSanitizeOptions`.
 *
 * @param value - The source URL, possibly containing HTML entities or obfuscating controls
 * @param schemes - The allowed lowercase absolute schemes
 * @returns The decoded, control-free URL, or `''` when it is unsafe
 */
export function sanitizeURL(
	value: string,
	schemes: ReadonlySet<string> | readonly string[],
): string {
	const outcome = attempt(() => {
		const initial = { value, stable: false }
		const passes = Array.from({ length: 8 }).reduce<typeof initial>((state) => {
			if (state.stable) return state
			const decoded = decodeEntities(state.value)
			return { value: decoded, stable: decoded === state.value }
		}, initial)
		if (!passes.stable && decodeEntities(passes.value) !== passes.value) return ''
		const cleaned = Iterator.from(passes.value)
			.filter((character) => {
				const point = character.codePointAt(0)
				return point !== undefined && point > 0x20 && !(point >= 0x7f && point <= 0x9f)
			})
			.toArray()
			.join('')
		const first = cleaned[0]
		const second = cleaned[1]
		if ((first === '/' || first === '\\') && (second === '/' || second === '\\')) return ''
		const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned)
		if (match === null) return cleaned
		const scheme = (match[1] ?? '').toLowerCase()
		const has = Reflect.get(schemes, 'has')
		const allowed = isFunction(has)
			? Reflect.apply(has, schemes, [scheme]) === true
			: Reflect.apply(Array.prototype.includes, schemes, [scheme]) === true
		if (
			scheme === 'javascript' ||
			scheme === 'data' ||
			scheme === 'vbscript' ||
			scheme === 'file' ||
			!allowed
		) {
			return ''
		}
		return cleaned
	})
	return outcome.success ? outcome.value : ''
}

/**
 * Determines whether a URL is relative or uses an allowed non-dangerous scheme.
 *
 * @remarks
 * The predicate half of the URL floor, true exactly when {@link sanitizeURL} keeps a
 * non-empty value. A relative URL is allowed; a protocol-relative one (`//`, `\\`, `/\`,
 * `\/`) is not; and `javascript:`, `data:`, `vbscript:`, and `file:` are refused whatever
 * the allowlist says.
 *
 * @param value - The already entity-decoded URL value
 * @param schemes - The allowed absolute schemes. Default: `SAFE_URL_SCHEMES`
 * @returns True if the URL passes the sanitizer's protocol floor; false otherwise
 */
export function isSafeURL(
	value: string,
	schemes: ReadonlySet<string> | readonly string[] = SAFE_URL_SCHEMES,
): boolean {
	return sanitizeURL(value, schemes) !== ''
}

/**
 * Resolves a URL through the platform WHATWG URL implementation.
 *
 * @param value - The relative or absolute URL
 * @param base - The absolute base URL
 * @returns The resolved URL, or the original value when resolution fails
 */
export function resolveURL(value: string, base: string): string {
	const outcome = attempt(() => new URL(value, base).href)
	return outcome.success ? outcome.value : value
}

/**
 * Finds an element attribute without case sensitivity.
 *
 * @remarks
 * A valueless attribute returns `''`, preserving the observable distinction between
 * presence and absence for callers.
 *
 * @param node - The element to inspect
 * @param name - The attribute name
 * @returns Its value, `''` for a present valueless attribute, or `undefined` when absent
 */
export function attributeOf(node: ElementNode, name: string): string | undefined {
	const outcome = attempt((): string | undefined => {
		const expected = name.toLowerCase()
		for (const attribute of node.attributes) {
			if (attribute.name.toLowerCase() === expected) return attribute.value ?? ''
		}
		return undefined
	})
	return outcome.success ? outcome.value : undefined
}

/**
 * Filters an element's attributes down to the ones a sanitized document may carry.
 *
 * @remarks
 * The allowlist narrows what is kept, but fixed refusals hold whatever it contains: a
 * handler attribute (any case-insensitive `on*` name), a scripting or styling channel
 * (`style`, `srcdoc`), a namespaced or `xmlns` name, and a structurally unwritable name are
 * always removed. An `align` value is narrowed to {@link TABLE_ALIGNMENTS} on
 * {@link TABLE_CELL_ELEMENTS}, and a {@link URL_ATTRIBUTES} value is passed through
 * {@link sanitizeURL}; either attribute is removed - not emptied - when its extra rule
 * fails. Names are ASCII-lowercased, a duplicate keeps its first occurrence, source order
 * is preserved, and a valueless attribute stays valueless.
 *
 * @param node - The element whose attributes are being filtered
 * @param attributes - The allowed lowercase attribute names
 * @param schemes - The allowed lowercase absolute URL schemes
 * @returns The attributes a sanitized element keeps, in source order
 */
export function sanitizeAttributes(
	node: ElementNode,
	attributes: ReadonlySet<string> | readonly string[],
	schemes: ReadonlySet<string> | readonly string[],
): readonly HTMLAttribute[] {
	const outcome = attempt((): readonly HTMLAttribute[] => {
		const kept: HTMLAttribute[] = []
		const names = new Map<string, number>()
		const has = Reflect.get(attributes, 'has')
		for (const [index, attribute] of Iterator.from(node.attributes).map(
			(entry, position): readonly [number, HTMLAttribute] => [position, entry],
		)) {
			const name = attribute.name.toLowerCase()
			if (names.has(name)) continue
			names.set(name, index)
			if (
				name.length === 0 ||
				/[\s"'/:<=>]/.test(name) ||
				name.startsWith('on') ||
				name === 'style' ||
				name === 'srcdoc' ||
				name === 'xmlns' ||
				!(isFunction(has)
					? Reflect.apply(has, attributes, [name]) === true
					: Reflect.apply(Array.prototype.includes, attributes, [name]) === true)
			) {
				continue
			}
			if (name === 'align') {
				const value = attribute.value?.trim().toLowerCase()
				if (
					value !== undefined &&
					TABLE_CELL_ELEMENTS.includes(node.name.toLowerCase()) &&
					TABLE_ALIGNMENTS.includes(value)
				) {
					kept.push({ name, value })
				}
				continue
			}
			if (!URL_ATTRIBUTES.includes(name)) {
				kept.push(attribute.value === undefined ? { name } : { name, value: attribute.value })
				continue
			}
			const url = sanitizeURL(attribute.value ?? '', schemes)
			if (url.length > 0) kept.push({ name, value: url })
		}
		return kept
	})
	return outcome.success ? outcome.value : []
}

/**
 * Resolves an element's URL attributes against a base URL.
 *
 * @remarks
 * Every {@link URL_ATTRIBUTES} value is resolved through {@link resolveURL}, so an absolute
 * value stays itself and an unresolvable one is left exactly as written. Other attributes
 * pass through with their names ASCII-lowercased.
 *
 * @param node - The element whose URL attributes are being resolved
 * @param base - The absolute base URL
 * @returns The element's attributes with every URL value resolved, in source order
 */
export function resolveAttributes(node: ElementNode, base: string): readonly HTMLAttribute[] {
	const outcome = attempt((): readonly HTMLAttribute[] =>
		Iterator.from(node.attributes)
			.map((attribute): HTMLAttribute => {
				const name = attribute.name.toLowerCase()
				if (URL_ATTRIBUTES.includes(name) && attribute.value !== undefined) {
					return { name, value: resolveURL(attribute.value, base) }
				}
				return attribute.value === undefined ? { name } : { name, value: attribute.value }
			})
			.toArray(),
	)
	return outcome.success ? outcome.value : node.attributes
}

/**
 * Collapses a run of whitespace to one inter-word space and removes edge whitespace.
 *
 * @param value - Text containing arbitrary whitespace
 * @returns The collapsed text
 */
export function collapseSpace(value: string): string {
	return value.replace(/\s+/g, ' ').trim()
}

/**
 * Serializes an HTML node to canonical, safety-bounded HTML.
 *
 * @remarks
 * Never throws: it refuses a construct rather than emit an unsafe one. Invalid element
 * names unwrap to their children. Raw-text bodies containing their own matching close-tag
 * sequence are dropped. Descent stops after {@link MAX_DEPTH}.
 *
 * @param node - The node or document to serialize
 * @returns Canonical HTML, or `''` if a hostile value prevents serialization
 */
export function renderHTML(node: HTMLNode): string {
	const outcome = attempt(() => {
		const stack: Array<{
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}> = [{ node, depth: -1, expanded: false, count: 0 }]
		const values: string[] = []
		const visited = new WeakSet<object>()
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (!frame.expanded) {
				if (visited.has(current)) {
					stack.push({ ...frame, expanded: true, count: 0 })
					continue
				}
				visited.add(current)
				const children =
					frame.depth < MAX_DEPTH &&
					(current.category === 'document' ||
						(current.category === 'element' && !RAW_ELEMENTS.includes(current.name.toLowerCase())))
						? Iterator.from(current.children)
								.filter((child) => child !== undefined)
								.toArray()
						: []
				stack.push({ ...frame, expanded: true, count: children.length })
				const depth = current.category === 'document' ? 0 : frame.depth + 1
				const length = children.length
				for (const offset of Array.from({ length }).keys()) {
					const index = length - offset - 1
					const child = children[index]
					if (child !== undefined) {
						stack.push({ node: child, depth, expanded: false, count: 0 })
					}
				}
				continue
			}
			const children =
				frame.count === 0 ? [] : values.splice(values.length - frame.count, frame.count)
			const value = renderHTMLPart(current, children)
			if (stack.length === 0) return value
			values.push(value)
		}
		return ''
	})
	return outcome.success ? outcome.value : ''
}

/**
 * Projects an HTML node to structural plain text.
 *
 * @remarks
 * Block and line-break elements contribute newline boundaries, adjacent table cells use
 * tabs, and adjacent table rows use newlines. Whitespace collapses outside `pre` elements
 * and remains verbatim inside them. Script and style bodies are excluded; title and
 * textarea text remains. Heading level, link destination, list marker, nesting depth, image
 * attributes, code fence, and code language are all lossy: this is the projection that
 * keeps the reading order and drops the rest.
 *
 * @param node - The node or document to project
 * @returns Structural plain text
 */
export function renderText(node: HTMLNode): string {
	const outcome = attempt(() => {
		const stack: Array<{
			readonly node: HTMLNode
			readonly depth: number
			readonly final: boolean
			readonly parent: ElementNode | undefined
			readonly table: ElementNode | undefined
			readonly preserved: boolean
		}> = [
			{
				node,
				depth: -1,
				final: false,
				parent: undefined,
				table: undefined,
				preserved: false,
			},
		]
		const segments: Array<{
			readonly value: string
			readonly mode: 'normal' | 'preserved' | 'cell' | 'row'
		}> = []
		const visited = new WeakSet<object>()
		const tables = new WeakSet<object>()
		const rows = new WeakSet<object>()
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (frame.final) {
				if (current.category === 'element') {
					const name = current.name.toLowerCase()
					const tableRole = name === 'tr' || TABLE_CELL_ELEMENTS.includes(name)
					if (!tableRole && (BLOCK_ELEMENTS.includes(name) || name === 'br')) {
						segments.push({ value: '\n', mode: 'normal' })
					}
				}
				continue
			}
			if (visited.has(current)) continue
			visited.add(current)
			if (current.category === 'text') {
				const value = frame.preserved ? current.value : current.value.replace(/\s+/g, ' ')
				if (frame.preserved || value !== '') {
					segments.push({ value, mode: frame.preserved ? 'preserved' : 'normal' })
				}
				continue
			}
			if (current.category !== 'document' && current.category !== 'element') continue
			const name = current.category === 'element' ? current.name.toLowerCase() : undefined
			if (name !== undefined && RAW_ELEMENTS.includes(name)) continue
			const table = current.category === 'element' && name === 'table' ? current : frame.table
			const preserved = frame.preserved || name === 'pre'
			if (name === 'tr' && table !== undefined) {
				if (tables.has(table)) segments.push({ value: '\n', mode: 'row' })
				else tables.add(table)
			}
			if (
				name !== undefined &&
				TABLE_CELL_ELEMENTS.includes(name) &&
				frame.parent !== undefined &&
				frame.parent.name.toLowerCase() === 'tr'
			) {
				if (rows.has(frame.parent)) segments.push({ value: '\t', mode: 'cell' })
				else rows.add(frame.parent)
			}
			const boundary =
				name !== undefined &&
				name !== 'tr' &&
				!TABLE_CELL_ELEMENTS.includes(name) &&
				(BLOCK_ELEMENTS.includes(name) || name === 'br')
			if (boundary) segments.push({ value: '\n', mode: 'normal' })
			if (frame.depth >= MAX_DEPTH) continue
			stack.push({
				node: current,
				depth: frame.depth,
				final: true,
				parent: frame.parent,
				table,
				preserved: frame.preserved,
			})
			const depth = current.category === 'document' ? 0 : frame.depth + 1
			const length = current.children.length
			for (const offset of Array.from({ length }).keys()) {
				const index = length - offset - 1
				const child = current.children[index]
				if (child !== undefined) {
					stack.push({
						node: child,
						depth,
						final: false,
						parent: current.category === 'element' ? current : undefined,
						table,
						preserved,
					})
				}
			}
		}
		const starts = segments.flatMap((segment, index) =>
			segment.mode === 'normal' && segments[index - 1]?.mode === 'normal' ? [] : [index],
		)
		const grouped = starts.flatMap((start, index) => {
			const first = segments[start]
			if (first === undefined) return []
			const value = segments
				.slice(start, starts[index + 1])
				.map((segment) => segment.value)
				.join('')
			return [{ value, mode: first.mode }]
		})
		return grouped
			.map((segment, index) => {
				if (segment.mode !== 'normal') return segment.value
				const normalized = segment.value
					.replace(/[ \t]*\n[ \t]*/g, '\n')
					.replace(/\n+/g, '\n')
					.replace(/ +/g, ' ')
				const previous = grouped[index - 1]
				const following = grouped[index + 1]
				const text =
					index === 0 || previous?.mode === 'cell' || previous?.mode === 'row'
						? normalized.trimStart()
						: normalized
				return index === grouped.length - 1 ||
					following?.mode === 'cell' ||
					following?.mode === 'row'
					? text.trimEnd()
					: text
			})
			.join('')
	})
	return outcome.success ? outcome.value : ''
}

/**
 * Walks an HTML node depth-first in pre-order, lazily and depth-bounded, including the
 * supplied root.
 *
 * @remarks
 * The deep traversal: `walk`, `find`, `filter`, and `reduce` all iterate this one generator,
 * so one ordering law covers the whole query surface.
 *
 * @param node - The root node
 * @returns A depth-bounded generator of visited nodes
 */
export function* walkNodes(node: HTMLNode): Generator<HTMLNode> {
	// The one exception boundary here that is not `attempt`: a generator yields from inside
	// its own body, and `attempt` returns a value rather than resuming a suspended frame, so
	// wrapping this body would collect the whole traversal eagerly instead of streaming it.
	try {
		const stack: Array<{ readonly node: HTMLNode; readonly depth: number }> = [{ node, depth: -1 }]
		const visited = new WeakSet<object>()
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			if (visited.has(frame.node)) continue
			visited.add(frame.node)
			yield frame.node
			if (
				frame.depth >= MAX_DEPTH ||
				(frame.node.category !== 'document' && frame.node.category !== 'element')
			) {
				continue
			}
			const depth = frame.node.category === 'document' ? 0 : frame.depth + 1
			const length = frame.node.children.length
			for (const offset of Array.from({ length }).keys()) {
				const index = length - offset - 1
				const child = frame.node.children[index]
				if (child !== undefined) stack.push({ node: child, depth })
			}
		}
	} catch {
		return
	}
}

/**
 * Folds an HTML node bottom-up through a total handler table - each node's children fold
 * first, then its own handler runs with those already-folded results.
 *
 * @remarks
 * A node at the depth cap is folded with an empty child result list.
 *
 * @param node - The root node
 * @param handlers - One handler for every HTML node category
 * @returns The folded value
 */
export function foldNode<T>(node: HTMLNode, handlers: HTMLHandlerMap<T>): T {
	const stack: Array<{
		readonly node: HTMLNode
		readonly depth: number
		readonly expanded: boolean
		readonly count: number
	}> = [{ node, depth: -1, expanded: false, count: 0 }]
	const values: T[] = []
	const visited = new WeakSet<object>()
	while (stack.length > 0) {
		const frame = stack.pop()
		if (frame === undefined) continue
		if (!frame.expanded) {
			if (visited.has(frame.node)) {
				stack.push({ ...frame, expanded: true, count: 0 })
				continue
			}
			visited.add(frame.node)
			const children =
				frame.depth < MAX_DEPTH &&
				(frame.node.category === 'document' || frame.node.category === 'element')
					? Iterator.from(frame.node.children)
							.filter((child) => child !== undefined)
							.toArray()
					: []
			stack.push({ ...frame, expanded: true, count: children.length })
			const depth = frame.node.category === 'document' ? 0 : frame.depth + 1
			const length = children.length
			for (const offset of Array.from({ length }).keys()) {
				const index = length - offset - 1
				const child = children[index]
				if (child !== undefined) {
					stack.push({ node: child, depth, expanded: false, count: 0 })
				}
			}
			continue
		}
		const children =
			frame.count === 0 ? [] : values.splice(values.length - frame.count, frame.count)
		const value =
			frame.node.category === 'document'
				? handlers.document(frame.node, children)
				: frame.node.category === 'element'
					? handlers.element(frame.node, children)
					: frame.node.category === 'text'
						? handlers.text(frame.node, children)
						: frame.node.category === 'comment'
							? handlers.comment(frame.node, children)
							: handlers.doctype(frame.node, children)
		if (stack.length === 0) return value
		values.push(value)
	}
	switch (node.category) {
		case 'document':
			return handlers.document(node, [])
		case 'element':
			return handlers.element(node, [])
		case 'text':
			return handlers.text(node, [])
		case 'comment':
			return handlers.comment(node, [])
		case 'doctype':
			return handlers.doctype(node, [])
	}
}

/**
 * Rewrites a document bottom-up with copy-on-write identity preservation.
 *
 * @remarks
 * The handler receives children after their rewrites. A subtree whose descendants and
 * own handler result are unchanged retains its original reference. Descent stops at
 * {@link MAX_DEPTH}; the capped subtree passes through unchanged.
 *
 * @param document - The document to rewrite
 * @param rewrite - The bottom-up rewrite handler
 * @returns The rewritten document and its operation-owned derivations; the input document
 * and an empty map if rewriting throws
 */
export function rewriteDocument(
	document: HTMLDocument,
	rewrite: HTMLRewriteHandler,
): HTMLDerivation<HTMLDocument> {
	const origins: HTMLOrigin[] = []
	const outputs = new Map<HTMLNode, HTMLNode>()
	const outcome = attempt((): HTMLDerivation<HTMLDocument> => {
		const stack: Array<{
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}> = [{ node: document, depth: -1, expanded: false, count: 0 }]
		const values: HTMLNode[] = []
		const visited = new WeakSet<object>()
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (!frame.expanded) {
				if (visited.has(current)) {
					stack.push({ ...frame, expanded: true, count: 0 })
					continue
				}
				visited.add(current)
				if (current.category !== 'document' && frame.depth >= MAX_DEPTH) {
					values.push(current)
					continue
				}
				const children =
					current.category === 'document' || current.category === 'element'
						? Iterator.from(current.children)
								.filter((child) => child !== undefined)
								.toArray()
						: []
				stack.push({ ...frame, expanded: true, count: children.length })
				const depth = current.category === 'document' ? 0 : frame.depth + 1
				const length = children.length
				for (const offset of Array.from({ length }).keys()) {
					const index = length - offset - 1
					const child = children[index]
					if (child !== undefined) {
						stack.push({ node: child, depth, expanded: false, count: 0 })
					}
				}
				continue
			}
			const children =
				frame.count === 0 ? [] : values.splice(values.length - frame.count, frame.count)
			const changed =
				(current.category === 'document' || current.category === 'element') &&
				(children.length !== current.children.length ||
					children.some((child, index) => child !== current.children[index]))
			const candidate: HTMLNode =
				changed && current.category === 'document'
					? { category: 'document', children }
					: changed && current.category === 'element'
						? {
								category: 'element',
								name: current.name,
								attributes: current.attributes,
								children,
							}
						: current
			if (candidate !== current) origins.push([candidate, current])
			const rewritten = rewrite(candidate)
			const source = outputs.get(rewritten)
			if (source === undefined) outputs.set(rewritten, current)
			else if (source !== current) origins.push([rewritten, undefined])
			if (rewritten !== candidate) origins.push([rewritten, current])
			if (stack.length === 0) {
				return [
					rewritten.category === 'document'
						? rewritten
						: candidate.category === 'document'
							? candidate
							: document,
					resolveDerivations(origins),
				]
			}
			values.push(rewritten)
		}
		return [document, resolveDerivations(origins)]
	})
	return outcome.success ? outcome.value : [document, new Map()]
}

/**
 * Restores the no-adjacent-text invariant in a rebuilt list of siblings.
 *
 * @remarks
 * Unwrapping an element splices its children into its parent's list, which can leave two
 * text nodes side by side - a shape the parser never produces, and one that would make a
 * document disagree with its own reparsed serialization. Adjacent text nodes are joined
 * into one and an empty text node is dropped; every other node passes through untouched.
 *
 * @param children - The rebuilt sibling list
 * @returns The list with adjacent text joined and empty text removed
 */
export function mergeText(children: readonly HTMLNode[]): readonly HTMLNode[] {
	const outcome = attempt((): readonly HTMLNode[] => {
		const nodes = Iterator.from(children)
			.filter(
				(child) => child !== undefined && (child.category !== 'text' || child.value.length > 0),
			)
			.toArray()
		const starts = nodes.flatMap((node, index) =>
			node.category === 'text' && nodes[index - 1]?.category === 'text' ? [] : [index],
		)
		return starts.map((start, index): HTMLNode => {
			const group = nodes.slice(start, starts[index + 1])
			const first = group[0]
			if (first === undefined) throw new Error('Missing sibling')
			if (first.category !== 'text' || group.length === 1) return first
			return {
				category: 'text',
				value: group.map((node) => (node.category === 'text' ? node.value : '')).join(''),
			}
		})
	})
	return outcome.success ? outcome.value : children
}

/**
 * Collapses the whitespace runs inside each direct text child of a sibling list.
 *
 * @remarks
 * Every run of whitespace becomes one space and edge whitespace is kept, because the space
 * between `<b>one</b>` and `<i>two</i>` is a word boundary rather than decoration. Applying
 * this at the element that keeps the text - never at one being unwrapped - is what leaves a
 * `pre` or `code` body verbatim while the surrounding prose collapses.
 *
 * @param children - The sibling list whose text children are collapsed
 * @returns The collapsed list and its operation-owned derivations
 */
export function collapseText(children: readonly HTMLNode[]): HTMLDerivation<readonly HTMLNode[]> {
	const outcome = attempt((): HTMLDerivation<readonly HTMLNode[]> => {
		const entries = Iterator.from(children)
			.filter((child) => child !== undefined)
			.map((child): readonly [HTMLNode, HTMLNode | undefined] =>
				child.category === 'text'
					? [{ category: 'text', value: child.value.replace(/\s+/g, ' ') }, child]
					: [child, undefined],
			)
			.toArray()
		return [
			entries.map(([node]) => node),
			new Map(entries.filter(([, source]) => source !== undefined)),
		]
	})
	return outcome.success ? outcome.value : [children, new Map()]
}

/**
 * Re-roots a document at the sole occurrence of one of the named region elements.
 *
 * @remarks
 * The names are tried in order and the first one occurring exactly once in the document
 * wins - its children become the new root's children, so everything outside the region is
 * discarded. A name that is absent, or that occurs more than once, is ambiguous evidence
 * and is skipped; when no name qualifies the document is returned unchanged.
 *
 * @param document - The document to re-root
 * @param names - The candidate region element names, most specific first
 * @returns The re-rooted document and its operation-owned derivations
 */
export function extractRegion(
	document: HTMLDocument,
	names: readonly string[],
): HTMLDerivation<HTMLDocument> {
	const outcome = attempt((): HTMLDerivation<HTMLDocument> => {
		for (const name of names) {
			const expected = name.toLowerCase()
			const matches = walkNodes(document)
				.filter((node): node is ElementNode => {
					return node.category === 'element' && node.name.toLowerCase() === expected
				})
				.take(2)
				.toArray()
			const region = matches[0]
			if (matches.length === 1 && region !== undefined) {
				const rooted: HTMLDocument = { category: 'document', children: region.children }
				return [rooted, new Map([[rooted, region]])]
			}
		}
		return [document, new Map()]
	})
	return outcome.success ? outcome.value : [document, new Map()]
}

/**
 * Rebuilds a document bottom-up, letting each node become any number of nodes - the
 * one-to-many spine the sanitize and distill engines share.
 *
 * @remarks
 * The dual of {@link rewriteDocument}: a rewrite maps one node to one node, while a prune
 * maps one node to a list - `[]` to drop it, `node.children` to unwrap it, `[node]` to keep
 * it, or any other list to replace it - which is the shape every allowlist, region drop, and
 * wrapper melt needs. As in {@link rewriteDocument} the handler receives each node with its
 * children already pruned and flattened, so keeping a node needs no reconstruction and a
 * subtree nothing changed keeps its reference. The root is handled last and its handler is
 * expected to return the rebuilt document; a result that is not one is treated as the new
 * root's children. Descent stops at {@link MAX_DEPTH}: a node at the cap is handed no
 * children, so a policy can never keep content it was unable to inspect - safety over
 * fidelity, and the same cap {@link foldNode} folds against.
 *
 * @param document - The document to rebuild
 * @param prune - The bottom-up handler mapping one node to the nodes that replace it
 * @returns The rebuilt document and its operation-owned derivations, or an empty document
 * and empty map if pruning throws
 */
export function pruneDocument(
	document: HTMLDocument,
	prune: HTMLPruneHandler,
): HTMLDerivation<HTMLDocument> {
	const origins: HTMLOrigin[] = []
	const outcome = attempt((): HTMLDerivation<HTMLDocument> => {
		const stack: Array<{
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}> = [{ node: document, depth: -1, expanded: false, count: 0 }]
		const results: Array<readonly HTMLNode[]> = []
		const visited = new WeakSet<object>()
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (!frame.expanded) {
				if (visited.has(current)) {
					stack.push({ ...frame, expanded: true, count: 0 })
					continue
				}
				visited.add(current)
				const children =
					frame.depth < MAX_DEPTH &&
					(current.category === 'document' || current.category === 'element')
						? Iterator.from(current.children)
								.filter((child) => child !== undefined)
								.toArray()
						: []
				stack.push({ ...frame, expanded: true, count: children.length })
				const depth = current.category === 'document' ? 0 : frame.depth + 1
				const length = children.length
				for (const offset of Array.from({ length }).keys()) {
					const index = length - offset - 1
					const child = children[index]
					if (child !== undefined) {
						stack.push({ node: child, depth, expanded: false, count: 0 })
					}
				}
				continue
			}
			const pruned =
				frame.count === 0 ? [] : results.splice(results.length - frame.count, frame.count)
			const children = Iterator.from(pruned)
				.flatMap((group) => Iterator.from(group))
				.toArray()
			const changed =
				(current.category === 'document' || current.category === 'element') &&
				(children.length !== current.children.length ||
					children.some((child, index) => child !== current.children[index]))
			const candidate: HTMLNode =
				changed && current.category === 'document'
					? { category: 'document', children }
					: changed && current.category === 'element'
						? {
								category: 'element',
								name: current.name,
								attributes: current.attributes,
								children,
							}
						: current
			if (candidate !== current) origins.push([candidate, current])
			const replacements = prune(candidate)
			if (replacements.length === 1) {
				const replacement = replacements[0]
				const child =
					replacement !== undefined &&
					(candidate.category === 'document' || candidate.category === 'element') &&
					candidate.children.includes(replacement)
				if (replacement !== undefined && replacement !== candidate && !child) {
					origins.push([replacement, current])
				}
			}
			if (stack.length === 0) {
				const root = replacements[0]
				if (root !== undefined && root.category === 'document') {
					return [root, resolveDerivations(origins)]
				}
				const rest = Iterator.from(replacements)
					.filter((node) => node.category !== 'document')
					.toArray()
				return [{ category: 'document', children: rest }, resolveDerivations(origins)]
			}
			results.push(replacements)
		}
		return [{ category: 'document', children: [] }, resolveDerivations(origins)]
	})
	return outcome.success ? outcome.value : [{ category: 'document', children: [] }, new Map()]
}

/**
 * Finds the first refused index in a numeric span with logarithmically bounded recursion.
 *
 * @param start - The inclusive first index
 * @param end - The exclusive limit
 * @param accept - The predicate evaluated in ascending index order
 * @returns The first refused index, or the boundary reached after accepting the span
 *
 * @example
 * ```ts
 * scanHTMLIndex(0, 4, (index) => index < 2) // 2
 * ```
 */
export function scanHTMLIndex(
	start: number,
	end: number,
	accept: (index: number) => boolean,
): number {
	if (!(start < end)) return start
	if (end - start <= 1) return accept(start) ? start + 1 : start
	const middle = start + Math.ceil((end - start) / 2)
	const left = scanHTMLIndex(start, middle, accept)
	return left < middle ? left : scanHTMLIndex(left, end, accept)
}

/**
 * Scans one complete quoted or unquoted attribute value under the strict token grammar.
 *
 * @param html - The source token
 * @param start - The value's first source offset, including its quote when quoted
 * @returns The decoded value and next offset, or undefined for an invalid value or delimiter
 *
 * @example
 * ```ts
 * scanHTMLAttributeValue('"a&amp;b">', 0) // ['a&b', 9]
 * ```
 */
export function scanHTMLAttributeValue(
	html: string,
	start: number,
): HTMLAttributeValue | undefined {
	const quote = html[start]
	const quoted = quote === '"' || quote === "'"
	const content = start + (quoted ? 1 : 0)
	const end = scanHTMLIndex(content, html.length, (index) => {
		const character = html[index]
		if (character === undefined) return false
		if (quoted ? character === quote : character === '>' || HTML_WHITESPACE.includes(character)) {
			return false
		}
		if (!quoted && ['"', "'", '<', '=', '`'].includes(character)) return false
		return (
			isHTMLCodePoint(html.codePointAt(index)) ||
			(index > content && (html.codePointAt(index - 1) ?? 0) > 0xffff)
		)
	})
	if (end >= html.length) return undefined
	if (quoted) {
		if (html[end] !== quote) return undefined
		const delimiter = html[end + 1]
		if (
			delimiter !== '>' &&
			delimiter !== '/' &&
			(delimiter === undefined || !HTML_WHITESPACE.includes(delimiter))
		) {
			return undefined
		}
		return [decodeEntities(html.slice(content, end)), end + 1]
	}
	const delimiter = html[end]
	if (
		end === content ||
		(delimiter !== '>' && (delimiter === undefined || !HTML_WHITESPACE.includes(delimiter)))
	) {
		return undefined
	}
	return [decodeEntities(html.slice(content, end)), end]
}

/**
 * Renders one HTML node from its already-rendered children.
 *
 * @param node - The node whose own markup to render
 * @param children - The rendered child values
 * @returns Canonical markup, with unsafe raw text and invalid leaf markup refused
 *
 * @example
 * ```ts
 * renderHTMLPart({ category: 'text', value: '<' }, []) // '&lt;'
 * ```
 */
export function renderHTMLPart(node: HTMLNode, children: readonly string[]): string {
	switch (node.category) {
		case 'document':
			return children.join('')
		case 'text':
			return encodeText(node.value)
		case 'comment':
			return node.value.includes('-->') ||
				node.value.includes('--!>') ||
				node.value.startsWith('>') ||
				node.value.startsWith('->')
				? ''
				: `<!--${node.value}-->`
		case 'doctype': {
			const name = node.name.toLowerCase()
			if (!/^[a-z][a-z0-9:-]*$/.test(name)) return ''
			const publicSafe =
				node.public !== undefined && (!node.public.includes('"') || !node.public.includes("'"))
			const systemSafe =
				node.system !== undefined && (!node.system.includes('"') || !node.system.includes("'"))
			const identifiers: string[] = []
			if (publicSafe && node.public !== undefined) {
				const quote = node.public.includes('"') ? "'" : '"'
				identifiers.push(` PUBLIC ${quote}${node.public}${quote}`)
				if (systemSafe && node.system !== undefined) {
					const systemQuote = node.system.includes('"') ? "'" : '"'
					identifiers.push(` ${systemQuote}${node.system}${systemQuote}`)
				}
			} else if (systemSafe && node.system !== undefined) {
				const quote = node.system.includes('"') ? "'" : '"'
				identifiers.push(` SYSTEM ${quote}${node.system}${quote}`)
			}
			return `<!DOCTYPE ${name}${identifiers.join('')}>`
		}
		case 'element': {
			const name = node.name.toLowerCase()
			if (!/^[a-z][a-z0-9:-]*$/.test(name)) return children.join('')
			const attributes = Iterator.from(node.attributes)
				.map((attribute) => {
					const key = attribute.name.toLowerCase()
					if (key.length === 0 || /[\s=/"':<>]/.test(key)) return ''
					return attribute.value === undefined
						? ` ${key}`
						: ` ${key}="${encodeAttribute(attribute.value)}"`
				})
				.toArray()
				.join('')
			if (VOID_ELEMENTS.includes(name)) return `<${name}${attributes}>`
			if (RAW_ELEMENTS.includes(name)) {
				const body = Iterator.from(node.children)
					.filter((child): child is TextNode => child.category === 'text')
					.map((child) => child.value)
					.toArray()
					.join('')
				const lower = body.toLowerCase()
				const marker = `</${name}`
				const unsafe = Iterator.from(lower.matchAll(/</g)).some((match) => {
					if (!lower.startsWith(marker, match.index)) return false
					const boundary = lower[match.index + marker.length]
					return boundary === '>' || (boundary !== undefined && /\s/.test(boundary))
				})
				return `<${name}${attributes}>${unsafe ? '' : body}</${name}>`
			}
			return `<${name}${attributes}>${children.join('')}</${name}>`
		}
	}
}

/**
 * Resolves recorded source identities, refusing a node with conflicting origins.
 *
 * @param origins - Source records in operation order
 * @returns Each derived node's sole source, or undefined for an ambiguous source
 *
 * @example
 * ```ts
 * const node: HTMLNode = { category: 'text', value: 'x' }
 * resolveDerivations([[node, node]]).get(node) // node
 * ```
 */
export function resolveDerivations(
	origins: Iterable<HTMLOrigin>,
): ReadonlyMap<HTMLNode, HTMLNode | undefined> {
	const groups = Map.groupBy(origins, ([node]) => node)
	return new Map(
		Array.from(groups, ([node, records]) => {
			const source = records[0]?.[1]
			return [node, records.every(([, origin]) => origin === source) ? source : undefined]
		}),
	)
}
