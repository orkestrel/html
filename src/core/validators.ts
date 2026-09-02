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
	isInteger,
	isRecord,
	isString,
	literalOf,
	recordOf,
} from '@orkestrel/contract'
import { HTML_WHITESPACE, MAX_DEPTH } from './constants.js'
import { isVoidElement } from './helpers.js'

/**
 * Determines whether a code point may appear in an unambiguous HTML source token.
 *
 * @param value - The value to inspect
 * @returns True if the value is a Unicode scalar outside HTML's control and noncharacter
 * parse-error ranges; false otherwise
 */
export function isHTMLCodePoint(value: unknown): value is number {
	if (!isInteger(value) || value < 0 || value > 0x10ffff) return false
	if (value <= 0x1f) return HTML_WHITESPACE.includes(String.fromCodePoint(value))
	return (
		!(value >= 0x7f && value <= 0x9f) &&
		!(value >= 0xd800 && value <= 0xdfff) &&
		!(value >= 0xfdd0 && value <= 0xfdef) &&
		(value & 0xffff) < 0xfffe
	)
}

/**
 * Determines whether an arbitrary value is a structurally valid HTML attribute.
 *
 * @param value - The value to validate
 * @returns True if the value has exactly an attribute name and an optional string
 * value; false otherwise
 */
export const isHTMLAttribute: Guard<HTMLAttribute> = recordOf({ name: isString, value: isString }, [
	'value',
])

/**
 * Determines whether an arbitrary value is a structurally valid text node.
 *
 * @param value - The value to validate
 * @returns True if the value is a text node; false otherwise
 */
export const isTextNode: Guard<TextNode> = recordOf({
	category: literalOf('text'),
	value: isString,
})

/**
 * Determines whether an arbitrary value is a structurally valid comment node.
 *
 * @param value - The value to validate
 * @returns True if the value is a comment node; false otherwise
 */
export const isCommentNode: Guard<CommentNode> = recordOf({
	category: literalOf('comment'),
	value: isString,
})

/**
 * Determines whether an arbitrary value is a structurally valid doctype node.
 *
 * @param value - The value to validate
 * @returns True if the value is a doctype node; false otherwise
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
 * Determines whether an arbitrary value is a valid HTML node.
 *
 * @param value - The value to validate
 * @returns True if the value is a complete, cycle-free node within
 * {@link MAX_DEPTH}; false otherwise
 */
export function isHTMLNode(value: unknown): value is HTMLNode {
	const outcome = attempt(() => {
		const ancestors = new WeakSet<object>()
		const visited = new WeakSet<object>()
		const pending: Array<{
			readonly value: unknown
			readonly depth: number
			readonly leaving: boolean
		}> = [{ value, depth: 0, leaving: false }]
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
			if (visited.has(entry.value)) continue
			visited.add(entry.value)
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
 * Determines whether an arbitrary value is a valid HTML document.
 *
 * @param value - The value to validate
 * @returns True if the value is a document with valid descendants; false otherwise
 */
export function isHTMLDocument(value: unknown): value is HTMLDocument {
	return isHTMLNode(value) && value.category === 'document'
}

/**
 * Determines whether an arbitrary value is a valid element node.
 *
 * @param value - The value to validate
 * @returns True if the value is an element with valid descendants; false otherwise
 */
export function isElementNode(value: unknown): value is ElementNode {
	return isHTMLNode(value) && value.category === 'element'
}
