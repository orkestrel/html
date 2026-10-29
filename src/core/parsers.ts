import type { HTMLDocument, HTMLParseResult } from './types.js'
import { HTMLParse } from './HTMLParse.js'

/**
 * Parses an HTML string into a total, depth-bounded document AST - a page and a bare
 * fragment are the same shape.
 *
 * @remarks
 * Parsing is total: malformed markup recovers per the package's documented recovery table
 * instead of throwing, so there is no error path to handle. The result never carries two
 * adjacent text siblings, which is what keeps a document equal to its own reparsed
 * serialization.
 *
 * @param html - The HTML page or fragment source
 * @returns The parsed document; malformed input recovers without throwing
 */
export function parseDocument(html: string): HTMLDocument {
	return parseProvenance(html)[0]
}

/**
 * Parses an HTML string with original-input node regions.
 *
 * @remarks
 * This is the single document walk that turns source into an AST; `parseDocument` projects
 * the bare document out of the same walk for callers needing no provenance. The returned map
 * is operation-owned, and a node with no single source has no entry.
 *
 * @param html - The HTML page or fragment source
 * @returns The parsed document and its operation-owned spans
 */
export function parseProvenance(html: string): HTMLParseResult {
	return new HTMLParse(html).result
}
