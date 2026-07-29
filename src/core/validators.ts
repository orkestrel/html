import type { Guard } from '@orkestrel/contract'
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
	arrayOf,
	attempt,
	isArray,
	isRecord,
	isString,
	literalOf,
	recordOf,
} from '@orkestrel/contract'
import {
	BLOCK_ELEMENTS,
	LITERAL_ELEMENTS,
	MAX_DEPTH,
	RAW_ELEMENTS,
	SAFE_URL_SCHEMES,
	VOID_ELEMENTS,
} from './constants.js'

/**
 * Determine whether an arbitrary value is a structurally valid HTML attribute.
 *
 * @param value - The value to validate
 * @returns `true` when the value has exactly an attribute name and optional string value
 */
export const isHTMLAttribute: Guard<HTMLAttribute> = recordOf({ name: isString, value: isString }, [
	'value',
])

/**
 * Determine whether an arbitrary value is a structurally valid text node.
 *
 * @param value - The value to validate
 * @returns `true` when the value is a text node
 */
export const isTextNode: Guard<TextNode> = recordOf({
	category: literalOf('text'),
	value: isString,
})

/**
 * Determine whether an arbitrary value is a structurally valid comment node.
 *
 * @param value - The value to validate
 * @returns `true` when the value is a comment node
 */
export const isCommentNode: Guard<CommentNode> = recordOf({
	category: literalOf('comment'),
	value: isString,
})

/**
 * Determine whether an arbitrary value is a structurally valid doctype node.
 *
 * @param value - The value to validate
 * @returns `true` when the value is a doctype node
 */
export const isDoctypeNode: Guard<DoctypeNode> = recordOf(
	{
		category: literalOf('doctype'),
		name: isString,
		public: isString,
		system: isString,
	},
	['public', 'system'],
)

/**
 * Determine whether an arbitrary value is a valid HTML node.
 *
 * @param value - The value to validate
 * @returns `true` when the value is a complete, cycle-free node within {@link MAX_DEPTH}
 */
export function isHTMLNode(value: unknown): value is HTMLNode {
	const outcome = attempt(() => {
		const ancestors = new WeakSet<object>()
		const pending: {
			readonly value: unknown
			readonly depth: number
			readonly leaving: boolean
		}[] = [{ value, depth: 0, leaving: false }]
		while (pending.length > 0) {
			const entry = pending.pop()
			if (entry === undefined) continue
			if (entry.leaving) {
				if (typeof entry.value === 'object' && entry.value !== null) {
					ancestors.delete(entry.value)
				}
				continue
			}
			if (!isRecord(entry.value) || entry.depth > MAX_DEPTH + 1) return false
			if (entry.value.category === 'text') {
				if (!isTextNode(entry.value)) return false
				continue
			}
			if (entry.value.category === 'comment') {
				if (!isCommentNode(entry.value)) return false
				continue
			}
			if (entry.value.category === 'doctype') {
				if (!isDoctypeNode(entry.value)) return false
				continue
			}
			if (
				entry.depth > MAX_DEPTH ||
				(entry.value.category !== 'document' && entry.value.category !== 'element') ||
				ancestors.has(entry.value)
			) {
				return false
			}
			if (entry.value.category === 'document') {
				if (Object.keys(entry.value).length !== 2 || !isArray(entry.value.children)) return false
			} else if (
				Object.keys(entry.value).length !== 4 ||
				!isString(entry.value.name) ||
				!arrayOf(isHTMLAttribute)(entry.value.attributes) ||
				!isArray(entry.value.children) ||
				(isVoidElement(entry.value.name) && entry.value.children.length > 0)
			) {
				return false
			}
			ancestors.add(entry.value)
			pending.push({ value: entry.value, depth: entry.depth, leaving: true })
			for (let index = entry.value.children.length - 1; index >= 0; index -= 1) {
				pending.push({
					value: entry.value.children[index],
					depth: entry.depth + 1,
					leaving: false,
				})
			}
		}
		return true
	})
	return outcome.success && outcome.value
}

/**
 * Determine whether an arbitrary value is a valid HTML document.
 *
 * @param value - The value to validate
 * @returns `true` when the value is a document with valid descendants
 */
export function isHTMLDocument(value: unknown): value is HTMLDocument {
	return isHTMLNode(value) && value.category === 'document'
}

/**
 * Determine whether an arbitrary value is a valid element node.
 *
 * @param value - The value to validate
 * @returns `true` when the value is an element with valid descendants
 */
export function isElementNode(value: unknown): value is ElementNode {
	return isHTMLNode(value) && value.category === 'element'
}

/**
 * Determine whether an element name is void.
 *
 * @param name - The element name
 * @returns `true` when the canonical element set declares the name void
 */
export function isVoidElement(name: string): boolean {
	return VOID_ELEMENTS.has(name.toLowerCase())
}

/**
 * Determine whether an element name contains verbatim raw text.
 *
 * @param name - The element name
 * @returns `true` for `script` and `style`
 */
export function isRawElement(name: string): boolean {
	return RAW_ELEMENTS.has(name.toLowerCase())
}

/**
 * Determine whether an element name contains decoded literal text.
 *
 * @param name - The element name
 * @returns `true` for `title` and `textarea`
 */
export function isLiteralElement(name: string): boolean {
	return LITERAL_ELEMENTS.has(name.toLowerCase())
}

/**
 * Determine whether an element name is a block boundary.
 *
 * @param name - The element name
 * @returns `true` when the canonical block set contains the name
 */
export function isBlockElement(name: string): boolean {
	return BLOCK_ELEMENTS.has(name.toLowerCase())
}

/**
 * Determine whether a URL is relative or uses an allowed non-dangerous scheme.
 *
 * @param value - The already entity-decoded URL value
 * @param schemes - The allowed absolute schemes
 * @returns `true` when the URL passes the sanitizer's protocol floor
 */
export function isSafeURL(value: string, schemes: ReadonlySet<string> = SAFE_URL_SCHEMES): boolean {
	let normalized = ''
	for (const character of value) {
		const point = character.codePointAt(0)
		if (point !== undefined && point > 0x20 && point !== 0x7f) normalized += character
	}
	if (
		normalized.length === 0 ||
		normalized.startsWith('//') ||
		normalized.startsWith('\\\\') ||
		normalized.startsWith('/\\') ||
		normalized.startsWith('\\/')
	) {
		return false
	}
	const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(normalized)
	if (match === null) return true
	const scheme = (match[1] ?? '').toLowerCase()
	if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript' || scheme === 'file') {
		return false
	}
	return schemes.has(scheme)
}

/**
 * Determine whether an element has no child nodes.
 *
 * @param element - The element to inspect
 * @returns `true` when `children` is empty
 */
export function isEmptyElement(element: ElementNode): boolean {
	return element.children.length === 0
}
