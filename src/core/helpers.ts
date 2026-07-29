import type {
	ElementNode,
	HTMLAttribute,
	HTMLDocument,
	HTMLHandlers,
	HTMLNode,
	HTMLRewriteHandler,
} from './types.js'
import {
	BLOCK_ELEMENTS,
	MAX_DEPTH,
	RAW_ELEMENTS,
	SAFE_URL_SCHEMES,
	URL_ATTRIBUTES,
	VOID_ELEMENTS,
} from './constants.js'
import { decodeEntities } from './parsers.js'

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
 * Backslash-escape plain text that could otherwise be parsed as supported markdown syntax.
 *
 * @param value - Literal text projected from HTML
 * @returns Markdown text whose supported punctuation reparses literally
 */
export function escapeMarkdown(value: string): string {
	let escaped = ''
	for (const character of value) {
		if (
			character === '\\' ||
			character === '*' ||
			character === '_' ||
			character === '`' ||
			character === '[' ||
			character === ']' ||
			character === '#' ||
			character === '>' ||
			character === '|' ||
			character === '+' ||
			character === '-'
		) {
			escaped += `\\${character}`
		} else {
			escaped += character
		}
	}
	return escaped
}

/**
 * Decode and inspect a URL against an explicit scheme allowlist and a fixed dangerous floor.
 *
 * @param value - The source URL, possibly containing HTML entities or obfuscating controls
 * @param schemes - The allowed lowercase absolute schemes
 * @returns The decoded, control-free URL, or `''` when it is unsafe
 */
