import type { HTMLDocument, HTMLInterface } from './types.js'
import { HTML } from './HTML.js'

/**
 * Creates an HTML handle from an HTML string or an already-parsed {@link HTMLDocument} - the
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
 * @example Parse, then query
 * ```ts
 * import { createHTML, isElementNode } from '@orkestrel/html'
 *
 * const page = createHTML('<h1>Title</h1><p>A <b>bold</b> word.</p>')
 *
 * page.document.children[0] // { category: 'element', name: 'h1', attributes: [], children: [...] }
 * page.span(page.document) // { start: 0, end: 40 } - half-open offsets in the original input
 * page.find(isElementNode)?.name // 'h1' - narrowed to ElementNode by the guard overload
 * page.filter(isElementNode).map((element) => element.name) // ['h1', 'p', 'b']
 *
 * const categories: string[] = []
 * for (const node of page.walk()) categories.push(node.category)
 * // ['document', 'element', 'text', 'element', 'text', 'element', 'text', 'text']
 * ```
 */
export function createHTML(input: string | HTMLDocument): HTMLInterface {
	return new HTML(input)
}
