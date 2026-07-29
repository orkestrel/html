import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSource, parseManifest } from '@orkestrel/guide'

/** Repository root used by guide/source parity tests. */
export const GUIDE_ROOT = fileURLToPath(new URL('../', import.meta.url))

/** Repository roots whose TypeScript and Markdown files participate in guide parity. */
export const GUIDE_WALK_DIRECTORIES: readonly string[] = Object.freeze([
	'src',
	'guides',
	'tests',
])

export const SELF_SPECIFIERS = ['@orkestrel/html', '@src/core']

export const SPECIFIER_MODULES: Readonly<Record<string, string>> = {
	'@orkestrel/html': 'src/core',
	'@src/core': 'src/core',
}
export const SPECIFIER_SOURCES = new Map<string, ReturnType<typeof createSource>>()
export function exportsFor(specifier: string): readonly string[] {
	const module = SPECIFIER_MODULES[specifier]
	if (module === undefined) return []
	let source = SPECIFIER_SOURCES.get(module)
	if (source === undefined) {
		source = createSource({ files: GUIDE_FILES, module })
		SPECIFIER_SOURCES.set(module, source)
	}
	return source.exports().map((symbol) => symbol.name)
}

/** Recursively collect one guide-parity source directory. */
export function walkGuideDirectory(
	root: string,
	directory: string,
	files: Record<string, string>,
): void {
	for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
		const relative = `${directory}/${entry.name}`
		if (entry.isDirectory()) {
			walkGuideDirectory(root, relative, files)
			continue
		}
		if (/^app\/(?:browser|server)\/main\.ts$/.test(relative)) continue
		if (!/\.(?:cts|md|mts|ts|tsx)$/.test(entry.name)) continue
		files[relative] = readFileSync(join(root, relative), 'utf8')
	}
}

/** Read all source text used by guide/source parity. */
export function readGuideWorkspace(
	root: string,
	directories: readonly string[],
): Readonly<Record<string, string>> {
	const files: Record<string, string> = {}
	for (const directory of directories) walkGuideDirectory(root, directory, files)
	files['AGENTS.md'] = readFileSync(join(root, 'AGENTS.md'), 'utf8')
	return Object.freeze(files)
}

/** Complete immutable source corpus used by guide/source parity. */
export const GUIDE_FILES = readGuideWorkspace(GUIDE_ROOT, GUIDE_WALK_DIRECTORIES)

/** Read one required guide-parity source file. */
export function readGuideText(relative: string): string {
	const text = GUIDE_FILES[relative]
	if (text === undefined) throw new Error(`Missing file: ${relative}`)
	return text
}

/** Parsed guide manifest shared by every guide/source parity assertion. */
export const GUIDE_MANIFEST = parseManifest(readGuideText('guides/README.md'), 'guides')
