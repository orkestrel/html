# Guides

A dual-axis index into this repository's guides — by concept, and by directory, following the
documentation contract in [`.claude/rules/documentation.md`](../.claude/rules/documentation.md).

## By concept

| Concept | Spec                     | Source                    | Tests                                 |
| ------- | ------------------------ | ------------------------- | ------------------------------------- |
| Html    | [`html.md`](src/html.md) | [`src/core`](../src/core) | [`tests/src/core`](../tests/src/core) |

## By directory

| Directory | Guide                    |
| --------- | ------------------------ |
| src/core  | [`html.md`](src/html.md) |

## Dependency reference

[`src/guide.md`](src/guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides/src/parity.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not anything
sourced in this repo; it is kept here so a reader of the parity suite can see
the primitives it is built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) and [`.claude/rules/documentation.md`](../.claude/rules/documentation.md) — the repository rules and documentation contract.
