import type {
	CommentNode,
	DoctypeNode,
	ElementNode,
	HTMLAttribute,
	HTMLDerivation,
	HTMLDocument,
	HTMLHandlers,
	HTMLNode,
	HTMLPruneHandler,
	HTMLRawText,
	HTMLRewriteHandler,
	HTMLSpan,
	HTMLStartTag,
	HTMLTag,
	TextNode,
} from './types.js'
import {
	BLOCK_ELEMENTS,
	HTML_WHITESPACE,
	MAX_DEPTH,
	NAMED_ENTITIES,
	RAW_ELEMENTS,
	TABLE_ALIGNMENTS,
	TABLE_CELL_ELEMENTS,
	URL_ATTRIBUTES,
	VOID_ELEMENTS,
} from './constants.js'
import { isHTMLCodePoint } from './validators.js'

/**
 * Normalizes an HTML input and maps each normalized boundary to its original UTF-16 offset.
 *
 * @param html - The original HTML input
 * @returns The normalized source and its boundary-to-original offset map
 */
export function normalizeSource(
	html: string,
): readonly [source: string, offsets: readonly number[]] {
	let source = ''
	const offsets: number[] = [0]
	let index = 0
	while (index < html.length) {
		const character = html[index]
		if (character === '\r') {
			index += html[index + 1] === '\n' ? 2 : 1
			source += '\n'
			offsets.push(index)
			continue
		}
		source += character === '\0' ? '\uFFFD' : (character ?? '')
		index += 1
		offsets.push(index)
	}
	return [source, offsets]
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
 * Lowercase only ASCII uppercase characters, preserving every other code point exactly.
 *
 * @param value - The source value
 * @returns The value with `A` through `Z` lowercased
 */
export function lowercaseASCII(value: string): string {
	return value.replace(/[A-Z]/g, (character) => character.toLowerCase())
}

/**
 * Decode numeric and semicolon-terminated WHATWG named character references in a string.
 *
 * @param value - The source text or attribute value
 * @returns The decoded value, retaining unknown named references literally
 */
export function decodeEntities(value: string): string {
	let decoded = ''
	let index = 0
	while (index < value.length) {
		if (value[index] !== '&') {
			decoded += value[index] ?? ''
			index += 1
			continue
		}
		const start = index
		index += 1
		if (value[index] === '#') {
			index += 1
			let radix = 10
			if (value[index] === 'x' || value[index] === 'X') {
				radix = 16
				index += 1
			}
			const digits = index
			while (
				index < value.length &&
				(radix === 16 ? /[0-9A-Fa-f]/.test(value[index] ?? '') : /[0-9]/.test(value[index] ?? ''))
			) {
				index += 1
			}
			if (index > digits && value[index] === ';') {
				const scalar = Number.parseInt(value.slice(digits, index), radix)
				decoded +=
					Number.isFinite(scalar) &&
					scalar > 0 &&
					scalar <= 0x10ffff &&
					!(scalar >= 0xd800 && scalar <= 0xdfff)
						? String.fromCodePoint(scalar)
						: '\uFFFD'
				index += 1
				continue
			}
			decoded += value.slice(start, index)
			continue
		}
		const name = index
		while (index < value.length && /[A-Za-z0-9]/.test(value[index] ?? '')) index += 1
		if (index > name && value[index] === ';') {
			const key = value.slice(name, index)
			const entity = Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : undefined
			if (entity !== undefined) {
				decoded += entity
				index += 1
				continue
			}
			decoded += value.slice(start, index + 1)
			index += 1
			continue
		}
		decoded += '&'
		index = start + 1
	}
	return decoded
}

/**
 * Scan an attribute source segment into ordered, first-wins attributes.
 *
 * @param source - The part of a start tag after its name and before `>`
 * @returns Parsed attributes with ASCII-lowercased names and decoded values
 */
export function scanAttributes(source: string): readonly HTMLAttribute[] {
	const attributes: HTMLAttribute[] = []
	const names = new Set<string>()
	let index = 0
	while (index < source.length) {
		while (index < source.length && HTML_WHITESPACE.includes(source[index] ?? '')) index += 1
		if (index >= source.length || source[index] === '/') break
		const start = index
		while (
			index < source.length &&
			!HTML_WHITESPACE.includes(source[index] ?? '') &&
			source[index] !== '=' &&
			source[index] !== '/' &&
			source[index] !== '"' &&
			source[index] !== "'" &&
			source[index] !== '<' &&
			source[index] !== '>'
		) {
			index += 1
		}
		if (index === start) {
			index += 1
			continue
		}
		const name = lowercaseASCII(source.slice(start, index))
		while (index < source.length && HTML_WHITESPACE.includes(source[index] ?? '')) index += 1
		let value: string | undefined
		if (source[index] === '=') {
			index += 1
			while (index < source.length && HTML_WHITESPACE.includes(source[index] ?? '')) index += 1
			const quote = source[index]
			if (quote === '"' || quote === "'") {
				index += 1
				const valueStart = index
				while (index < source.length && source[index] !== quote) index += 1
				if (index < source.length) {
					value = decodeEntities(source.slice(valueStart, index))
					index += 1
				} else {
					index = source.length
				}
			} else {
				const valueStart = index
				while (index < source.length && !HTML_WHITESPACE.includes(source[index] ?? '')) {
					index += 1
				}
				if (index > valueStart) value = decodeEntities(source.slice(valueStart, index))
			}
		}
		if (!names.has(name)) {
			names.add(name)
			attributes.push(value === undefined ? { name } : { name, value })
		}
	}
	return attributes
}

/**
 * Parse one unambiguous start tag without recovery under the package's ASCII tag-name grammar.
 *
 * @param html - The exact HTML source
 * @param offset - The UTF-16 offset of the opening `<`
 * @returns The start tag and exact next offset, or `undefined` for malformed or incomplete source
 */
export function parseStartTag(html: string, offset: number): HTMLStartTag | undefined {
	if (!Number.isInteger(offset) || offset < 0 || html[offset] !== '<') return undefined
	let index = offset + 1
	if (!/[A-Za-z]/.test(html[index] ?? '')) return undefined
	const nameStart = index
	while (index < html.length && /[A-Za-z0-9:-]/.test(html[index] ?? '')) index += 1
	const name = lowercaseASCII(html.slice(nameStart, index))
	const attributes: HTMLAttribute[] = []
	const names = new Set<string>()
	let separated = false
	for (;;) {
		const boundary = html[index]
		if (boundary !== '>' && boundary !== '/' && !separated) {
			if (boundary === undefined || !HTML_WHITESPACE.includes(boundary)) return undefined
			while (html[index] !== undefined && HTML_WHITESPACE.includes(html[index] ?? '')) {
				index += 1
			}
		}
		separated = false
		const following = html[index]
		if (following === '>') return { name, attributes, slashed: false, next: index + 1 }
		if (following === '/') {
			return html[index + 1] === '>'
				? { name, attributes, slashed: true, next: index + 2 }
				: undefined
		}
		if (following === undefined) return undefined
		const attributeStart = index
		for (;;) {
			const character = html[index]
			if (
				character === undefined ||
				HTML_WHITESPACE.includes(character) ||
				character === '=' ||
				character === '/' ||
				character === '>'
			) {
				break
			}
			const point = html.codePointAt(index)
			if (character === '"' || character === "'" || character === '<' || !isHTMLCodePoint(point)) {
				return undefined
			}
			index += point > 0xffff ? 2 : 1
		}
		if (index === attributeStart) return undefined
		const attributeName = lowercaseASCII(html.slice(attributeStart, index))
		if (names.has(attributeName)) return undefined
		names.add(attributeName)
		const attributeEnd = index
		while (html[index] !== undefined && HTML_WHITESPACE.includes(html[index] ?? '')) index += 1
		const spacing = index > attributeEnd
		let value: string | undefined
		if (html[index] === '=') {
			index += 1
			while (html[index] !== undefined && HTML_WHITESPACE.includes(html[index] ?? '')) index += 1
			const quote = html[index]
			if (quote === '"' || quote === "'") {
				index += 1
				const valueStart = index
				for (;;) {
					const character = html[index]
					if (character === undefined) return undefined
					if (character === quote) break
					const point = html.codePointAt(index)
					if (!isHTMLCodePoint(point)) return undefined
					index += point > 0xffff ? 2 : 1
				}
				value = decodeEntities(html.slice(valueStart, index))
				index += 1
				const delimiter = html[index]
				if (
					delimiter !== '>' &&
					delimiter !== '/' &&
					(delimiter === undefined || !HTML_WHITESPACE.includes(delimiter))
				) {
					return undefined
				}
			} else {
				const valueStart = index
				for (;;) {
					const character = html[index]
					if (character === undefined) return undefined
					if (character === '>' || HTML_WHITESPACE.includes(character)) break
					const point = html.codePointAt(index)
					if (
						character === '"' ||
						character === "'" ||
						character === '<' ||
						character === '=' ||
						character === '`' ||
						!isHTMLCodePoint(point)
					) {
						return undefined
					}
					index += point > 0xffff ? 2 : 1
				}
				if (index === valueStart) return undefined
				value = decodeEntities(html.slice(valueStart, index))
			}
		}
		attributes.push(value === undefined ? { name: attributeName } : { name: attributeName, value })
		if (value === undefined && spacing) separated = true
	}
}

/**
 * Scan one complete start or close tag.
 *
 * @param html - The normalized HTML source
 * @param offset - The offset of the opening `<`
 * @returns The tag and next offset, or `undefined` for an invalid or incomplete tag
 */
export function scanTag(html: string, offset: number): HTMLTag | undefined {
	if (html[offset] !== '<') return undefined
	const closing = html[offset + 1] === '/'
	if (!closing) {
		const parsed = parseStartTag(html, offset)
		if (parsed !== undefined) {
			return {
				name: parsed.name,
				attributes: parsed.attributes,
				closing: false,
				next: parsed.next,
			}
		}
	}
	let index = offset + (closing ? 2 : 1)
	if (!/[A-Za-z]/.test(html[index] ?? '')) return undefined
	const nameStart = index
	while (index < html.length && /[A-Za-z0-9:-]/.test(html[index] ?? '')) index += 1
	const name = lowercaseASCII(html.slice(nameStart, index))
	const attributesStart = index
	while (index < html.length) {
		const character = html[index]
		if (character === '>') {
			let attributeSource = html.slice(attributesStart, index)
			let end = attributeSource.length
			while (end > 0 && HTML_WHITESPACE.includes(attributeSource[end - 1] ?? '')) end -= 1
			const trimmed = attributeSource.slice(0, end)
			if (
				trimmed.endsWith('/') &&
				(trimmed.length === 1 || HTML_WHITESPACE.includes(trimmed[trimmed.length - 2] ?? ''))
			) {
				attributeSource = trimmed.slice(0, -1)
			}
			return {
				name,
				attributes: closing ? [] : scanAttributes(attributeSource),
				closing,
				next: index + 1,
			}
		}
		if (character === '"' || character === "'") {
			const quote = character
			let recovery: number | undefined
			index += 1
			while (index < html.length && html[index] !== quote && html[index] !== '<') {
				if (recovery === undefined && html[index] === '>') recovery = index
				index += 1
			}
			if (html[index] === quote) {
				index += 1
				continue
			}
			if (recovery === undefined) {
				while (index < html.length && html[index] !== '>') index += 1
				if (html[index] === '>') recovery = index
			}
			if (recovery === undefined) return undefined
			return {
				name,
				attributes: closing ? [] : scanAttributes(html.slice(attributesStart, recovery)),
				closing,
				next: recovery + 1,
			}
		}
		index += 1
	}
	return undefined
}

/**
 * Scan a standard or bogus HTML comment.
 *
 * @param html - The normalized HTML source
 * @param offset - The offset of the opening `<`
 * @returns The comment node and next offset, or `undefined` when no comment starts here
 */
export function scanComment(
	html: string,
	offset: number,
): { readonly node: CommentNode; readonly next: number } | undefined {
	if (html.startsWith('<!--', offset)) {
		const start = offset + 4
		if (html[start] === '>') {
			return { node: { category: 'comment', value: '' }, next: start + 1 }
		}
		if (html[start] === '-' && html[start + 1] === '>') {
			return { node: { category: 'comment', value: '' }, next: start + 2 }
		}
		let index = start
		while (index < html.length) {
			if (html.startsWith('-->', index)) {
				return {
					node: { category: 'comment', value: html.slice(start, index) },
					next: index + 3,
				}
			}
			if (html.startsWith('--!>', index)) {
				return {
					node: { category: 'comment', value: html.slice(start, index) },
					next: index + 4,
				}
			}
			index += 1
		}
		return { node: { category: 'comment', value: html.slice(start) }, next: html.length }
	}
	if (!html.startsWith('<!', offset) && !html.startsWith('<?', offset)) return undefined
	let end = offset + 2
	while (end < html.length && html[end] !== '>') end += 1
	return end >= html.length
		? { node: { category: 'comment', value: html.slice(offset + 2) }, next: html.length }
		: {
				node: { category: 'comment', value: html.slice(offset + 2, end) },
				next: end + 1,
			}
}

/**
 * Scan an HTML doctype with optional public and system identifiers.
 *
 * @param html - The normalized HTML source
 * @param offset - The offset of the opening `<`
 * @returns The doctype node and next offset, or `undefined` for a non-doctype or incomplete input
 */
export function scanDoctype(
	html: string,
	offset: number,
): { readonly node: DoctypeNode; readonly next: number } | undefined {
	if (lowercaseASCII(html.slice(offset, offset + 9)) !== '<!doctype') return undefined
	const boundary = html[offset + 9]
	if (boundary !== undefined && boundary !== '>' && !HTML_WHITESPACE.includes(boundary)) {
		return undefined
	}
	let end = offset + 9
	let doctypeQuote: string | undefined
	while (end < html.length) {
		const character = html[end]
		if (doctypeQuote !== undefined) {
			if (character === doctypeQuote) doctypeQuote = undefined
		} else if (character === '"' || character === "'") {
			doctypeQuote = character
		} else if (character === '>') {
			break
		}
		end += 1
	}
	if (end >= html.length || doctypeQuote !== undefined) return undefined
	const body = html.slice(offset + 9, end)
	let index = 0
	while (index < body.length && HTML_WHITESPACE.includes(body[index] ?? '')) index += 1
	const nameStart = index
	while (index < body.length && !HTML_WHITESPACE.includes(body[index] ?? '')) index += 1
	const name = lowercaseASCII(body.slice(nameStart, index))
	if (name.length === 0) return undefined
	while (index < body.length && HTML_WHITESPACE.includes(body[index] ?? '')) index += 1
	const keywordStart = index
	while (index < body.length && /[A-Za-z]/.test(body[index] ?? '')) index += 1
	const keyword = lowercaseASCII(body.slice(keywordStart, index))
	while (index < body.length && HTML_WHITESPACE.includes(body[index] ?? '')) index += 1
	let publicIdentifier: string | undefined
	let systemIdentifier: string | undefined
	if (keyword === 'public') {
		const quote = body[index]
		if (quote === '"' || quote === "'") {
			index += 1
			const identifierStart = index
			while (index < body.length && body[index] !== quote) index += 1
			if (index < body.length) {
				publicIdentifier = body.slice(identifierStart, index)
				index += 1
				while (index < body.length && HTML_WHITESPACE.includes(body[index] ?? '')) index += 1
				const systemQuote = body[index]
				if (systemQuote === '"' || systemQuote === "'") {
					index += 1
					const systemStart = index
					while (index < body.length && body[index] !== systemQuote) index += 1
					if (index < body.length) systemIdentifier = body.slice(systemStart, index)
				}
			}
		}
	} else if (keyword === 'system') {
		const quote = body[index]
		if (quote === '"' || quote === "'") {
			index += 1
			const identifierStart = index
			while (index < body.length && body[index] !== quote) index += 1
			if (index < body.length) systemIdentifier = body.slice(identifierStart, index)
		}
	}
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
 * @param entities - Whether to decode character references
 * @returns The text child, its source region, next offset, and whether a complete close was found
 */
export function scanRawText(
	html: string,
	offset: number,
	name: string,
	entities = false,
): HTMLRawText {
	const marker = `</${lowercaseASCII(name)}`
	let search = offset
	while (search < html.length) {
		const candidate = html.indexOf('<', search)
		if (candidate < 0) break
		if (lowercaseASCII(html.slice(candidate, candidate + marker.length)) !== marker) {
			search = candidate + 1
			continue
		}
		const boundary = html[candidate + marker.length]
		if (boundary === '>' || (boundary !== undefined && HTML_WHITESPACE.includes(boundary))) {
			const end = html.indexOf('>', candidate + marker.length)
			if (end < 0) break
			const value = html.slice(offset, candidate)
			const node: TextNode = {
				category: 'text',
				value: entities ? decodeEntities(value) : value,
			}
			return {
				node,
				span: { start: offset, end: candidate },
				next: end + 1,
				closed: true,
			}
		}
		search = candidate + marker.length
	}
	const value = html.slice(offset)
	const node: TextNode = {
		category: 'text',
		value: entities ? decodeEntities(value) : value,
	}
	return {
		node,
		span: { start: offset, end: html.length },
		next: html.length,
		closed: false,
	}
}

/**
 * Encode the characters that have markup meaning in HTML text.
 *
 * @param value - The literal text
 * @returns The minimally encoded HTML text
 */
export function encodeText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Encode the characters that have markup meaning in a double-quoted HTML attribute.
 *
 * @param value - The literal attribute value
 * @returns The minimally encoded attribute value
 */
export function encodeAttribute(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/**
 * Decode and inspect a URL against an explicit scheme allowlist and a fixed dangerous floor.
 *
 * @remarks
 * Entity decoding repeats to a small bounded fixpoint so a hand-built AST cannot defer a
 * dangerous scheme to a later serialize-reparse pass. Input that still changes after the
 * bound fails closed.
 *
 * @param value - The source URL, possibly containing HTML entities or obfuscating controls
 * @param schemes - The allowed lowercase absolute schemes
 * @returns The decoded, control-free URL, or `''` when it is unsafe
 */
export function sanitizeURL(
	value: string,
	schemes: ReadonlySet<string> | readonly string[],
): string {
	try {
		let decoded = value
		let stable = false
		for (let count = 0; count < 8; count += 1) {
			const next = decodeEntities(decoded)
			if (next === decoded) {
				stable = true
				break
			}
			decoded = next
		}
		if (!stable && decodeEntities(decoded) !== decoded) return ''
		let cleaned = ''
		for (const character of decoded) {
			const point = character.codePointAt(0)
			if (point !== undefined && point > 0x20 && !(point >= 0x7f && point <= 0x9f)) {
				cleaned += character
			}
		}
		const first = cleaned[0]
		const second = cleaned[1]
		if ((first === '/' || first === '\\') && (second === '/' || second === '\\')) {
			return ''
		}
		const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned)
		if (match === null) return cleaned
		const scheme = (match[1] ?? '').toLowerCase()
		const has = Reflect.get(schemes, 'has')
		const allowed =
			typeof has === 'function'
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
	} catch {
		return ''
	}
}

/**
 * Resolve a URL through the platform WHATWG URL implementation.
 *
 * @param value - The relative or absolute URL
 * @param base - The absolute base URL
 * @returns The resolved URL, or the original value when resolution fails
 */
export function resolveURL(value: string, base: string): string {
	try {
		return new URL(value, base).href
	} catch {
		return value
	}
}

/**
 * Find an element attribute without case sensitivity.
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
	try {
		const expected = name.toLowerCase()
		for (const attribute of node.attributes) {
			if (attribute.name.toLowerCase() === expected) return attribute.value ?? ''
		}
		return undefined
	} catch {
		return undefined
	}
}

/**
 * Filter an element's attributes down to the ones a sanitized document may carry.
 *
 * @remarks
 * The allowlist narrows what is kept, but fixed refusals hold whatever it contains: a
 * handler attribute (any case-insensitive `on*` name), a scripting or styling channel
 * (`style`, `srcdoc`), a namespaced or `xmlns` name, and a structurally unwritable name are
 * always removed. An `align` value is narrowed to {@link TABLE_ALIGNMENTS} on
 * {@link TABLE_CELL_ELEMENTS}, and a {@link URL_ATTRIBUTES} value is passed through
 * {@link sanitizeURL}; either attribute is REMOVED - not emptied - when its extra rule
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
	try {
		const kept: HTMLAttribute[] = []
		const names = new Set<string>()
		const has = Reflect.get(attributes, 'has')
		for (const attribute of node.attributes) {
			const name = attribute.name.toLowerCase()
			if (names.has(name)) continue
			names.add(name)
			if (
				name.length === 0 ||
				/[\s"'/:<=>]/.test(name) ||
				name.startsWith('on') ||
				name === 'style' ||
				name === 'srcdoc' ||
				name === 'xmlns' ||
				!(typeof has === 'function'
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
	} catch {
		return []
	}
}

/**
 * Resolve an element's URL attributes against a base URL.
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
	try {
		const resolved: HTMLAttribute[] = []
		for (const attribute of node.attributes) {
			const name = attribute.name.toLowerCase()
			if (URL_ATTRIBUTES.includes(name) && attribute.value !== undefined) {
				resolved.push({ name, value: resolveURL(attribute.value, base) })
				continue
			}
			resolved.push(attribute.value === undefined ? { name } : { name, value: attribute.value })
		}
		return resolved
	} catch {
		return node.attributes
	}
}

/**
 * Collapse a run of whitespace to one inter-word space and remove edge whitespace.
 *
 * @param value - Text containing arbitrary whitespace
 * @returns The collapsed text
 */
export function collapseSpace(value: string): string {
	return value.replace(/\s+/g, ' ').trim()
}

/**
 * Serialize an HTML node to canonical, safety-bounded HTML.
 *
 * @remarks
 * Invalid element names unwrap to their children. Raw-text bodies containing their own
 * matching close-tag sequence are dropped. Descent stops after {@link MAX_DEPTH}.
 *
 * @param node - The node or document to serialize
 * @returns Canonical HTML, or `''` if a hostile value prevents serialization
 */
export function renderHTML(node: HTMLNode): string {
	try {
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
				const children: HTMLNode[] = []
				if (
					frame.depth < MAX_DEPTH &&
					(current.category === 'document' ||
						(current.category === 'element' && !RAW_ELEMENTS.includes(current.name.toLowerCase())))
				) {
					for (const child of current.children) if (child !== undefined) children.push(child)
				}
				stack.push({ ...frame, expanded: true, count: children.length })
				const depth = current.category === 'document' ? 0 : frame.depth + 1
				for (let index = children.length - 1; index >= 0; index -= 1) {
					const child = children[index]
					if (child !== undefined) {
						stack.push({ node: child, depth, expanded: false, count: 0 })
					}
				}
				continue
			}
			const children =
				frame.count === 0 ? [] : values.splice(values.length - frame.count, frame.count)
			let value = ''
			switch (current.category) {
				case 'document':
					value = children.join('')
					break
				case 'text':
					value = encodeText(current.value)
					break
				case 'comment':
					if (
						current.value.includes('-->') ||
						current.value.includes('--!>') ||
						current.value.startsWith('>') ||
						current.value.startsWith('->')
					) {
						break
					}
					value = `<!--${current.value}-->`
					break
				case 'doctype': {
					const name = current.name.toLowerCase()
					if (!/^[a-z][a-z0-9:-]*$/.test(name)) break
					value = `<!DOCTYPE ${name}`
					const publicSafe =
						current.public !== undefined &&
						(!current.public.includes('"') || !current.public.includes("'"))
					const systemSafe =
						current.system !== undefined &&
						(!current.system.includes('"') || !current.system.includes("'"))
					if (publicSafe && current.public !== undefined) {
						const quote = current.public.includes('"') ? "'" : '"'
						value += ` PUBLIC ${quote}${current.public}${quote}`
						if (systemSafe && current.system !== undefined) {
							const systemQuote = current.system.includes('"') ? "'" : '"'
							value += ` ${systemQuote}${current.system}${systemQuote}`
						}
					} else if (systemSafe && current.system !== undefined) {
						const quote = current.system.includes('"') ? "'" : '"'
						value += ` SYSTEM ${quote}${current.system}${quote}`
					}
					value += '>'
					break
				}
				case 'element': {
					const name = current.name.toLowerCase()
					if (!/^[a-z][a-z0-9:-]*$/.test(name)) {
						value = children.join('')
						break
					}
					let attributes = ''
					for (const attribute of current.attributes) {
						const attributeName = attribute.name.toLowerCase()
						if (attributeName.length === 0 || /[\s=/"':<>]/.test(attributeName)) {
							continue
						}
						attributes +=
							attribute.value === undefined
								? ` ${attributeName}`
								: ` ${attributeName}="${encodeAttribute(attribute.value)}"`
					}
					if (VOID_ELEMENTS.includes(name)) {
						value = `<${name}${attributes}>`
						break
					}
					if (RAW_ELEMENTS.includes(name)) {
						let body = ''
						for (const child of current.children) {
							if (child.category === 'text') body += child.value
						}
						const lower = body.toLowerCase()
						const marker = `</${name}`
						let unsafe = false
						let offset = 0
						while (offset < lower.length) {
							const match = lower.indexOf(marker, offset)
							if (match < 0) break
							const boundary = lower[match + marker.length]
							if (boundary === '>' || (boundary !== undefined && /\s/.test(boundary))) {
								unsafe = true
								break
							}
							offset = match + marker.length
						}
						value = `<${name}${attributes}>${unsafe ? '' : body}</${name}>`
						break
					}
					value = `<${name}${attributes}>${children.join('')}</${name}>`
					break
				}
			}
			if (stack.length === 0) return value
			values.push(value)
		}
		return ''
	} catch {
		return ''
	}
}

/**
 * Project an HTML node to structural plain text.
 *
 * @remarks
 * Block and line-break elements contribute newline boundaries, adjacent table cells use
 * tabs, and adjacent table rows use newlines. Whitespace collapses outside `pre` elements
 * and remains verbatim inside them. Script and style bodies are excluded; title and
 * textarea text remains.
 *
 * @param node - The node or document to project
 * @returns Structural plain text
 */
export function renderText(node: HTMLNode): string {
	try {
		const stack: Array<{
			readonly node: HTMLNode
			readonly depth: number
			readonly leaving: boolean
			readonly parent: ElementNode | undefined
			readonly table: ElementNode | undefined
			readonly preserved: boolean
		}> = [
			{
				node,
				depth: -1,
				leaving: false,
				parent: undefined,
				table: undefined,
				preserved: false,
			},
		]
		const segments: Array<{
			readonly value: string
			readonly mode: 'normal' | 'preserved' | 'cell' | 'row'
		}> = []
		let normal = ''
		const visited = new WeakSet<object>()
		const tables = new WeakSet<object>()
		const rows = new WeakSet<object>()
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (frame.leaving) {
				if (current.category === 'element') {
					const name = current.name.toLowerCase()
					const tableRole = name === 'tr' || TABLE_CELL_ELEMENTS.includes(name)
					if (!tableRole && (BLOCK_ELEMENTS.includes(name) || name === 'br')) normal += '\n'
				}
				continue
			}
			if (visited.has(current)) continue
			visited.add(current)
			if (current.category === 'text') {
				if (frame.preserved) {
					if (normal !== '') segments.push({ value: normal, mode: 'normal' })
					normal = ''
					segments.push({ value: current.value, mode: 'preserved' })
				} else {
					normal += current.value.replace(/\s+/g, ' ')
				}
				continue
			}
			if (current.category !== 'document' && current.category !== 'element') continue
			let table = frame.table
			let preserved = frame.preserved
			let boundary = false
			if (current.category === 'element') {
				const name = current.name.toLowerCase()
				if (RAW_ELEMENTS.includes(name)) continue
				if (name === 'table') table = current
				if (name === 'tr' && table !== undefined) {
					if (tables.has(table)) {
						if (normal !== '') segments.push({ value: normal, mode: 'normal' })
						normal = ''
						segments.push({ value: '\n', mode: 'row' })
					} else {
						tables.add(table)
					}
				}
				if (
					TABLE_CELL_ELEMENTS.includes(name) &&
					frame.parent !== undefined &&
					frame.parent.name.toLowerCase() === 'tr'
				) {
					if (rows.has(frame.parent)) {
						if (normal !== '') segments.push({ value: normal, mode: 'normal' })
						normal = ''
						segments.push({ value: '\t', mode: 'cell' })
					} else {
						rows.add(frame.parent)
					}
				}
				const tableRole = name === 'tr' || TABLE_CELL_ELEMENTS.includes(name)
				boundary = !tableRole && (BLOCK_ELEMENTS.includes(name) || name === 'br')
				preserved = preserved || name === 'pre'
			}
			if (boundary) normal += '\n'
			if (frame.depth >= MAX_DEPTH) continue
			stack.push({
				node: current,
				depth: frame.depth,
				leaving: true,
				parent: frame.parent,
				table,
				preserved: frame.preserved,
			})
			const depth = current.category === 'document' ? 0 : frame.depth + 1
			for (let index = current.children.length - 1; index >= 0; index -= 1) {
				const child = current.children[index]
				if (child !== undefined) {
					stack.push({
						node: child,
						depth,
						leaving: false,
						parent: current.category === 'element' ? current : undefined,
						table,
						preserved,
					})
				}
			}
		}
		if (normal !== '') segments.push({ value: normal, mode: 'normal' })
		let value = ''
		for (let index = 0; index < segments.length; index += 1) {
			const segment = segments[index]
			if (segment === undefined) continue
			if (segment.mode !== 'normal') {
				value += segment.value
				continue
			}
			let text = segment.value
				.replace(/[ \t]*\n[ \t]*/g, '\n')
				.replace(/\n+/g, '\n')
				.replace(/ +/g, ' ')
			const previous = segments[index - 1]
			const next = segments[index + 1]
			if (index === 0 || previous?.mode === 'cell' || previous?.mode === 'row') {
				text = text.trimStart()
			}
			if (index === segments.length - 1 || next?.mode === 'cell' || next?.mode === 'row') {
				text = text.trimEnd()
			}
			value += text
		}
		return value
	} catch {
		return ''
	}
}

