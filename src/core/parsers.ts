import type {
	CommentNode,
	DoctypeNode,
	ElementNode,
	HTMLAttribute,
	HTMLDocument,
	HTMLNode,
	TextNode,
} from './types.js'
import {
	IMPLIED_CLOSERS,
	LITERAL_ELEMENTS,
	MAX_DEPTH,
	NAMED_ENTITIES,
	RAW_ELEMENTS,
	VOID_ELEMENTS,
} from './constants.js'

/**
 * Decode numeric and HTML4 named character references in a string.
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
			const entity = NAMED_ENTITIES.get(value.slice(name, index))
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
 * @returns Parsed attributes with lowercased names and decoded values
 */
export function scanAttributes(source: string): readonly HTMLAttribute[] {
	const attributes: HTMLAttribute[] = []
	const names = new Set<string>()
	let index = 0
	while (index < source.length) {
		while (index < source.length && /\s/.test(source[index] ?? '')) index += 1
		if (index >= source.length || source[index] === '/') break
		const start = index
		while (
			index < source.length &&
			!/\s/.test(source[index] ?? '') &&
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
		const name = source.slice(start, index).toLowerCase()
		while (index < source.length && /\s/.test(source[index] ?? '')) index += 1
		let value: string | undefined
		if (source[index] === '=') {
			index += 1
			while (index < source.length && /\s/.test(source[index] ?? '')) index += 1
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
				while (index < source.length && !/\s/.test(source[index] ?? '')) index += 1
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
 * Scan one complete start or close tag.
 *
 * @param html - The normalized HTML source
 * @param offset - The offset of the opening `<`
 * @returns The tag and next offset, or `undefined` for an invalid or incomplete tag
 */
export function scanTag(
	html: string,
	offset: number,
):
	| {
			readonly name: string
			readonly attributes: readonly HTMLAttribute[]
			readonly closing: boolean
			readonly next: number
	  }
	| undefined {
	if (html[offset] !== '<') return undefined
	const closing = html[offset + 1] === '/'
	let index = offset + (closing ? 2 : 1)
	if (!/[A-Za-z]/.test(html[index] ?? '')) return undefined
	const nameStart = index
	while (index < html.length && /[A-Za-z0-9:-]/.test(html[index] ?? '')) index += 1
	const name = html.slice(nameStart, index).toLowerCase()
	const attributesStart = index
	while (index < html.length) {
		const character = html[index]
		if (character === '>') {
			let attributeSource = html.slice(attributesStart, index)
			const trimmed = attributeSource.trimEnd()
			if (
				trimmed.endsWith('/') &&
				(trimmed.length === 1 || /\s/.test(trimmed[trimmed.length - 2] ?? ''))
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
			const close = html.indexOf(quote, index + 1)
			const nested = html.indexOf('<', index + 1)
			if (close >= 0 && (nested < 0 || close < nested)) {
				index = close + 1
				continue
			}
			const recovery = html.indexOf('>', index + 1)
			if (recovery < 0) return undefined
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
		const end = html.indexOf('-->', offset + 4)
		return end < 0
			? { node: { category: 'comment', value: html.slice(offset + 4) }, next: html.length }
			: {
					node: { category: 'comment', value: html.slice(offset + 4, end) },
					next: end + 3,
				}
	}
	if (!html.startsWith('<!', offset) && !html.startsWith('<?', offset)) return undefined
	const end = html.indexOf('>', offset + 2)
	return end < 0
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
	if (html.slice(offset, offset + 9).toLowerCase() !== '<!doctype') return undefined
	const boundary = html[offset + 9]
	if (boundary !== undefined && boundary !== '>' && !/\s/.test(boundary)) return undefined
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
	while (index < body.length && /\s/.test(body[index] ?? '')) index += 1
	const nameStart = index
	while (index < body.length && !/\s/.test(body[index] ?? '')) index += 1
	const name = body.slice(nameStart, index).toLowerCase()
	if (name.length === 0) return undefined
	while (index < body.length && /\s/.test(body[index] ?? '')) index += 1
	const keywordStart = index
	while (index < body.length && /[A-Za-z]/.test(body[index] ?? '')) index += 1
	const keyword = body.slice(keywordStart, index).toLowerCase()
	while (index < body.length && /\s/.test(body[index] ?? '')) index += 1
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
				while (index < body.length && /\s/.test(body[index] ?? '')) index += 1
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
 * Scan text through the case-insensitive matching close tag of a raw or literal element.
 *
 * @param html - The normalized HTML source
 * @param offset - The first content offset after the start tag
 * @param name - The lowercased element name
 * @param entities - Whether to decode character references
 * @returns The single text child, next offset, and whether a complete close was found
 */
export function scanRawText(
	html: string,
	offset: number,
	name: string,
	entities = false,
): { readonly node: TextNode; readonly next: number; readonly closed: boolean } {
	const marker = `</${name.toLowerCase()}`
	let search = offset
	while (search < html.length) {
		const candidate = html.indexOf('<', search)
		if (candidate < 0) break
		if (html.slice(candidate, candidate + marker.length).toLowerCase() !== marker) {
			search = candidate + 1
			continue
		}
		const boundary = html[candidate + marker.length]
		if (boundary === '>' || (boundary !== undefined && /\s/.test(boundary))) {
			const end = html.indexOf('>', candidate + marker.length)
			if (end < 0) break
			const value = html.slice(offset, candidate)
			return {
				node: { category: 'text', value: entities ? decodeEntities(value) : value },
				next: end + 1,
				closed: true,
			}
		}
		search = candidate + marker.length
	}
	const value = html.slice(offset)
	return {
		node: { category: 'text', value: entities ? decodeEntities(value) : value },
		next: html.length,
		closed: false,
	}
}

/**
 * Parse an HTML string into a total, depth-bounded document AST.
 *
 * @param html - The HTML page or fragment source
 * @returns The parsed document; malformed input recovers without throwing
 */
export function parseDocument(html: string): HTMLDocument {
	const source = html.replace(/\r\n?/g, '\n').replaceAll('\0', '\uFFFD')
	const children: HTMLNode[] = []
	const siblingLists: HTMLNode[][] = [children]
	const stack: { readonly name: string; readonly children: HTMLNode[] }[] = [{ name: '', children }]
	const overflow: string[] = []
	let index = 0
	while (index < source.length) {
		const parent = stack[stack.length - 1]
		if (parent === undefined) break
		if (source[index] !== '<') {
			const next = source.indexOf('<', index)
			const end = next < 0 ? source.length : next
			const value = decodeEntities(source.slice(index, end))
			if (value.length > 0) parent.children.push({ category: 'text', value })
			index = end
			continue
		}
		if (source.startsWith('<!--', index)) {
			const comment = scanComment(source, index)
			if (comment !== undefined) {
				parent.children.push(comment.node)
				index = comment.next
				continue
			}
		}
		if (source.slice(index, index + 9).toLowerCase() === '<!doctype') {
			const doctype = scanDoctype(source, index)
			if (doctype !== undefined) {
				parent.children.push(doctype.node)
				index = doctype.next
				continue
			}
			if (source.indexOf('>', index + 2) < 0) {
				index = source.length
				continue
			}
		}
		if (source.startsWith('<!', index) || source.startsWith('<?', index)) {
			const comment = scanComment(source, index)
			if (comment !== undefined) {
				parent.children.push(comment.node)
				index = comment.next
				continue
			}
		}
		const marker = source[index + 1]
		const tagLike =
			/[A-Za-z]/.test(marker ?? '') || marker === '/' || marker === '!' || marker === '?'
		if (!tagLike) {
			parent.children.push({ category: 'text', value: '<' })
			index += 1
			continue
		}
		const tag = scanTag(source, index)
		if (tag === undefined) {
			const end = source.indexOf('>', index + 1)
			index = end < 0 ? source.length : end + 1
			continue
		}
		index = tag.next
		if (tag.closing) {
			if (VOID_ELEMENTS.has(tag.name)) continue
			let overflowMatch = -1
			for (let cursor = overflow.length - 1; cursor >= 0; cursor -= 1) {
				if (overflow[cursor] === tag.name) {
					overflowMatch = cursor
					break
				}
			}
			if (overflowMatch >= 0) {
				overflow.length = overflowMatch
				continue
			}
			let stackMatch = -1
			for (let cursor = stack.length - 1; cursor >= 1; cursor -= 1) {
				if (stack[cursor]?.name === tag.name) {
					stackMatch = cursor
					break
				}
			}
			if (stackMatch >= 1) {
				overflow.length = 0
				stack.length = stackMatch
			}
			continue
		}
		while (overflow.length > 0) {
			const open = overflow[overflow.length - 1]
			const closers = open === undefined ? undefined : IMPLIED_CLOSERS.get(open)
			if (closers === undefined || !closers.has(tag.name)) break
			overflow.pop()
		}
		if (overflow.length === 0) {
			while (stack.length > 1) {
				const open = stack[stack.length - 1]?.name
				const closers = open === undefined ? undefined : IMPLIED_CLOSERS.get(open)
				if (closers === undefined || !closers.has(tag.name)) break
				stack.pop()
			}
		}
		const current = stack[stack.length - 1]
		if (current === undefined) break
		if (RAW_ELEMENTS.has(tag.name) || LITERAL_ELEMENTS.has(tag.name)) {
			const raw = scanRawText(source, index, tag.name, LITERAL_ELEMENTS.has(tag.name))
			if (stack.length <= MAX_DEPTH) {
				const element: ElementNode = {
					category: 'element',
					name: tag.name,
					attributes: tag.attributes,
					children: [raw.node],
				}
				current.children.push(element)
			} else {
				current.children.push(raw.node)
			}
			index = raw.next
			continue
		}
		if (VOID_ELEMENTS.has(tag.name)) {
			if (stack.length <= MAX_DEPTH) {
				current.children.push({
					category: 'element',
					name: tag.name,
					attributes: tag.attributes,
					children: [],
				})
			}
			continue
		}
		if (stack.length > MAX_DEPTH) {
			overflow.push(tag.name)
			continue
		}
		const elementChildren: HTMLNode[] = []
		const element: ElementNode = {
			category: 'element',
			name: tag.name,
			attributes: tag.attributes,
			children: elementChildren,
		}
		current.children.push(element)
		siblingLists.push(elementChildren)
		stack.push({ name: tag.name, children: elementChildren })
	}
	for (const siblings of siblingLists) {
		const text: string[] = []
		let write = 0
		for (const sibling of siblings) {
			if (sibling.category === 'text') {
				text.push(sibling.value)
				continue
			}
			if (text.length > 0) {
				siblings[write] = { category: 'text', value: text.join('') }
				write += 1
				text.length = 0
			}
			siblings[write] = sibling
			write += 1
		}
		if (text.length > 0) {
			siblings[write] = { category: 'text', value: text.join('') }
			write += 1
		}
		siblings.length = write
	}
	return { category: 'document', children }
}
