import type { HtmlInterface, HtmlOptions } from './types.js'
import { Html } from './Html.js'

/**
 * Create a `HtmlInterface`.
 *
 * @param options - The required entity identity.
 * @returns A working {@link HtmlInterface}
 *
 * @example
 * ```ts
 * import { createHtml } from '@src/core'
 *
 * const instance = createHtml({ id: 'example' })
 * ```
 */
export function createHtml(options: HtmlOptions): HtmlInterface {
	return new Html(options)
}
