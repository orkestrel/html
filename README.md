# @orkestrel/html

A typed HTML AST: parse any page or fragment into readonly nodes, render them back to canonical
HTML, text, or markdown, sanitize them against a floor no option can lower, and distill a page down
to the prose a reader — or a language model — actually wants.

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

## Usage

```ts
import { createHTML, renderMarkdown } from '@orkestrel/html'

const page = createHTML(
	'<nav>Menu</nav><main><h1>Title</h1><p>Read the <a href="/b">guide</a>.</p></main>',
)

const safe = page.sanitize() // the whole page, made safe
const article = page.distill({ base: 'https://x.dev/docs/page' }) // its content, sanitized and extracted

renderMarkdown(article.document) // '# Title\n\nRead the [guide](https://x.dev/b).'
```

## Laws

- **AST fixpoint** — `parseDocument(renderHTML(document))` deep-equals `document`.
- **Canonical idempotence** — `renderHTML(parseDocument(renderHTML(document)))` equals
  `renderHTML(document)`.
- **Sanitize fixpoint** — sanitizing sanitized output changes nothing, directly or through a reparse.

What roundtrips is the AST, not the input bytes: canonical output lowercases names, quotes values,
canonicalizes character references, writes `<br/>` as `<br>`, and keeps dropped constructs dropped.

## Guide

For the full surface, the recovery table, the sanitize floor, and the distill pass, see
[`guides/src/html.md`](guides/src/html.md).

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
