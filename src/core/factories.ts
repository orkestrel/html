import type { ContractInterface } from '@orkestrel/contract'
import type {
	CommentNode,
	DoctypeNode,
	HTMLAttribute,
	HTMLDocument,
	HTMLInterface,
	TextNode,
} from './types.js'
import { createContract } from '@orkestrel/contract'
import { HTML } from './HTML.js'
import { attributeShape, commentShape, doctypeShape, textShape } from './shapers.js'

/**
 * Create an HTML handle from an HTML string or an already-parsed {@link HTMLDocument} - the
 * typed AST plus the query, rewrite, fold, streaming, and shaping operations
 * {@link HTMLInterface} exposes.
 *
 * @remarks
 * Given a `string`, parses it into an {@link HTMLDocument}: a whole page and a bare fragment
 * are the same shape here, nothing is implied or inserted that the source did not write, and
 * parsing is TOTAL - malformed markup recovers instead of throwing, so there is no error
 * path to handle. Given an {@link HTMLDocument}, that document is adopted AS-IS and is not
 * re-validated; gate an untrusted value with `isHTMLDocument` first.
 *
 * @param input - An HTML string to parse, or an already-parsed {@link HTMLDocument}
 * @returns A working {@link HTMLInterface}
 *
 * @example
 * ```ts
 * import { createHTML, renderText } from '@orkestrel/html'
 *
 * const page = createHTML('<h1>Title</h1><p>Read the <a href="/guide">guide</a>.</p>')
 * renderText(page.sanitize().document) // 'Title\nRead the guide.'
 * ```
 */
export function createHTML(input: string | HTMLDocument): HTMLInterface {
	return new HTML(input)
}

/**
 * Compile {@link attributeShape} into a {@link ContractInterface} for {@link HTMLAttribute} -
 * one declaration yielding a JSON Schema, a guard, a coercing parser, and a seeded generator
 * that agree.
 *
 * @returns An `HTMLAttribute` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createAttributeContract } from '@orkestrel/html'
 *
 * const attribute = createAttributeContract()
 * attribute.is({ name: 'href', value: '/guide' }) // true
 * attribute.parse({ name: 'href' })               // { name: 'href' }
 * ```
 */
export function createAttributeContract(): ContractInterface<HTMLAttribute> {
	return createContract(attributeShape)
}

/**
 * Compile {@link textShape} into a {@link ContractInterface} for {@link TextNode} - one
 * declaration yielding a JSON Schema, a guard, a coercing parser, and a seeded generator
 * that agree.
 *
 * @returns A `TextNode` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createTextContract } from '@orkestrel/html'
 *
 * const text = createTextContract()
 * text.is({ category: 'text', value: 'a & b' }) // true
 * ```
 */
export function createTextContract(): ContractInterface<TextNode> {
	return createContract(textShape)
}

/**
 * Compile {@link commentShape} into a {@link ContractInterface} for {@link CommentNode} - one
 * declaration yielding a JSON Schema, a guard, a coercing parser, and a seeded generator
 * that agree.
 *
 * @returns A `CommentNode` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createCommentContract } from '@orkestrel/html'
 *
 * const comment = createCommentContract()
 * comment.is({ category: 'comment', value: ' note ' }) // true
 * ```
 */
export function createCommentContract(): ContractInterface<CommentNode> {
	return createContract(commentShape)
}

/**
 * Compile {@link doctypeShape} into a {@link ContractInterface} for {@link DoctypeNode} - one
 * declaration yielding a JSON Schema, a guard, a coercing parser, and a seeded generator
 * that agree.
 *
 * @returns A `DoctypeNode` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createDoctypeContract } from '@orkestrel/html'
 *
 * const doctype = createDoctypeContract()
 * doctype.is({ category: 'doctype', name: 'html' }) // true
 * ```
 */
export function createDoctypeContract(): ContractInterface<DoctypeNode> {
	return createContract(doctypeShape)
}
