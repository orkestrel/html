import type {
	ElementNode,
	HTMLAttribute,
	HTMLDocument,
	HTMLHandlers,
	HTMLNode,
	HTMLPruneHandler,
	HTMLRewriteHandler,
} from './types.js'
import {
	BLOCK_ELEMENTS,
	MAX_DEPTH,
	NAMED_ENTITIES,
	RAW_ELEMENTS,
	TABLE_ALIGNMENTS,
	TABLE_CELL_ELEMENTS,
	URL_ATTRIBUTES,
	VOID_ELEMENTS,
} from './constants.js'

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
		const stack: {
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}[] = [{ node, depth: -1, expanded: false, count: 0 }]
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
		const stack: {
			readonly node: HTMLNode
			readonly depth: number
			readonly leaving: boolean
			readonly parent: ElementNode | undefined
			readonly table: ElementNode | undefined
			readonly preserved: boolean
		}[] = [
			{
				node,
				depth: -1,
				leaving: false,
				parent: undefined,
				table: undefined,
				preserved: false,
			},
		]
		const segments: {
			readonly value: string
			readonly mode: 'normal' | 'preserved' | 'cell' | 'row'
		}[] = []
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
		const stack: { readonly node: HTMLNode; readonly depth: number }[] = [{ node, depth: -1 }]
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
	const stack: {
		readonly node: HTMLNode
		readonly depth: number
		readonly expanded: boolean
		readonly count: number
	}[] = [{ node, depth: -1, expanded: false, count: 0 }]
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
 * Rewrite a document bottom-up with copy-on-write identity preservation.
 *
 * @remarks
 * The handler receives children after their rewrites. A subtree whose descendants and
 * own handler result are unchanged retains its original reference. Descent stops at
 * {@link MAX_DEPTH}; the capped subtree passes through unchanged.
 *
 * @param document - The document to rewrite
 * @param rewrite - The bottom-up rewrite handler
 * @returns The rewritten document, or the input document if rewriting throws
 */
export function rewriteDocument(document: HTMLDocument, rewrite: HTMLRewriteHandler): HTMLDocument {
	try {
		const stack: {
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}[] = [{ node: document, depth: -1, expanded: false, count: 0 }]
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
				}
			}
			const rewritten = rewrite(candidate)
			if (stack.length === 0) {
				return rewritten.category === 'document'
					? rewritten
					: candidate.category === 'document'
						? candidate
						: document
			}
			values.push(rewritten)
		}
		return document
	} catch {
		return document
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
 * Collapse the whitespace runs inside each direct text child of a sibling list.
 *
 * @remarks
 * Every run of whitespace becomes one space and edge whitespace is KEPT, because the space
 * between `<b>one</b>` and `<i>two</i>` is a word boundary rather than decoration. Applying
 * this at the element that keeps the text - never at one being unwrapped - is what leaves a
 * `pre` or `code` body verbatim while the surrounding prose collapses.
 *
 * @param children - The sibling list whose text children are collapsed
 * @returns The list with each text child's whitespace collapsed
 */
export function collapseText(children: readonly HTMLNode[]): readonly HTMLNode[] {
	try {
		const collapsed: HTMLNode[] = []
		for (const child of children) {
			if (child === undefined) continue
			collapsed.push(
				child.category === 'text'
					? { category: 'text', value: child.value.replace(/\s+/g, ' ') }
					: child,
			)
		}
		return collapsed
	} catch {
		return children
	}
}

/**
 * Re-root a document at the sole occurrence of one of the named region elements.
 *
 * @remarks
 * The names are tried in order and the first one occurring EXACTLY once in the document
 * wins - its children become the new root's children, so everything outside the region is
 * discarded. A name that is absent, or that occurs more than once, is ambiguous evidence
 * and is skipped; when no name qualifies the document is returned unchanged.
 *
 * @param document - The document to re-root
 * @param names - The candidate region element names, most specific first
 * @returns The re-rooted document, or the original when no region qualifies
 */
export function extractRegion(document: HTMLDocument, names: readonly string[]): HTMLDocument {
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
				return { category: 'document', children: region.children }
			}
		}
		return document
	} catch {
		return document
	}
}

/**
 * Rebuild a document bottom-up, letting each node become any number of nodes.
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
 * @returns The rebuilt document, or an empty document if pruning throws
 */
export function pruneDocument(document: HTMLDocument, prune: HTMLPruneHandler): HTMLDocument {
	try {
		const stack: {
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}[] = [{ node: document, depth: -1, expanded: false, count: 0 }]
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
				}
			}
			const replacements = prune(candidate)
			if (stack.length === 0) {
				const root = replacements[0]
				if (root !== undefined && root.category === 'document') return root
				const rest: HTMLNode[] = []
				for (const node of replacements) if (node.category !== 'document') rest.push(node)
				return { category: 'document', children: rest }
			}
			results.push(replacements)
		}
		return { category: 'document', children: [] }
	} catch {
		return { category: 'document', children: [] }
	}
}