/**
 * Walk an HTML node depth-first in pre-order, including the supplied root.
 *
 * @param node - The root node
 * @returns A depth-bounded generator of visited nodes
 */
export function* walkNodes(node: HTMLNode): Generator<HTMLNode> {
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
			for (let index = frame.node.children.length - 1; index >= 0; index -= 1) {
				const child = frame.node.children[index]
				if (child !== undefined) stack.push({ node: child, depth })
			}
		}
	} catch {
		return
	}
}

/**
 * Fold an HTML node bottom-up through a total handler table.
 *
 * @remarks
 * A node at the depth cap is folded with an empty child result list.
 *
 * @param node - The root node
 * @param handlers - One handler for every HTML node category
 * @returns The folded value
 */
export function foldNode<T>(node: HTMLNode, handlers: HTMLHandlers<T>): T {
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
			const children: HTMLNode[] = []
			if (
				frame.depth < MAX_DEPTH &&
				(frame.node.category === 'document' || frame.node.category === 'element')
			) {
				for (const child of frame.node.children) if (child !== undefined) children.push(child)
			}
			stack.push({ ...frame, expanded: true, count: children.length })
			const depth = frame.node.category === 'document' ? 0 : frame.depth + 1
			for (let index = children.length - 1; index >= 0; index -= 1) {
				const child = children[index]
				if (child !== undefined) {
					stack.push({ node: child, depth, expanded: false, count: 0 })
				}
			}
			continue
		}
		const children =
			frame.count === 0 ? [] : values.splice(values.length - frame.count, frame.count)
		let value: T
		switch (frame.node.category) {
			case 'document':
				value = handlers.document(frame.node, children)
				break
			case 'element':
				value = handlers.element(frame.node, children)
				break
			case 'text':
				value = handlers.text(frame.node, children)
				break
			case 'comment':
				value = handlers.comment(frame.node, children)
				break
			case 'doctype':
				value = handlers.doctype(frame.node, children)
				break
		}
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
	const derivations = new Map<HTMLNode, HTMLNode | undefined>()
	const outputs = new Map<HTMLNode, HTMLNode>()
	try {
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
				const children: HTMLNode[] = []
				if (current.category === 'document' || current.category === 'element') {
					for (const child of current.children) if (child !== undefined) children.push(child)
				}
				stack.push({ ...frame, expanded: true, count: children.length })
				const depth = current.category === 'document' ? 0 : frame.depth + 1
				for (let index = children.length - 1; index >= 0; index -= 1) {
					const child = children[index]
					if (child !== undefined) {
						stack.push({ node: child, depth, expanded: false, count: 0 })
					}
				}
				continue
			}
			const children =
				frame.count === 0 ? [] : values.splice(values.length - frame.count, frame.count)
			let candidate = current
			if (current.category === 'document' || current.category === 'element') {
				let changed = children.length !== current.children.length
				if (!changed) {
					for (const [index, child] of children.entries()) {
						if (child !== current.children[index]) {
							changed = true
							break
						}
					}
				}
				if (changed) {
					candidate =
						current.category === 'document'
							? { category: 'document', children }
							: {
									category: 'element',
									name: current.name,
									attributes: current.attributes,
									children,
								}
					if (!derivations.has(candidate)) derivations.set(candidate, current)
					else if (derivations.get(candidate) !== current) derivations.set(candidate, undefined)
				}
			}
			const rewritten = rewrite(candidate)
			const source = outputs.get(rewritten)
			if (source === undefined) outputs.set(rewritten, current)
			else if (source !== current) derivations.set(rewritten, undefined)
			if (rewritten !== candidate) {
				if (!derivations.has(rewritten)) derivations.set(rewritten, current)
				else if (derivations.get(rewritten) !== current) derivations.set(rewritten, undefined)
			}
			if (stack.length === 0) {
				return [
					rewritten.category === 'document'
						? rewritten
						: candidate.category === 'document'
							? candidate
							: document,
					derivations,
				]
			}
			values.push(rewritten)
		}
		return [document, derivations]
	} catch {
		return [document, new Map()]
	}
}

