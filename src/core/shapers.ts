import { literalShape, objectShape, optionalShape, stringShape } from '@orkestrel/contract'

// A shaper is a `ContractShape` VALUE - the JSON-Schema blueprint `createContract`
// (factories.ts) compiles into a schema, a guard, a coercing parser, and a seeded generator
// that all agree. A shape tree has no lazy or self-referential node, so only the LEAVES of
// this AST (types.ts) can be declared here: `HTMLAttribute` and the three childless node
// categories. `ElementNode` and `HTMLDocument` recurse into `HTMLNode` and therefore stay
// hand-written depth- and cycle-capped guards in validators.ts. Recursion never enters the
// shape DSL.

/**
 * The shape of an {@link HTMLAttribute} - an element attribute's name and, when the source
 * wrote one, its value. `value` is optional: its absence is what distinguishes
 * `<input disabled>` from `<input disabled="">`.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { attributeShape } from '@orkestrel/html'
 *
 * const attribute = createContract(attributeShape)
 * attribute.is({ name: 'href', value: '/guide' }) // true
 * attribute.is({ name: 'disabled' })              // true
 * ```
 */
export const attributeShape = objectShape({
	name: stringShape(),
	value: optionalShape(stringShape()),
})

/**
 * The shape of a {@link TextNode} - the decoded character-data leaf.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { textShape } from '@orkestrel/html'
 *
 * const text = createContract(textShape)
 * text.is({ category: 'text', value: 'a & b' }) // true
 * ```
 */
export const textShape = objectShape({
	category: literalShape(['text']),
	value: stringShape(),
})

/**
 * The shape of a {@link CommentNode} - the verbatim, never-decoded comment leaf a bogus
 * comment also recovers to.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { commentShape } from '@orkestrel/html'
 *
 * const comment = createContract(commentShape)
 * comment.is({ category: 'comment', value: ' note ' }) // true
 * ```
 */
export const commentShape = objectShape({
	category: literalShape(['comment']),
	value: stringShape(),
})

/**
 * The shape of a {@link DoctypeNode} - the declared root name plus the optional public and
 * system identifiers of a legacy declaration.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { doctypeShape } from '@orkestrel/html'
 *
 * const doctype = createContract(doctypeShape)
 * doctype.is({ category: 'doctype', name: 'html' })                          // true
 * doctype.is({ category: 'doctype', name: 'html', system: 'legacy.dtd' })    // true
 * ```
 */
export const doctypeShape = objectShape({
	category: literalShape(['doctype']),
	name: stringShape(),
	public: optionalShape(stringShape()),
	system: optionalShape(stringShape()),
})
