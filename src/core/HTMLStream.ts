import type { HTMLNode } from './types.js'

/** Owns the indexed cursor of one shallow document stream. */
export class HTMLStream {
	readonly #children: readonly HTMLNode[]
	readonly #result: ReadableStream<HTMLNode>
	#index = 0

	constructor(children: readonly HTMLNode[]) {
		this.#children = children
		this.#result = new ReadableStream<HTMLNode>({
			pull: (controller) => this.#pull(controller),
		})
	}

	get result(): ReadableStream<HTMLNode> {
		return this.#result
	}

	#pull(controller: ReadableStreamDefaultController<HTMLNode>): void {
		const node = this.#children[this.#index]
		if (node === undefined) {
			controller.close()
			return
		}
		controller.enqueue(node)
		this.#index += 1
	}
}
