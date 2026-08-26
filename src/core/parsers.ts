import type {
	ElementNode,
	HTMLDocument,
	HTMLNode,
	HTMLParseResult,
	HTMLSpan,
	TextNode,
} from './types.js'
import {
	IMPLIED_BARRIERS,
	IMPLIED_CLOSERS,
	LITERAL_ELEMENTS,
	MAX_DEPTH,
	RAW_ELEMENTS,
	VOID_ELEMENTS,
} from './constants.js'
import {
	decodeEntities,
	lowercaseASCII,
	normalizeSource,
	projectSpan,
	scanComment,
	scanDoctype,
	scanRawText,
	scanTag,
} from './helpers.js'

/**
 * Parses an HTML string into a total, depth-bounded document AST.
 *
 * @param html - The HTML page or fragment source
 * @returns The parsed document; malformed input recovers without throwing
 */
export function parseDocument(html: string): HTMLDocument {
	return parseProvenance(html)[0]
}

/**
 * Parses an HTML string with original-input node regions.
 *
 * @param html - The HTML page or fragment source
 * @returns The parsed document and its operation-owned spans
 */
export function parseProvenance(html: string): HTMLParseResult {
	const [source, offsets] = normalizeSource(html)
	const spans = new Map<HTMLNode, HTMLSpan>()
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
				const span = projectSpan(offsets, index, end)
				if (span !== undefined) spans.set(node, span)
			}
			index = end
			continue
		}
		if (source.startsWith('<!--', index)) {
			const comment = scanComment(source, index)
			if (comment !== undefined) {
				parent.children.push(comment.node)
				const span = projectSpan(offsets, index, comment.next)
				if (span !== undefined) spans.set(comment.node, span)
				index = comment.next
				continue
			}
		}
		if (lowercaseASCII(source.slice(index, index + 9)) === '<!doctype') {
			const doctype = scanDoctype(source, index)
			if (doctype !== undefined) {
				parent.children.push(doctype.node)
				const span = projectSpan(offsets, index, doctype.next)
				if (span !== undefined) spans.set(doctype.node, span)
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
				const span = projectSpan(offsets, index, comment.next)
				if (span !== undefined) spans.set(comment.node, span)
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
			const span = projectSpan(offsets, index, index + 1)
			if (span !== undefined) spans.set(node, span)
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
			const implied: Array<{
				readonly name: string
				readonly overflow: boolean
				readonly position: number
			}> = []
			for (const [open, closers] of Object.entries(IMPLIED_CLOSERS)) {
				if (!closers.includes(tag.name)) continue
				const overflowMatches = overflowPositions.get(open)
				const overflowMatch = overflowMatches?.[overflowMatches.length - 1]
				if (overflowMatch !== undefined) {
					implied.push({ name: open, overflow: true, position: overflowMatch })
					continue
				}
				const stackMatches = stackPositions.get(open)
				const stackMatch = stackMatches?.[stackMatches.length - 1]
				if (stackMatch !== undefined) {
					implied.push({ name: open, overflow: false, position: stackMatch })
				}
			}
			implied.sort((left, right) => {
				const leftDepth = left.overflow ? stack.length + left.position : left.position
				const rightDepth = right.overflow ? stack.length + right.position : right.position
				return rightDepth - leftDepth
			})
			let impliedTarget: (typeof implied)[number] | undefined
			for (const candidate of implied) {
				const candidateDepth = candidate.overflow
					? stack.length + candidate.position
					: candidate.position
				const barriers = Object.hasOwn(IMPLIED_BARRIERS, candidate.name)
					? IMPLIED_BARRIERS[candidate.name]
					: undefined
				let blocked = false
				if (barriers !== undefined) {
					for (const barrier of barriers) {
						const barrierOverflow = overflowPositions.get(barrier)
						const overflowPosition = barrierOverflow?.[barrierOverflow.length - 1]
						const barrierStack = stackPositions.get(barrier)
						const stackPosition = barrierStack?.[barrierStack.length - 1]
						const barrierDepth =
							overflowPosition === undefined ? stackPosition : stack.length + overflowPosition
						if (barrierDepth !== undefined && barrierDepth > candidateDepth) {
							blocked = true
							break
						}
					}
				}
				if (blocked) break
				impliedTarget = candidate
			}
			if (impliedTarget !== undefined) {
				if (impliedTarget.overflow) {
					overflowTarget = impliedTarget.position
				} else {
					overflowTarget = 0
					stackTarget = impliedTarget.position
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
				const span = projectSpan(offsets, removed.start, end)
				if (span !== undefined) spans.set(removed.element, span)
			}
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
				const rawSpan = projectSpan(offsets, raw.span.start, raw.span.end)
				if (rawSpan !== undefined) spans.set(raw.node, rawSpan)
				const elementSpan = projectSpan(offsets, tokenStart, raw.next)
				if (elementSpan !== undefined) spans.set(element, elementSpan)
			} else {
				current.children.push(raw.node)
				const rawSpan = projectSpan(offsets, raw.span.start, raw.span.end)
				if (rawSpan !== undefined) spans.set(raw.node, rawSpan)
			}
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
				const span = projectSpan(offsets, tokenStart, tag.next)
				if (span !== undefined) spans.set(element, span)
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
			const span = projectSpan(offsets, removed.start, source.length)
			if (span !== undefined) spans.set(removed.element, span)
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
				const start = first === undefined ? undefined : spans.get(first)?.start
				const end = last === undefined ? undefined : spans.get(last)?.end
				if (start !== undefined && end !== undefined) spans.set(merged, { start, end })
				for (const node of text) spans.delete(node)
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
			const start = first === undefined ? undefined : spans.get(first)?.start
			const end = last === undefined ? undefined : spans.get(last)?.end
			if (start !== undefined && end !== undefined) spans.set(merged, { start, end })
			for (const node of text) spans.delete(node)
			write += 1
		}
		siblings.length = write
	}
	const document: HTMLDocument = { category: 'document', children }
	const span = projectSpan(offsets, 0, source.length)
	if (span !== undefined) spans.set(document, span)
	return [document, spans]
}
