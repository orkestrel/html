# Html

> A complete Html library workspace. Source: [`src/core`](../../src/core).
> Published through `@orkestrel/html`; workspace barrels: `@src/core`.

## Surface

```ts
import { createHtml } from '@orkestrel/html'

const instance = createHtml({ id: 'example' })
```

### Factories

| Name         | Kind     | Summary        |
| ------------ | -------- | -------------- |
| `createHtml` | function | Create a Html. |

### Entities

| Name   | Kind  | Summary          |
| ------ | ----- | ---------------- |
| `Html` | class | The Html entity. |

### Parsers

| Name | Kind | Summary |
| ---- | ---- | ------- |

### Guards

| Name | Kind | Summary |
| ---- | ---- | ------- |

### Handlers

| Name | Kind | Summary |
| ---- | ---- | ------- |

### Errors

| Name | Kind | Summary |
| ---- | ---- | ------- |

### Types

| Name            | Kind      | Summary                      |
| --------------- | --------- | ---------------------------- |
| `HtmlOptions`   | interface | Options for creating a Html. |
| `HtmlInterface` | interface | The Html contract.           |

### Aliases

| Name | Kind | Summary |
| ---- | ---- | ------- |

### Constants

| Name | Kind | Summary |
| ---- | ---- | ------- |

## Tests

- [`tests/policy.test.ts`](../../tests/policy.test.ts) — filename placement and real browser capability probing.
- [`tests/src/core/Html.test.ts`](../../tests/src/core/Html.test.ts) — entity boundaries.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — factory behavior.

## See also

- [`AGENTS.md`](../../AGENTS.md) — the rules.
- [`guide.md`](guide.md) — the mirrored guide for `@orkestrel/guide`, the
  devDependency powering this repo's guides-parity test suite.
- [`README.md`](../README.md) — the guides index.
