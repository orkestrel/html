# @orkestrel/html

A typed HTML AST: parse any page or fragment into readonly nodes, render them back to canonical HTML
or plain text, sanitize them against a floor no option can lower, and distill a page down to the
prose a reader — or a language model — actually wants.

- **Total parsing.** Every input produces a document. No parse options, no issue list, no error path:
  malformed markup recovers per a documented table instead of throwing.
- **One AST, many projections.** Nodes are plain readonly data keyed by `category`; querying,
  rewriting, folding, streaming, sanitizing, and rendering are all operations over it.
- **A real security floor.** `sanitize` removes unsafe subtrees whole, strips every handler and
  styling attribute, and decodes a URL before judging its scheme — whatever the options say.
- **Bounded by design.** Every traversal and renderer is iterative and depth-capped, so hostile
  input degrades instead of exhausting the stack.

## Install

```sh
npm install @orkestrel/html
```

## Requirements

- Node.js >= 22.12
- Ships ES and CommonJS builds with its own `.d.ts` types
- One runtime dependency, `@orkestrel/contract`

## Usage

```ts
import { createHTML, renderHTML, renderText } from '@orkestrel/html'

const page = createHTML(
	'<nav>Menu</nav><main><h1>Title</h1><p>Read the <a href="/b">guide</a>.</p></main>',
)

const safe = page.sanitize() // the whole page, made safe
const article = page.distill({ base: 'https://x.dev/docs/page' }) // its content, sanitized and extracted

// `distill` returns a handle, so the projection stays your choice.
renderHTML(article.document) // '<h1>Title</h1><p>Read the <a href="https://x.dev/b">guide</a>.</p>'
renderText(article.document) // 'Title\nRead the guide.'
```

`renderText` is flat but structural: tabs preserve table cells, newlines preserve table rows and
block boundaries, and whitespace beneath `pre` remains verbatim. Heading levels, link destinations,
list markers and ordinals, nesting depth, and image `alt` attributes do not survive. Read the
distilled AST, or serialize it with `renderHTML`, whenever those semantics are the point.

## Laws

- **AST fixpoint** — `parseDocument(renderHTML(document))` deep-equals a parser-produced `document`.
- **Canonical idempotence** — `renderHTML(parseDocument(renderHTML(document)))` equals
  `renderHTML(document)`.
- **Sanitize fixpoint** — sanitizing sanitized output changes nothing, directly or through a reparse.

What roundtrips is the AST, not the input bytes: canonical output lowercases names, quotes values,
canonicalizes character references, writes `<br/>` as `<br>`, and keeps dropped constructs dropped.
A hand-built AST that breaks an invariant — a void element with children, a comment body that could
close itself — is rendered for safety instead of fidelity.

## Guide

For the full surface, the recovery table, the sanitize floor, and the distill pass, see
[`guides/src/html.md`](guides/src/html.md).

## Package

Published as a single typed entry point per the `exports` field in `package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
