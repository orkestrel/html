import type { HtmlInterface, HtmlOptions } from './types.js'

/**
 * A working `Html` — pure data, no behavior.
 *
 * @example
 * ```ts
 * const instance = new Html({ id: 'example' })
 * ```
 */
export class Html implements HtmlInterface {
	readonly id: string

	constructor(options: HtmlOptions) {
		this.id = options.id
	}
}
