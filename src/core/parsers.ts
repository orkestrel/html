import type { ElementNode, HTMLDocument, HTMLNode } from './types.js'
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