/**
 * Restore the no-adjacent-text invariant in a rebuilt list of siblings.
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
	try {
		const merged: HTMLNode[] = []
		for (const child of children) {
			if (child === undefined) continue
			if (child.category !== 'text') {
				merged.push(child)
				continue
			}
			if (child.value.length === 0) continue
			const previous = merged[merged.length - 1]
			if (previous !== undefined && previous.category === 'text') {
				merged[merged.length - 1] = { category: 'text', value: previous.value + child.value }
				continue
			}
			merged.push(child)
		}
		return merged
	} catch {
		return children
	}
}

/**
 * Collapses the whitespace runs inside each direct text child of a sibling list.
 *
 * @remarks
 * Every run of whitespace becomes one space and edge whitespace is KEPT, because the space
 * between `<b>one</b>` and `<i>two</i>` is a word boundary rather than decoration. Applying
 * this at the element that keeps the text - never at one being unwrapped - is what leaves a
 * `pre` or `code` body verbatim while the surrounding prose collapses.
 *
 * @param children - The sibling list whose text children are collapsed
 * @returns The collapsed list and its operation-owned derivations
 */
export function collapseText(children: readonly HTMLNode[]): HTMLDerivation<readonly HTMLNode[]> {
	const derivations = new Map<HTMLNode, HTMLNode | undefined>()
	try {
		const collapsed: HTMLNode[] = []
		for (const child of children) {
			if (child === undefined) continue
			if (child.category !== 'text') {
				collapsed.push(child)
				continue
			}
			const text: TextNode = { category: 'text', value: child.value.replace(/\s+/g, ' ') }
			collapsed.push(text)
			derivations.set(text, child)
		}
		return [collapsed, derivations]
	} catch {
		return [children, new Map()]
	}
}

