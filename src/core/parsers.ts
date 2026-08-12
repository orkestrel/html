import type {
	CommentNode,
	DoctypeNode,
	ElementNode,
	HTMLAttribute,
	HTMLDocument,
	HTMLNode,
	HTMLStartTag,
	HTMLTag,
	TextNode,
} from './types.js'
import {
	HTML_WHITESPACE,
	IMPLIED_CLOSERS,
	LITERAL_ELEMENTS,
	MAX_DEPTH,
	RAW_ELEMENTS,
	VOID_ELEMENTS,
} from './constants.js'
import { decodeEntities, lowercaseASCII } from './helpers.js'
import { isHTMLCodePoint } from './validators.js'

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
	const stack: Array<{ readonly name: string; readonly children: HTMLNode[] }> = [
		{ name: '', children },
	]
	const stackPositions = new Map<string, number[]>()
	const overflow: string[] = []
	const overflowPositions = new Map<string, number[]>()
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
		if (lowercaseASCII(source.slice(index, index + 9)) === '<!doctype') {
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
		let stackTarget = stack.length
		let overflowTarget = overflow.length
		if (tag.closing) {
			if (VOID_ELEMENTS.includes(tag.name)) continue
			const overflowMatches = overflowPositions.get(tag.name)
			const overflowMatch = overflowMatches?.[overflowMatches.length - 1]
			if (overflowMatch !== undefined) {
				overflowTarget = overflowMatch
			} else {
				const stackMatches = stackPositions.get(tag.name)
				const stackMatch = stackMatches?.[stackMatches.length - 1]
				if (stackMatch !== undefined) {
					overflowTarget = 0
					stackTarget = stackMatch
				}
			}
		} else {
			while (overflowTarget > 0) {
				const open = overflow[overflowTarget - 1]
				const closers =
					open !== undefined && Object.hasOwn(IMPLIED_CLOSERS, open)
						? IMPLIED_CLOSERS[open]
						: undefined
				if (closers === undefined || !closers.includes(tag.name)) break
				overflowTarget -= 1
			}
			if (overflowTarget === 0) {
				while (stackTarget > 1) {
					const open = stack[stackTarget - 1]?.name
					const closers =
						open !== undefined && Object.hasOwn(IMPLIED_CLOSERS, open)
							? IMPLIED_CLOSERS[open]
							: undefined
					if (closers === undefined || !closers.includes(tag.name)) break
					stackTarget -= 1
				}
			}
		}
		while (overflow.length > overflowTarget) {
			const removed = overflow.pop()
			if (removed === undefined) continue
			const positions = overflowPositions.get(removed)
			positions?.pop()
			if (positions?.length === 0) overflowPositions.delete(removed)
		}
		while (stack.length > stackTarget) {
			const removed = stack.pop()
			if (removed === undefined) continue
			const positions = stackPositions.get(removed.name)
			positions?.pop()
			if (positions?.length === 0) stackPositions.delete(removed.name)
		}
		if (tag.closing) continue
		const current = stack[stack.length - 1]
		if (current === undefined) break
		if (RAW_ELEMENTS.includes(tag.name) || LITERAL_ELEMENTS.includes(tag.name)) {
			const raw = scanRawText(source, index, tag.name, LITERAL_ELEMENTS.includes(tag.name))
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
		if (VOID_ELEMENTS.includes(tag.name)) {
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
			const positions = overflowPositions.get(tag.name)
			if (positions === undefined) {
				overflowPositions.set(tag.name, [overflow.length])
			} else {
				positions.push(overflow.length)
			}
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
		const positions = stackPositions.get(tag.name)
		if (positions === undefined) {
			stackPositions.set(tag.name, [stack.length])
		} else {
			positions.push(stack.length)
		}
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
