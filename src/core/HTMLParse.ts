import type {
	ElementNode,
	HTMLDocument,
	HTMLNode,
	HTMLParseResult,
	HTMLSpan,
	HTMLTag,
	HTMLOpenPosition,
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
	findOpenPosition,
	lowercaseASCII,
	normalizeSource,
	projectDepth,
	projectSpan,
	scanComment,
	scanDoctype,
	scanRawText,
	scanTag,
} from './helpers.js'

/**
 * Owns one document parse and projects its finished tree and provenance.
 */
export class HTMLParse {
	readonly #source: string
	readonly #offsets: readonly number[]
	readonly #spans = new Map<HTMLNode, HTMLSpan>()
	readonly #children: HTMLNode[] = []
	readonly #siblings: HTMLNode[][] = [this.#children]
	readonly #stack: Array<{
		readonly name: string
		readonly children: HTMLNode[]
		readonly element?: ElementNode
		readonly start: number
	}> = []
	readonly #stackPositions = new Map<string, number[]>()
	readonly #overflow: string[] = []
	readonly #overflowPositions = new Map<string, number[]>()
	readonly #result: HTMLParseResult
	#index = 0

	constructor(html: string) {
		const [source, offsets] = normalizeSource(html)
		this.#source = source
		this.#offsets = offsets
		this.#stack.push({ name: '', children: this.#children, start: 0 })
		while (this.#index < this.#source.length) {
			const tokenStart = this.#index
			const parent = this.#stack[this.#stack.length - 1]
			if (parent === undefined) break
			if (this.#source[this.#index] !== '<') {
				const next = this.#source.indexOf('<', this.#index)
				const end = next < 0 ? this.#source.length : next
				const value = decodeEntities(this.#source.slice(this.#index, end))
				if (value.length > 0) {
					const node: TextNode = { category: 'text', value }
					parent.children.push(node)
					const span = projectSpan(this.#offsets, this.#index, end)
					if (span !== undefined) this.#spans.set(node, span)
				}
				this.#index = end
				continue
			}
			if (this.#source.startsWith('<!--', this.#index)) {
				const comment = scanComment(this.#source, this.#index)
				if (comment !== undefined) {
					parent.children.push(comment.node)
					const span = projectSpan(this.#offsets, this.#index, comment.next)
					if (span !== undefined) this.#spans.set(comment.node, span)
					this.#index = comment.next
					continue
				}
			}
			if (lowercaseASCII(this.#source.slice(this.#index, this.#index + 9)) === '<!doctype') {
				const doctype = scanDoctype(this.#source, this.#index)
				if (doctype !== undefined) {
					parent.children.push(doctype.node)
					const span = projectSpan(this.#offsets, this.#index, doctype.next)
					if (span !== undefined) this.#spans.set(doctype.node, span)
					this.#index = doctype.next
					continue
				}
				if (this.#source.indexOf('>', this.#index + 2) < 0) {
					this.#index = this.#source.length
					continue
				}
			}
			if (
				this.#source.startsWith('<!', this.#index) ||
				this.#source.startsWith('<?', this.#index)
			) {
				const comment = scanComment(this.#source, this.#index)
				if (comment !== undefined) {
					parent.children.push(comment.node)
					const span = projectSpan(this.#offsets, this.#index, comment.next)
					if (span !== undefined) this.#spans.set(comment.node, span)
					this.#index = comment.next
					continue
				}
			}
			const marker = this.#source[this.#index + 1]
			const tagLike =
				/[A-Za-z]/.test(marker ?? '') || marker === '/' || marker === '!' || marker === '?'
			if (!tagLike) {
				const node: TextNode = { category: 'text', value: '<' }
				parent.children.push(node)
				const span = projectSpan(this.#offsets, this.#index, this.#index + 1)
				if (span !== undefined) this.#spans.set(node, span)
				this.#index += 1
				continue
			}
			const tag = scanTag(this.#source, this.#index)
			if (tag === undefined) {
				const end = this.#source.indexOf('>', this.#index + 1)
				this.#index = end < 0 ? this.#source.length : end + 1
				continue
			}
			this.#index = tag.next
			if (tag.final && VOID_ELEMENTS.includes(tag.name)) continue
			const [stackTarget, overflowTarget] = this.#target(tag)
			while (this.#overflow.length > overflowTarget) {
				const removed = this.#overflow.pop()
				if (removed === undefined) continue
				const positions = this.#overflowPositions.get(removed)
				positions?.pop()
				if (positions?.length === 0) this.#overflowPositions.delete(removed)
			}
			while (this.#stack.length > stackTarget) {
				const removed = this.#stack.pop()
				if (removed === undefined) continue
				if (removed.element !== undefined) {
					const end = tag.final && removed.name === tag.name ? tag.next : tokenStart
					const span = projectSpan(this.#offsets, removed.start, end)
					if (span !== undefined) this.#spans.set(removed.element, span)
				}
				const positions = this.#stackPositions.get(removed.name)
				positions?.pop()
				if (positions?.length === 0) this.#stackPositions.delete(removed.name)
			}
			if (tag.final) continue
			const current = this.#stack[this.#stack.length - 1]
			if (current === undefined) break
			if (RAW_ELEMENTS.includes(tag.name) || LITERAL_ELEMENTS.includes(tag.name)) {
				const raw = scanRawText(
					this.#source,
					this.#index,
					tag.name,
					LITERAL_ELEMENTS.includes(tag.name),
				)
				if (this.#stack.length <= MAX_DEPTH) {
					const element: ElementNode = {
						category: 'element',
						name: tag.name,
						attributes: tag.attributes,
						children: [raw.node],
					}
					current.children.push(element)
					const rawSpan = projectSpan(this.#offsets, raw.span.start, raw.span.end)
					if (rawSpan !== undefined) this.#spans.set(raw.node, rawSpan)
					const elementSpan = projectSpan(this.#offsets, tokenStart, raw.next)
					if (elementSpan !== undefined) this.#spans.set(element, elementSpan)
				} else {
					current.children.push(raw.node)
					const rawSpan = projectSpan(this.#offsets, raw.span.start, raw.span.end)
					if (rawSpan !== undefined) this.#spans.set(raw.node, rawSpan)
				}
				this.#index = raw.next
				continue
			}
			if (VOID_ELEMENTS.includes(tag.name)) {
				if (this.#stack.length <= MAX_DEPTH) {
					const element: ElementNode = {
						category: 'element',
						name: tag.name,
						attributes: tag.attributes,
						children: [],
					}
					current.children.push(element)
					const span = projectSpan(this.#offsets, tokenStart, tag.next)
					if (span !== undefined) this.#spans.set(element, span)
				}
				continue
			}
			if (this.#stack.length > MAX_DEPTH) {
				const positions = this.#overflowPositions.get(tag.name)
				if (positions === undefined) {
					this.#overflowPositions.set(tag.name, [this.#overflow.length])
				} else {
					positions.push(this.#overflow.length)
				}
				this.#overflow.push(tag.name)
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
			this.#siblings.push(elementChildren)
			const positions = this.#stackPositions.get(tag.name)
			if (positions === undefined) {
				this.#stackPositions.set(tag.name, [this.#stack.length])
			} else {
				positions.push(this.#stack.length)
			}
			this.#stack.push({ name: tag.name, children: elementChildren, element, start: tokenStart })
		}
		while (this.#stack.length > 1) {
			const removed = this.#stack.pop()
			if (removed?.element !== undefined) {
				const span = projectSpan(this.#offsets, removed.start, this.#source.length)
				if (span !== undefined) this.#spans.set(removed.element, span)
			}
		}
		for (const siblings of this.#siblings) this.#coalesce(siblings)
		const document: HTMLDocument = { category: 'document', children: this.#children }
		const span = projectSpan(this.#offsets, 0, this.#source.length)
		if (span !== undefined) this.#spans.set(document, span)
		this.#result = [document, this.#spans]
	}

	get result(): HTMLParseResult {
		return this.#result
	}

	#target(tag: HTMLTag): readonly [stack: number, overflow: number] {
		const match = tag.final
			? findOpenPosition(this.#stackPositions, this.#overflowPositions, tag.name)
			: this.#implied(tag.name)
		if (match === undefined) return [this.#stack.length, this.#overflow.length]
		return match.overflow ? [this.#stack.length, match.position] : [match.position, 0]
	}

	#implied(name: string): HTMLOpenPosition | undefined {
		const candidates = Object.entries(IMPLIED_CLOSERS)
			.flatMap(([open, closers]) => {
				if (!closers.includes(name)) return []
				const match = findOpenPosition(this.#stackPositions, this.#overflowPositions, open)
				return match === undefined ? [] : [{ name: open, ...match }]
			})
			.sort(
				(left, right) =>
					projectDepth(right.overflow, right.position, this.#stack.length) -
					projectDepth(left.overflow, left.position, this.#stack.length),
			)
		return candidates.reduce<HTMLOpenPosition | undefined>((previous, candidate) => {
			const depth = projectDepth(candidate.overflow, candidate.position, this.#stack.length)
			const barriers = Object.hasOwn(IMPLIED_BARRIERS, candidate.name)
				? IMPLIED_BARRIERS[candidate.name]
				: undefined
			const blocked = barriers?.some((barrier) => {
				const match = findOpenPosition(this.#stackPositions, this.#overflowPositions, barrier)
				return (
					match !== undefined &&
					projectDepth(match.overflow, match.position, this.#stack.length) > depth
				)
			})
			return blocked ? previous : candidate
		}, undefined)
	}

	#coalesce(siblings: HTMLNode[]): void {
		const starts = siblings.flatMap((sibling, index) =>
			sibling.category === 'text' && siblings[index - 1]?.category === 'text' ? [] : [index],
		)
		const merged = starts.map((start, position): HTMLNode => {
			const nodes = siblings.slice(start, starts[position + 1])
			const first = nodes[0]
			if (first === undefined) throw new Error('Missing parsed sibling')
			if (first.category !== 'text') return first
			const text = nodes.filter((node): node is TextNode => node.category === 'text')
			const node: TextNode = { category: 'text', value: text.map((child) => child.value).join('') }
			const last = text[text.length - 1]
			const origin = this.#spans.get(first)?.start
			const end = last === undefined ? undefined : this.#spans.get(last)?.end
			if (origin !== undefined && end !== undefined) {
				this.#spans.set(node, { start: origin, end })
			}
			for (const child of text) this.#spans.delete(child)
			return node
		})
		for (const [index, node] of merged.entries()) siblings[index] = node
		siblings.length = merged.length
	}
}