/**
 * Re-roots a document at the sole occurrence of one of the named region elements.
 *
 * @remarks
 * The names are tried in order and the first one occurring EXACTLY once in the document
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
	const derivations = new Map<HTMLNode, HTMLNode | undefined>()
	try {
		for (const name of names) {
			const expected = name.toLowerCase()
			let region: ElementNode | undefined
			let count = 0
			for (const node of walkNodes(document)) {
				if (node.category !== 'element' || node.name.toLowerCase() !== expected) continue
				count += 1
				if (count > 1) break
				region = node
			}
			if (count === 1 && region !== undefined) {
				const rooted: HTMLDocument = { category: 'document', children: region.children }
				derivations.set(rooted, region)
				return [rooted, derivations]
			}
		}
		return [document, derivations]
	} catch {
		return [document, new Map()]
	}
}

/**
 * Rebuilds a document bottom-up, letting each node become any number of nodes.
 *
 * @remarks
 * The dual of {@link rewriteDocument}: a rewrite maps one node to one node, while a prune
 * maps one node to a LIST - `[]` to drop it, `node.children` to unwrap it, `[node]` to keep
 * it, or any other list to replace it - which is the shape every allowlist, region drop, and
 * wrapper melt needs. As in {@link rewriteDocument} the handler receives each node with its
 * children ALREADY pruned and flattened, so keeping a node needs no reconstruction and a
 * subtree nothing changed keeps its reference. The root is handled last and its handler is
 * expected to return the rebuilt document; a result that is not one is treated as the new
 * root's children. Descent stops at {@link MAX_DEPTH}: a node at the cap is handed NO
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
	const derivations = new Map<HTMLNode, HTMLNode | undefined>()
	try {
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
				const children: HTMLNode[] = []
				if (
					frame.depth < MAX_DEPTH &&
					(current.category === 'document' || current.category === 'element')
				) {
					for (const child of current.children) if (child !== undefined) children.push(child)
				}
				stack.push({ ...frame, expanded: true, count: children.length })
				const depth = current.category === 'document' ? 0 : frame.depth + 1
				for (let index = children.length - 1; index >= 0; index -= 1) {
					const child = children[index]
					if (child !== undefined) {
						stack.push({ node: child, depth, expanded: false, count: 0 })
					}
				}
				continue
			}
			const pruned =
				frame.count === 0 ? [] : results.splice(results.length - frame.count, frame.count)
			const children: HTMLNode[] = []
			for (const group of pruned) for (const child of group) children.push(child)
			let candidate = current
			if (current.category === 'document' || current.category === 'element') {
				let changed = children.length !== current.children.length
				if (!changed) {
					for (const [index, child] of children.entries()) {
						if (child !== current.children[index]) {
							changed = true
							break
						}
					}
				}
				if (changed) {
					candidate =
						current.category === 'document'
							? { category: 'document', children }
							: {
									category: 'element',
									name: current.name,
									attributes: current.attributes,
									children,
								}
					if (!derivations.has(candidate)) derivations.set(candidate, current)
					else if (derivations.get(candidate) !== current) derivations.set(candidate, undefined)
				}
			}
			const replacements = prune(candidate)
			if (replacements.length === 1) {
				const replacement = replacements[0]
				const child =
					replacement !== undefined &&
					(candidate.category === 'document' || candidate.category === 'element') &&
					candidate.children.includes(replacement)
				if (replacement !== undefined && replacement !== candidate && !child) {
					if (!derivations.has(replacement)) derivations.set(replacement, current)
					else if (derivations.get(replacement) !== current) {
						derivations.set(replacement, undefined)
					}
				}
			}
			if (stack.length === 0) {
				const root = replacements[0]
				if (root !== undefined && root.category === 'document') return [root, derivations]
				const rest: HTMLNode[] = []
				for (const node of replacements) if (node.category !== 'document') rest.push(node)
				return [{ category: 'document', children: rest }, derivations]
			}
			results.push(replacements)
		}
		return [{ category: 'document', children: [] }, derivations]
	} catch {
		return [{ category: 'document', children: [] }, new Map()]
	}
}
