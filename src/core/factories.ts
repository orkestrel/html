import type { HTMLDocument, HTMLInterface } from './types.js'
import { HTML } from './HTML.js'

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
 * renderText(page.document) // 'Title\nRead the guide.'
 * ```
 */
export function createHTML(input: string | HTMLDocument): HTMLInterface {
	return new HTML(input)
}
