# Guides

A dual-axis index into this repository's guides — by concept, and by directory.

## By concept

| Concept | Spec                 | Source                    | Tests                                 |
| ------- | -------------------- | ------------------------- | ------------------------------------- |
| HTML    | [`html.md`](html.md) | [`src/core`](../src/core) | [`tests/src/core`](../tests/src/core) |

## By directory

| Directory  | Guide                |
| ---------- | -------------------- |
| `src/core` | [`html.md`](html.md) |

## Dependency reference

[`contract.md`](contract.md) is a byte-identical mirror of the guide for
`@orkestrel/contract` — this package's sole runtime dependency. It documents
**that package's** surface (guards, combinators, parsers, and the shape DSL), not
anything sourced in this repo; it is kept here so a reader of the HTML AST guards
and leaf-node shapes (`isHTMLNode`, `textShape`, …), and of the contracts a consumer
compiles from those shapes, can see the primitives they are built from without leaving
this guide set.

[`guide.md`](guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not anything
sourced in this repo; it is kept here so a reader of the parity suite can see
the primitives it is built from without leaving this guide set.

[`scaffold.md`](scaffold.md) is a mirror of the guide for
`@orkestrel/scaffold` — the devDependency that generated this workspace. It
documents **that package's** surface (the generator, its target selection, and
the emitted layout), not anything sourced in this repo; it is kept here so a
reader can see which files are scaffold contract and which are this package's
own without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the repository rules, including the documentation contract every guide here is held to.