export function sanitizeURL(value: string, schemes: ReadonlySet<string>): string {
	try {
		let cleaned = ''
		for (const character of decodeEntities(value)) {
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
		if (
			scheme === 'javascript' ||
			scheme === 'data' ||
			scheme === 'vbscript' ||
			scheme === 'file' ||
			!schemes.has(scheme)
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
 * The allowlist narrows what is kept, but three refusals hold whatever it contains: a
 * handler attribute (any case-insensitive `on*` name), a scripting or styling channel
 * (`style`, `srcdoc`), a namespaced or `xmlns` name, and a structurally unwritable name are
 * always removed; a {@link URL_ATTRIBUTES} value is passed through {@link sanitizeURL} and
 * the attribute is REMOVED - not emptied - when nothing safe survives. Names are
 * ASCII-lowercased, source order is preserved, and a valueless attribute stays valueless.
 *
 * @param node - The element whose attributes are being filtered
 * @param attributes - The allowed lowercase attribute names
 * @param schemes - The allowed lowercase absolute URL schemes
 * @returns The attributes a sanitized element keeps, in source order
 */
export function sanitizeAttributes(
	node: ElementNode,
	attributes: ReadonlySet<string>,
	schemes: ReadonlySet<string>,
): readonly HTMLAttribute[] {
	try {
		const kept: HTMLAttribute[] = []
		for (const attribute of node.attributes) {
			const name = attribute.name.toLowerCase()
			if (
				name.length === 0 ||
				/[\s"'/:<=>]/.test(name) ||
				name.startsWith('on') ||
				name === 'style' ||
				name === 'srcdoc' ||
				name === 'xmlns' ||
				!attributes.has(name)
			) {
				continue
			}
			if (!URL_ATTRIBUTES.has(name)) {
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
			if (URL_ATTRIBUTES.has(name) && attribute.value !== undefined) {
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
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (!frame.expanded) {
				const children: HTMLNode[] = []
				if (
					frame.depth < MAX_DEPTH &&
					(current.category === 'document' ||
						(current.category === 'element' && !RAW_ELEMENTS.has(current.name.toLowerCase())))
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
					value = `<!--${current.value.replaceAll('-->', '--&gt;')}-->`
					break
				case 'doctype': {
					const name = current.name.toLowerCase()
					if (!/^[a-z][a-z0-9:-]*$/.test(name)) break
					value = `<!DOCTYPE ${name}`
					if (current.public !== undefined) {
						const quote = current.public.includes('"') ? "'" : '"'
						value += ` PUBLIC ${quote}${current.public}${quote}`
						if (current.system !== undefined) {
							const systemQuote = current.system.includes('"') ? "'" : '"'
							value += ` ${systemQuote}${current.system}${systemQuote}`
						}
					} else if (current.system !== undefined) {
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
						if (attributeName.length === 0 || /[\s=/"'<>]/.test(attributeName)) {
							continue
						}
						attributes +=
							attribute.value === undefined
								? ` ${attributeName}`
								: ` ${attributeName}="${encodeAttribute(attribute.value)}"`
					}
					if (VOID_ELEMENTS.has(name)) {
						value = `<${name}${attributes}>`
						break
					}
					if (RAW_ELEMENTS.has(name)) {
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
 * Block and line-break elements contribute newline boundaries. Other whitespace
 * collapses to spaces. Script and style bodies are excluded; title and textarea text remains.
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
		}[] = [{ node, depth: -1, leaving: false }]
		let value = ''
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (frame.leaving) {
				if (
					current.category === 'element' &&
					(BLOCK_ELEMENTS.has(current.name.toLowerCase()) || current.name.toLowerCase() === 'br')
				) {
					value += '\n'
				}
				continue
			}
			if (current.category === 'text') {
				value += current.value.replace(/\s+/g, ' ')
				continue
			}
			if (current.category !== 'document' && current.category !== 'element') continue
			if (current.category === 'element' && RAW_ELEMENTS.has(current.name.toLowerCase())) {
				continue
			}
			const boundary =
				current.category === 'element' &&
				(BLOCK_ELEMENTS.has(current.name.toLowerCase()) || current.name.toLowerCase() === 'br')
			if (boundary) value += '\n'
			if (frame.depth >= MAX_DEPTH) continue
			stack.push({ node: current, depth: frame.depth, leaving: true })
			const depth = current.category === 'document' ? 0 : frame.depth + 1
			for (let index = current.children.length - 1; index >= 0; index -= 1) {
				const child = current.children[index]
				if (child !== undefined) stack.push({ node: child, depth, leaving: false })
			}
		}
		return value
			.replace(/[ \t]*\n[ \t]*/g, '\n')
			.replace(/\n+/g, '\n')
			.replace(/ +/g, ' ')
			.trim()
	} catch {
		return ''
	}
}

/**
 * Project the supported HTML subset to canonical markdown.
 *
 * @remarks
 * Unsupported elements unwrap to their children. The projection includes headings,
 * paragraphs, nested lists, quotes, fenced code, links, emphasis, tables, images,
 * thematic breaks, and hard line breaks.
 *
 * @param node - The node or document to project
 * @returns Canonical markdown
 */
export function renderMarkdown(node: HTMLNode): string {
	try {
		const stack: {
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}[] = [{ node, depth: -1, expanded: false, count: 0 }]
		const values: {
			readonly value: string
			readonly block: boolean
			readonly list: boolean
			readonly item: boolean
			readonly cell?: { readonly value: string; readonly header: boolean }
			readonly rows: readonly {
				readonly cells: readonly string[]
				readonly header: boolean
			}[]
		}[] = []
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (!frame.expanded) {
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
			const children =
				frame.count === 0 ? [] : values.splice(values.length - frame.count, frame.count)
			let result: {
				readonly value: string
				readonly block: boolean
				readonly list: boolean
				readonly item: boolean
				readonly cell?: { readonly value: string; readonly header: boolean }
				readonly rows: readonly {
					readonly cells: readonly string[]
					readonly header: boolean
				}[]
			} = { value: '', block: false, list: false, item: false, rows: [] }
			if (current.category === 'text') {
				result = {
					value: escapeMarkdown(current.value),
					block: false,
					list: false,
					item: false,
					rows: [],
				}
			} else if (current.category === 'document') {
				const blocks: string[] = []
				for (const child of children) if (child.value.length > 0) blocks.push(child.value)
				result = {
					value: blocks.join('\n\n'),
					block: true,
					list: false,
					item: false,
					rows: [],
				}
			} else if (current.category === 'element') {
				const name = current.name.toLowerCase()
				let joined = ''
				let previousBlock = false
				const rows: { readonly cells: readonly string[]; readonly header: boolean }[] = []
				for (const child of children) {
					if (child.value.length > 0) {
						if (joined.length > 0 && (previousBlock || child.block)) joined += '\n\n'
						joined += child.value
						previousBlock = child.block
					}
					for (const row of child.rows) rows.push(row)
				}
				if (/^h[1-6]$/.test(name)) {
					const level = Number.parseInt(name.slice(1), 10)
					result = {
						value: `${'#'.repeat(level)} ${joined.trim()}`,
						block: true,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'p') {
					result = { value: joined.trim(), block: true, list: false, item: false, rows }
				} else if (name === 'strong' || name === 'b') {
					result = {
						value: joined.length === 0 ? '' : `**${joined}**`,
						block: false,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'em' || name === 'i') {
					result = {
						value: joined.length === 0 ? '' : `*${joined}*`,
						block: false,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'code') {
					let body = ''
					const pending: HTMLNode[] = [...current.children].reverse()
					while (pending.length > 0) {
						const child = pending.pop()
						if (child === undefined) continue
						if (child.category === 'text') {
							body += child.value
						} else if (child.category === 'document' || child.category === 'element') {
							for (let index = child.children.length - 1; index >= 0; index -= 1) {
								const descendant = child.children[index]
								if (descendant !== undefined) pending.push(descendant)
							}
						}
					}
					body = body.replace(/\s*\n\s*/g, ' ')
					let longest = 0
					let run = 0
					for (const character of body) {
						if (character === '`') {
							run += 1
							longest = Math.max(longest, run)
						} else {
							run = 0
						}
					}
					const fence = '`'.repeat(Math.max(1, longest + 1))
					const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : ''
					result = {
						value: `${fence}${pad}${body}${pad}${fence}`,
						block: false,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'pre') {
					const code = current.children[0]
					let body = ''
					let language = ''
					if (code?.category === 'element' && code.name.toLowerCase() === 'code') {
						const pending: HTMLNode[] = [...code.children].reverse()
						while (pending.length > 0) {
							const child = pending.pop()
							if (child === undefined) continue
							if (child.category === 'text') {
								body += child.value
							} else if (child.category === 'document' || child.category === 'element') {
								for (let index = child.children.length - 1; index >= 0; index -= 1) {
									const descendant = child.children[index]
									if (descendant !== undefined) pending.push(descendant)
								}
							}
						}
						const classes = attributeOf(code, 'class')?.split(/\s+/) ?? []
						for (const className of classes) {
							if (className.startsWith('language-') && className.length > 9) {
								language = className.slice(9)
								break
							}
						}
					} else {
						body = renderText(current)
					}
					let longest = 0
					let run = 0
					for (const character of body) {
						if (character === '`') {
							run += 1
							longest = Math.max(longest, run)
						} else {
							run = 0
						}
					}
					const fence = '`'.repeat(Math.max(3, longest + 1))
					result = {
						value: `${fence}${language}\n${body}\n${fence}`,
						block: true,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'a') {
					const href = sanitizeURL(attributeOf(current, 'href') ?? '', SAFE_URL_SCHEMES).replace(
						/[\\()]/g,
						'\\$&',
					)
					result = {
						value: `[${joined}](${href})`,
						block: false,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'img') {
					const alt = escapeMarkdown(attributeOf(current, 'alt') ?? '')
					const source = sanitizeURL(attributeOf(current, 'src') ?? '', SAFE_URL_SCHEMES).replace(
						/[\\()]/g,
						'\\$&',
					)
					result = {
						value: `![${alt}](${source})`,
						block: false,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'br') {
					result = {
						value: '  \n',
						block: false,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'hr') {
					result = { value: '---', block: true, list: false, item: false, rows }
				} else if (name === 'blockquote') {
					const lines = joined.trim().split('\n')
					let quoted = ''
					for (const [index, line] of lines.entries()) {
						if (index > 0) quoted += '\n'
						quoted += line.length === 0 ? '>' : `> ${line}`
					}
					result = {
						value: quoted,
						block: true,
						list: false,
						item: false,
						rows,
					}
				} else if (name === 'li') {
					let body = ''
					for (const child of children) {
						if (child.value.length === 0) continue
						if (body.length > 0) body += child.list ? '\n' : child.block ? '\n\n' : ''
						body += child.value
					}
					result = {
						value: body.trim(),
						block: false,
						list: false,
						item: true,
						rows,
					}
				} else if (name === 'ul' || name === 'ol') {
					let list = ''
					let ordinal = Number.parseInt(attributeOf(current, 'start') ?? '1', 10)
					if (!Number.isFinite(ordinal)) ordinal = 1
					for (const child of children) {
						if (!child.item) continue
						const marker = name === 'ol' ? `${ordinal}. ` : '- '
						ordinal += 1
						const lines = child.value.split('\n')
						for (const [index, line] of lines.entries()) {
							if (list.length > 0) list += '\n'
							list += index === 0 ? `${marker}${line}` : `${' '.repeat(marker.length)}${line}`
						}
					}
					result = {
						value: list,
						block: true,
						list: true,
						item: false,
						rows,
					}
				} else if (name === 'th' || name === 'td') {
					const cell = { value: joined.trim(), header: name === 'th' }
					result = {
						value: cell.value,
						block: false,
						list: false,
						item: false,
						cell,
						rows,
					}
				} else if (name === 'tr') {
					const cells: string[] = []
					let header = false
					for (const child of children) {
						if (child.cell === undefined) continue
						cells.push(child.cell.value)
						if (child.cell.header) header = true
					}
					const row = { cells, header }
					result = {
						value: joined,
						block: true,
						list: false,
						item: false,
						rows: [row],
					}
				} else if (name === 'table') {
					let headerIndex = 0
					for (const [index, row] of rows.entries()) {
						if (row.header) {
							headerIndex = index
							break
						}
					}
					const header = rows[headerIndex]
					if (header === undefined || header.cells.length === 0) {
						result = { value: joined, block: true, list: false, item: false, rows: [] }
					} else {
						const lines: string[] = []
						lines.push(`| ${header.cells.join(' | ')} |`)
						lines.push(`| ${header.cells.map(() => '---').join(' | ')} |`)
						for (const [index, row] of rows.entries()) {
							if (index === headerIndex) continue
							const cells: string[] = []
							for (let column = 0; column < header.cells.length; column += 1) {
								cells.push(row.cells[column] ?? '')
							}
							lines.push(`| ${cells.join(' | ')} |`)
						}
						result = {
							value: lines.join('\n'),
							block: true,
							list: false,
							item: false,
							rows: [],
						}
					}
				} else {
					result = {
						value: joined,
						block: children.some((child) => child.block),
						list: false,
						item: false,
						rows,
					}
				}
			}
			if (stack.length === 0) return result.value.trim()
			values.push(result)
		}
		return ''
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
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
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
	while (stack.length > 0) {
		const frame = stack.pop()
		if (frame === undefined) continue
		if (!frame.expanded) {
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
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (!frame.expanded) {
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
 * @returns The rebuilt document, or the input document if pruning throws
 */
export function pruneDocument(
	document: HTMLDocument,
	prune: (node: HTMLNode) => readonly HTMLNode[],
): HTMLDocument {
	try {
		const stack: {
			readonly node: HTMLNode
			readonly depth: number
			readonly expanded: boolean
			readonly count: number
		}[] = [{ node: document, depth: -1, expanded: false, count: 0 }]
		const results: Array<readonly HTMLNode[]> = []
		while (stack.length > 0) {
			const frame = stack.pop()
			if (frame === undefined) continue
			const current = frame.node
			if (!frame.expanded) {
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
		return document
	} catch {
		return document
	}
}
