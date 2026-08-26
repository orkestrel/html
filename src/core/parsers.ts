import type { ElementNode, HTMLDocument, HTMLNode, HTMLSpan, TextNode } from './types.js'
import {
	IMPLIED_CLOSERS,
	LITERAL_ELEMENTS,
	MAX_DEPTH,
	RAW_ELEMENTS,
	VOID_ELEMENTS,
} from './constants.js'
import {
	decodeEntities,
	lowercaseASCII,
	scanComment,
	scanDoctype,
	scanRawText,
	scanTag,
} from './helpers.js'

/**
 * Parse an HTML string into a total, depth-bounded document AST.
 *
 * @param html - The HTML page or fragment source
 * @param spans - An optional recorder populated with original-input node regions
 * @returns The parsed document; malformed input recovers without throwing
 */
export function parseDocument(html: string, spans?: Map<HTMLNode, HTMLSpan>): HTMLDocument {
	const [source, offsets] = parseHTMLSource(html)
	const children: HTMLNode[] = []
	const siblingLists: HTMLNode[][] = [children]
	const stack: Array<{
		readonly name: string
		readonly children: HTMLNode[]
		readonly element?: ElementNode
		readonly start: number
	}> = [{ name: '', children, start: 0 }]
	const stackPositions = new Map<string, number[]>()
	const overflow: string[] = []
	const overflowPositions = new Map<string, number[]>()
	const rawSpans = spans === undefined ? undefined : new Map<HTMLNode, HTMLSpan>()
	let index = 0
	while (index < source.length) {
		const tokenStart = index
		const parent = stack[stack.length - 1]
		if (parent === undefined) break
		if (source[index] !== '<') {
			const next = source.indexOf('<', index)
			const end = next < 0 ? source.length : next
			const value = decodeEntities(source.slice(index, end))
			if (value.length > 0) {
				const node: TextNode = { category: 'text', value }
				parent.children.push(node)
				spans?.set(node, parseHTMLSpan(offsets, index, end))
			}
			index = end
			continue
		}
		if (source.startsWith('<!--', index)) {
			const comment = scanComment(source, index)
			if (comment !== undefined) {
				parent.children.push(comment.node)
				spans?.set(comment.node, parseHTMLSpan(offsets, index, comment.next))
				index = comment.next
				continue
			}
		}
		if (lowercaseASCII(source.slice(index, index + 9)) === '<!doctype') {
			const doctype = scanDoctype(source, index)
			if (doctype !== undefined) {
				parent.children.push(doctype.node)
				spans?.set(doctype.node, parseHTMLSpan(offsets, index, doctype.next))
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
				spans?.set(comment.node, parseHTMLSpan(offsets, index, comment.next))
				index = comment.next
				continue
			}
		}
		const marker = source[index + 1]
		const tagLike =
			/[A-Za-z]/.test(marker ?? '') || marker === '/' || marker === '!' || marker === '?'
		if (!tagLike) {
			const node: TextNode = { category: 'text', value: '<' }
			parent.children.push(node)
			spans?.set(node, parseHTMLSpan(offsets, index, index + 1))
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
			if (removed.element !== undefined) {
				const end = tag.closing && removed.name === tag.name ? tag.next : tokenStart
				spans?.set(removed.element, parseHTMLSpan(offsets, removed.start, end))
			}
			const positions = stackPositions.get(removed.name)
			positions?.pop()
			if (positions?.length === 0) stackPositions.delete(removed.name)
		}
		if (tag.closing) continue
		const current = stack[stack.length - 1]
		if (current === undefined) break
		if (RAW_ELEMENTS.includes(tag.name) || LITERAL_ELEMENTS.includes(tag.name)) {
			const raw = scanRawText(
				source,
				index,
				tag.name,
				LITERAL_ELEMENTS.includes(tag.name),
				rawSpans,
			)
			const rawSpan = rawSpans?.get(raw.node)
			if (stack.length <= MAX_DEPTH) {
				const element: ElementNode = {
					category: 'element',
					name: tag.name,
					attributes: tag.attributes,
					children: [raw.node],
				}
				current.children.push(element)
				if (rawSpan !== undefined) {
					spans?.set(raw.node, parseHTMLSpan(offsets, rawSpan.start, rawSpan.end))
				}
				spans?.set(element, parseHTMLSpan(offsets, tokenStart, raw.next))
			} else {
				current.children.push(raw.node)
				if (rawSpan !== undefined) {
					spans?.set(raw.node, parseHTMLSpan(offsets, rawSpan.start, rawSpan.end))
				}
			}
			rawSpans?.delete(raw.node)
			index = raw.next
			continue
		}
		if (VOID_ELEMENTS.includes(tag.name)) {
			if (stack.length <= MAX_DEPTH) {
				const element: ElementNode = {
					category: 'element',
					name: tag.name,
					attributes: tag.attributes,
					children: [],
				}
				current.children.push(element)
				spans?.set(element, parseHTMLSpan(offsets, tokenStart, tag.next))
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
		stack.push({ name: tag.name, children: elementChildren, element, start: tokenStart })
	}
	while (stack.length > 1) {
		const removed = stack.pop()
		if (removed?.element !== undefined) {
			spans?.set(removed.element, parseHTMLSpan(offsets, removed.start, source.length))
		}
	}
	for (const siblings of siblingLists) {
		const text: TextNode[] = []
		let write = 0
		for (const sibling of siblings) {
			if (sibling.category === 'text') {
				text.push(sibling)
				continue
			}
			if (text.length > 0) {
				const merged: TextNode = {
					category: 'text',
					value: text.map((node) => node.value).join(''),
				}
				siblings[write] = merged
				const first = text[0]
				const last = text[text.length - 1]
				const start = first === undefined ? undefined : spans?.get(first)?.start
				const end = last === undefined ? undefined : spans?.get(last)?.end
				if (start !== undefined && end !== undefined) spans?.set(merged, { start, end })
				for (const node of text) spans?.delete(node)
				write += 1
				text.length = 0
			}
			siblings[write] = sibling
			write += 1
		}
		if (text.length > 0) {
			const merged: TextNode = {
				category: 'text',
				value: text.map((node) => node.value).join(''),
			}
			siblings[write] = merged
			const first = text[0]
			const last = text[text.length - 1]
			const start = first === undefined ? undefined : spans?.get(first)?.start
			const end = last === undefined ? undefined : spans?.get(last)?.end
			if (start !== undefined && end !== undefined) spans?.set(merged, { start, end })
			for (const node of text) spans?.delete(node)
			write += 1
		}
		siblings.length = write
	}
	const document: HTMLDocument = { category: 'document', children }
	spans?.set(document, parseHTMLSpan(offsets, 0, source.length))
	return document
}

/**
 * Normalize an HTML input and map every normalized boundary to its original UTF-16 offset.
 *
 * @param html - The original HTML input
 * @returns The normalized source and its boundary-to-original offset map
 */
export function parseHTMLSource(
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
 * Project a normalized half-open region through an original-input boundary map.
 *
 * @param offsets - The boundary map returned by {@link parseHTMLSource}
 * @param start - The inclusive normalized-source offset
 * @param end - The exclusive normalized-source offset
 * @returns The matching original-input region
 */
export function parseHTMLSpan(offsets: readonly number[], start: number, end: number): HTMLSpan {
	const originalStart = offsets[start] ?? 0
	return { start: originalStart, end: offsets[end] ?? originalStart }
}
