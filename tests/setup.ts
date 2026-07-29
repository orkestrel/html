import type { HTMLDocument, HTMLNode } from '@src/core'

// ── Call recorder (a real callback, not a mock) ──────────────────────────────
//
// The test rules require a recording callback when a test only needs to count calls or inspect arguments:
// recorder — a real listener that records every invocation — rather than a test-
// framework spy. `handler` is a genuine callback; `calls` is each invocation's
// argument tuple, in order.

/** A real call-recording callback over an argument tuple, following `.claude/rules/tests.md`. */
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

/**
 * Create a {@link TestRecorderInterface} — a real callback that records each
 * invocation's arguments, for asserting what fired and with what, following
 * `.claude/rules/tests.md`.
 *
 * @typeParam TArgs - The argument tuple the recorded handler receives
 * @returns A recorder whose `handler` records into `calls`
 */
export function createRecorder<TArgs extends readonly unknown[]>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler(...args: TArgs) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/** Whether a repository-relative Vue SFC belongs to the private browser application. */
export function isBrowserVuePath(path: string): boolean {
	const normalized = path.replaceAll('\\', '/')
	return normalized.startsWith('app/browser/')
}

/**
 * Build a deeply nested HTML source around one text leaf.
 *
 * @param depth - The number of nested `div` start and close tags
 * @param leaf - The text placed at the deepest point
 * @returns The nested HTML source
 */
export function buildDeepHTMLInput(depth: number, leaf = 'leaf'): string {
	return `${'<div>'.repeat(depth)}${leaf}${'</div>'.repeat(depth)}`
}

/**
 * Build a deeply nested from-unknown element shape.
 *
 * @param depth - The number of nested element nodes
 * @returns A document-shaped unknown value
 */
export function buildDeepHTMLNode(depth: number): unknown {
	let node: unknown = { category: 'text', value: 'leaf' }
	for (let index = 0; index < depth; index += 1) {
		node = { category: 'element', name: 'div', attributes: [], children: [node] }
	}
	return { category: 'document', children: [node] }
}

/**
 * Build a cyclic from-unknown element shape.
 *
 * @returns An element whose child points back to itself
 */
export function buildCyclicHTMLNode(): unknown {
	const children: unknown[] = []
	const node = { category: 'element', name: 'div', attributes: [], children }
	children.push(node)
	return node
}

/**
 * Throw from a hostile property getter.
 *
 * @returns Never
 */
export function throwHostileHTMLGetter(): never {
	throw new Error('hostile HTML getter')
}

/**
 * Build a value whose discriminant getter throws.
 *
 * @returns The hostile from-unknown value
 */
export function buildHostileHTMLNode(): unknown {
	const node = {}
	Object.defineProperty(node, 'category', {
		enumerable: true,
		get: throwHostileHTMLGetter,
	})
	return node
}

/**
 * Build a revoked proxy that throws on every structural read.
 *
 * @returns The revoked proxy
 */
export function buildRevokedHTMLNode(): unknown {
	const revocable = Proxy.revocable({}, {})
	revocable.revoke()
	return revocable.proxy
}

/**
 * Build a prototype with a throwing inherited property.
 *
 * @returns The hostile prototype
 */
export function buildHostileHTMLPrototype(): object {
	const prototype = {}
	Object.defineProperty(prototype, 'poison', {
		enumerable: true,
		get: throwHostileHTMLGetter,
	})
	return prototype
}

/**
 * Collect decoded text content from a document without recursion.
 *
 * @param document - The document to traverse
 * @returns Concatenated text-node values in source order
 */
export function extractHTMLText(document: HTMLDocument): string {
	const pending: HTMLNode[] = [...document.children].reverse()
	let text = ''
	while (pending.length > 0) {
		const node = pending.pop()
		if (node === undefined) continue
		if (node.category === 'text') {
			text += node.value
			continue
		}
		if (node.category !== 'document' && node.category !== 'element') continue
		for (let index = node.children.length - 1; index >= 0; index -= 1) {
			const child = node.children[index]
			if (child !== undefined) pending.push(child)
		}
	}
	return text
}

/**
 * Measure the greatest element nesting depth in a document.
 *
 * @param document - The document to traverse
 * @returns The maximum element depth below the root
 */
export function measureHTMLDepth(document: HTMLDocument): number {
	const pending: { readonly node: HTMLNode; readonly depth: number }[] = []
	for (const child of document.children) pending.push({ node: child, depth: 0 })
	let maximum = 0
	while (pending.length > 0) {
		const entry = pending.pop()
		if (entry === undefined) continue
		const depth = entry.node.category === 'element' ? entry.depth + 1 : entry.depth
		if (depth > maximum) maximum = depth
		if (entry.node.category !== 'document' && entry.node.category !== 'element') continue
		for (const child of entry.node.children) pending.push({ node: child, depth })
	}
	return maximum
}
