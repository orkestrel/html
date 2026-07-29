/**
 * The elements that cannot have children - a start tag is the whole element and a close
 * tag for one is discarded. Voidness is looked up here rather than stored on
 * `ElementNode`, so a node can never disagree with its own tag name, and the renderer
 * writes `<br>` (never `<br/>` and never a close tag) for every member.
 */
export const VOID_ELEMENTS: ReadonlySet<string> = Object.freeze(
	new Set([
		'area',
		'base',
		'br',
		'col',
		'embed',
		'hr',
		'img',
		'input',
		'link',
		'meta',
		'source',
		'track',
		'wbr',
	]),
)

/**
 * The elements whose content is raw text: everything up to the matching close tag - which
 * is recognized case-insensitively - becomes one verbatim `TextNode` with no tag scanning
 * and no character-reference decoding inside. This is the parser's most important safety
 * boundary, so the renderer refuses to write a raw body that itself contains that close
 * tag sequence rather than emit markup that would reopen the element.
 */
export const RAW_ELEMENTS: ReadonlySet<string> = Object.freeze(new Set(['script', 'style']))

/**
 * The elements whose content is literal text - one `TextNode` up to the matching close
 * tag, with character references decoded but no markup parsed. They differ from
 * `RAW_ELEMENTS` only by that decoding: `<title>a &amp; b</title>` holds `a & b`.
 */
export const LITERAL_ELEMENTS: ReadonlySet<string> = Object.freeze(new Set(['textarea', 'title']))

/**
 * The elements that carry document structure rather than inline content. They are the
 * elements that implicitly close an open `p` (see `IMPLIED_CLOSERS`) and the boundaries
 * across which the distiller collapses whitespace instead of preserving it.
 */
export const BLOCK_ELEMENTS: ReadonlySet<string> = Object.freeze(
	new Set([
		'address',
		'article',
		'aside',
		'blockquote',
		'caption',
		'center',
		'dd',
		'details',
		'dialog',
		'dir',
		'div',
		'dl',
		'dt',
		'fieldset',
		'figcaption',
		'figure',
		'footer',
		'form',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'header',
		'hgroup',
		'hr',
		'li',
		'main',
		'menu',
		'nav',
		'ol',
		'p',
		'pre',
		'search',
		'section',
		'summary',
		'table',
		'tbody',
		'td',
		'tfoot',
		'th',
		'thead',
		'tr',
		'ul',
	]),
)

/**
 * The implied end-tag table: for each element that can be left open, the start tags whose
 * arrival closes it. The parser walks its open elements from the innermost outward,
 * closing each one whose entry contains the incoming tag and stopping at the first that
 * does not - which is how `<p>one<p>two`, `<li>a<li>b`, `<dt>t<dd>d`, and a bare
 * `<tr><td>x<td>y` recover into the structure their author meant. An open `p` maps to the
 * whole `BLOCK_ELEMENTS` set rather than to a second copy of it, so the two can never
 * drift apart.
 */
export const IMPLIED_CLOSERS: ReadonlyMap<string, ReadonlySet<string>> = Object.freeze(
	new Map([
		['p', BLOCK_ELEMENTS],
		['li', Object.freeze(new Set(['li']))],
		['dt', Object.freeze(new Set(['dt', 'dd']))],
		['dd', Object.freeze(new Set(['dt', 'dd']))],
		['option', Object.freeze(new Set(['option', 'optgroup']))],
		['optgroup', Object.freeze(new Set(['optgroup']))],
		['rt', Object.freeze(new Set(['rt', 'rp']))],
		['rp', Object.freeze(new Set(['rt', 'rp']))],
		['td', Object.freeze(new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']))],
		['th', Object.freeze(new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']))],
		['tr', Object.freeze(new Set(['tr', 'thead', 'tbody', 'tfoot']))],
		['thead', Object.freeze(new Set(['thead', 'tbody', 'tfoot']))],
		['tbody', Object.freeze(new Set(['thead', 'tbody', 'tfoot']))],
		['tfoot', Object.freeze(new Set(['thead', 'tbody', 'tfoot']))],
	]),
)

/**
 * The default element allowlist for `sanitize` - the document vocabulary that survives
 * unchanged. A safe element outside this set is unwrapped to its children rather than
 * dropped, so `SanitizeOptions.elements` narrows what is KEPT without ever destroying
 * content; `UNSAFE_ELEMENTS` is the separate, unlowerable list of subtrees that are
 * removed whole.
 */
export const SAFE_ELEMENTS: ReadonlySet<string> = Object.freeze(
	new Set([
		'a',
		'abbr',
		'address',
		'article',
		'aside',
		'b',
		'bdi',
		'bdo',
		'blockquote',
		'br',
		'caption',
		'cite',
		'code',
		'col',
		'colgroup',
		'data',
		'dd',
		'del',
		'details',
		'dfn',
		'div',
		'dl',
		'dt',
		'em',
		'figcaption',
		'figure',
		'footer',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'header',
		'hgroup',
		'hr',
		'i',
		'img',
		'ins',
		'kbd',
		'li',
		'main',
		'mark',
		'menu',
		'nav',
		'ol',
		'p',
		'pre',
		'q',
		'rp',
		'rt',
		'ruby',
		's',
		'samp',
		'search',
		'section',
		'small',
		'span',
		'strong',
		'sub',
		'summary',
		'sup',
		'table',
		'tbody',
		'td',
		'tfoot',
		'th',
		'thead',
		'time',
		'tr',
		'u',
		'ul',
		'var',
		'wbr',
	]),
)

/**
 * The default attribute allowlist for `sanitize` - the attributes that describe content
 * rather than fetch, script, or style it. Deliberately narrow: no `id`, no `style`, no
 * event handler, and no resource `src`, so a sanitized `img` keeps its `alt` text and
 * loses its download. `class` is kept because it is inert once `style`, `link`, `svg`, and
 * `script` are gone and it is where a code block declares its language
 * (`class="language-ts"`).
 */
export const SAFE_ATTRIBUTES: ReadonlySet<string> = Object.freeze(
	new Set([
		'alt',
		'cite',
		'class',
		'colspan',
		'dir',
		'height',
		'href',
		'lang',
		'rowspan',
		'span',
		'start',
		'title',
		'width',
	]),
)

/**
 * The URL schemes a sanitized document may name. A relative URL - anything without a
 * `scheme:` prefix, excluding the protocol-relative forms - is always allowed; every
 * other scheme is refused. `SanitizeOptions.schemes` replaces this set but can never
 * admit `javascript:`, `data:`, `vbscript:`, or `file:`, which are refused outright.
 */
export const SAFE_URL_SCHEMES: ReadonlySet<string> = Object.freeze(
	new Set(['http', 'https', 'mailto', 'tel']),
)

/**
 * The attributes whose value is a URL, and therefore the values `sanitize` decodes,
 * strips of ASCII whitespace and control characters, and scheme-checks before keeping,
 * and that `distill` resolves against `DistillOptions.base`. `action` and `formaction`
 * are listed even though their elements are removed whole, because a hand-built AST can
 * carry them anywhere.
 */
export const URL_ATTRIBUTES: ReadonlySet<string> = Object.freeze(
	new Set(['action', 'cite', 'formaction', 'href', 'poster', 'src']),
)

/**
 * The hard floor of `sanitize`: elements whose entire subtree is removed, never unwrapped,
 * no matter what `SanitizeOptions` allows. Unwrapping is what makes these dangerous -
 * the body of a `script`, `style`, `template`, or `noscript` is text that becomes live
 * markup the moment its wrapper disappears - so the content goes with the element.
 * Foreign content (`svg`, `math`) is here because this AST has no namespaces to police,
 * and the form and metadata elements are here because they act rather than describe.
 */
export const UNSAFE_ELEMENTS: ReadonlySet<string> = Object.freeze(
	new Set([
		'applet',
		'base',
		'button',
		'dialog',
		'embed',
		'form',
		'frame',
		'frameset',
		'iframe',
		'input',
		'link',
		'math',
		'meta',
		'noscript',
		'object',
		'option',
		'script',
		'select',
		'style',
		'svg',
		'template',
		'textarea',
	]),
)

/**
 * The default element set `distill` keeps as content: prose, headings, lists, tables,
 * code, and the inline marks that carry meaning. Everything else safe is unwrapped to its
 * children, which is how wrapper soup melts while its text survives. Definition lists are
 * included because a documentation page's terms and definitions are content, not chrome.
 */
export const CONTENT_ELEMENTS: ReadonlySet<string> = Object.freeze(
	new Set([
		'a',
		'b',
		'blockquote',
		'br',
		'code',
		'dd',
		'dl',
		'dt',
		'em',
		'figcaption',
		'figure',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'hr',
		'i',
		'img',
		'li',
		'ol',
		'p',
		'pre',
		'strong',
		'table',
		'tbody',
		'td',
		'th',
		'thead',
		'tr',
		'ul',
	]),
)

/**
 * The default regions `distill` removes whole - the navigation, banner, and margin
 * furniture that surrounds an article rather than belonging to it. Unlike the content
 * set, these are dropped with their children: a navigation menu's link text is noise in
 * every reading of the page.
 */
export const BOILERPLATE_ELEMENTS: ReadonlySet<string> = Object.freeze(
	new Set(['aside', 'footer', 'header', 'menu', 'nav']),
)

/**
 * The content regions `distill` tries in priority order when re-rooting a document.
 * A region qualifies only when it occurs exactly once.
 */
export const REGION_ELEMENTS: readonly string[] = Object.freeze(['main', 'article'])

/**
 * The HTML 4.01 named character references, keyed by name without its `&` and `;`, plus
 * XML's `apos` - the set the parser decodes in text, attribute values, and literal-text
 * elements. A name outside this table stays literal, exactly as written, because
 * inventing a character for an unrecognized reference would corrupt text that never was
 * one. Lookup is a `Map` so a hostile name such as `&constructor;` cannot reach an object
 * prototype, and every value is written as an escape so the table stays readable and
 * verifiable in a diff.
 */
export const NAMED_ENTITIES: ReadonlyMap<string, string> = Object.freeze(
	new Map([
		// The Latin-1 supplement, U+00A0 through U+00FF.
		['nbsp', '\u00A0'],
		['iexcl', '\u00A1'],
		['cent', '\u00A2'],
		['pound', '\u00A3'],
		['curren', '\u00A4'],
		['yen', '\u00A5'],
		['brvbar', '\u00A6'],
		['sect', '\u00A7'],
		['uml', '\u00A8'],
		['copy', '\u00A9'],
		['ordf', '\u00AA'],
		['laquo', '\u00AB'],
		['not', '\u00AC'],
		['shy', '\u00AD'],
		['reg', '\u00AE'],
		['macr', '\u00AF'],
		['deg', '\u00B0'],
		['plusmn', '\u00B1'],
		['sup2', '\u00B2'],
		['sup3', '\u00B3'],
		['acute', '\u00B4'],
		['micro', '\u00B5'],
		['para', '\u00B6'],
		['middot', '\u00B7'],
		['cedil', '\u00B8'],
		['sup1', '\u00B9'],
		['ordm', '\u00BA'],
		['raquo', '\u00BB'],
		['frac14', '\u00BC'],
		['frac12', '\u00BD'],
		['frac34', '\u00BE'],
		['iquest', '\u00BF'],
		['Agrave', '\u00C0'],
		['Aacute', '\u00C1'],
		['Acirc', '\u00C2'],
		['Atilde', '\u00C3'],
		['Auml', '\u00C4'],
		['Aring', '\u00C5'],
		['AElig', '\u00C6'],
		['Ccedil', '\u00C7'],
		['Egrave', '\u00C8'],
		['Eacute', '\u00C9'],
		['Ecirc', '\u00CA'],
		['Euml', '\u00CB'],
		['Igrave', '\u00CC'],
		['Iacute', '\u00CD'],
		['Icirc', '\u00CE'],
		['Iuml', '\u00CF'],
		['ETH', '\u00D0'],
		['Ntilde', '\u00D1'],
		['Ograve', '\u00D2'],
		['Oacute', '\u00D3'],
		['Ocirc', '\u00D4'],
		['Otilde', '\u00D5'],
		['Ouml', '\u00D6'],
		['times', '\u00D7'],
		['Oslash', '\u00D8'],
		['Ugrave', '\u00D9'],
		['Uacute', '\u00DA'],
		['Ucirc', '\u00DB'],
		['Uuml', '\u00DC'],
		['Yacute', '\u00DD'],
		['THORN', '\u00DE'],
		['szlig', '\u00DF'],
		['agrave', '\u00E0'],
		['aacute', '\u00E1'],
		['acirc', '\u00E2'],
		['atilde', '\u00E3'],
		['auml', '\u00E4'],
		['aring', '\u00E5'],
		['aelig', '\u00E6'],
		['ccedil', '\u00E7'],
		['egrave', '\u00E8'],
		['eacute', '\u00E9'],
		['ecirc', '\u00EA'],
		['euml', '\u00EB'],
		['igrave', '\u00EC'],
		['iacute', '\u00ED'],
		['icirc', '\u00EE'],
		['iuml', '\u00EF'],
		['eth', '\u00F0'],
		['ntilde', '\u00F1'],
		['ograve', '\u00F2'],
		['oacute', '\u00F3'],
		['ocirc', '\u00F4'],
		['otilde', '\u00F5'],
		['ouml', '\u00F6'],
		['divide', '\u00F7'],
		['oslash', '\u00F8'],
		['ugrave', '\u00F9'],
		['uacute', '\u00FA'],
		['ucirc', '\u00FB'],
		['uuml', '\u00FC'],
		['yacute', '\u00FD'],
		['thorn', '\u00FE'],
		['yuml', '\u00FF'],
		// Markup-significant and internationalization characters.
		['quot', '\u0022'],
		['amp', '\u0026'],
		['apos', '\u0027'],
		['lt', '\u003C'],
		['gt', '\u003E'],
		['OElig', '\u0152'],
		['oelig', '\u0153'],
		['Scaron', '\u0160'],
		['scaron', '\u0161'],
		['Yuml', '\u0178'],
		['circ', '\u02C6'],
		['tilde', '\u02DC'],
		['ensp', '\u2002'],
		['emsp', '\u2003'],
		['thinsp', '\u2009'],
		['zwnj', '\u200C'],
		['zwj', '\u200D'],
		['lrm', '\u200E'],
		['rlm', '\u200F'],
		['ndash', '\u2013'],
		['mdash', '\u2014'],
		['lsquo', '\u2018'],
		['rsquo', '\u2019'],
		['sbquo', '\u201A'],
		['ldquo', '\u201C'],
		['rdquo', '\u201D'],
		['bdquo', '\u201E'],
		['dagger', '\u2020'],
		['Dagger', '\u2021'],
		['permil', '\u2030'],
		['lsaquo', '\u2039'],
		['rsaquo', '\u203A'],
		['euro', '\u20AC'],
		// Symbols, mathematical symbols, and Greek letters.
		['fnof', '\u0192'],
		['Alpha', '\u0391'],
		['Beta', '\u0392'],
		['Gamma', '\u0393'],
		['Delta', '\u0394'],
		['Epsilon', '\u0395'],
		['Zeta', '\u0396'],
		['Eta', '\u0397'],
		['Theta', '\u0398'],
		['Iota', '\u0399'],
		['Kappa', '\u039A'],
		['Lambda', '\u039B'],
		['Mu', '\u039C'],
		['Nu', '\u039D'],
		['Xi', '\u039E'],
		['Omicron', '\u039F'],
		['Pi', '\u03A0'],
		['Rho', '\u03A1'],
		['Sigma', '\u03A3'],
		['Tau', '\u03A4'],
		['Upsilon', '\u03A5'],
		['Phi', '\u03A6'],
		['Chi', '\u03A7'],
		['Psi', '\u03A8'],
		['Omega', '\u03A9'],
		['alpha', '\u03B1'],
		['beta', '\u03B2'],
		['gamma', '\u03B3'],
		['delta', '\u03B4'],
		['epsilon', '\u03B5'],
		['zeta', '\u03B6'],
		['eta', '\u03B7'],
		['theta', '\u03B8'],
		['iota', '\u03B9'],
		['kappa', '\u03BA'],
		['lambda', '\u03BB'],
		['mu', '\u03BC'],
		['nu', '\u03BD'],
		['xi', '\u03BE'],
		['omicron', '\u03BF'],
		['pi', '\u03C0'],
		['rho', '\u03C1'],
		['sigmaf', '\u03C2'],
		['sigma', '\u03C3'],
		['tau', '\u03C4'],
		['upsilon', '\u03C5'],
		['phi', '\u03C6'],
		['chi', '\u03C7'],
		['psi', '\u03C8'],
		['omega', '\u03C9'],
		['thetasym', '\u03D1'],
		['upsih', '\u03D2'],
		['piv', '\u03D6'],
		['bull', '\u2022'],
		['hellip', '\u2026'],
		['prime', '\u2032'],
		['Prime', '\u2033'],
		['oline', '\u203E'],
		['frasl', '\u2044'],
		['weierp', '\u2118'],
		['image', '\u2111'],
		['real', '\u211C'],
		['trade', '\u2122'],
		['alefsym', '\u2135'],
		['larr', '\u2190'],
		['uarr', '\u2191'],
		['rarr', '\u2192'],
		['darr', '\u2193'],
		['harr', '\u2194'],
		['crarr', '\u21B5'],
		['lArr', '\u21D0'],
		['uArr', '\u21D1'],
		['rArr', '\u21D2'],
		['dArr', '\u21D3'],
		['hArr', '\u21D4'],
		['forall', '\u2200'],
		['part', '\u2202'],
		['exist', '\u2203'],
		['empty', '\u2205'],
		['nabla', '\u2207'],
		['isin', '\u2208'],
		['notin', '\u2209'],
		['ni', '\u220B'],
		['prod', '\u220F'],
		['sum', '\u2211'],
		['minus', '\u2212'],
		['lowast', '\u2217'],
		['radic', '\u221A'],
		['prop', '\u221D'],
		['infin', '\u221E'],
		['ang', '\u2220'],
		['and', '\u2227'],
		['or', '\u2228'],
		['cap', '\u2229'],
		['cup', '\u222A'],
		['int', '\u222B'],
		['there4', '\u2234'],
		['sim', '\u223C'],
		['cong', '\u2245'],
		['asymp', '\u2248'],
		['ne', '\u2260'],
		['equiv', '\u2261'],
		['le', '\u2264'],
		['ge', '\u2265'],
		['sub', '\u2282'],
		['sup', '\u2283'],
		['nsub', '\u2284'],
		['sube', '\u2286'],
		['supe', '\u2287'],
		['oplus', '\u2295'],
		['otimes', '\u2297'],
		['perp', '\u22A5'],
		['sdot', '\u22C5'],
		['lceil', '\u2308'],
		['rceil', '\u2309'],
		['lfloor', '\u230A'],
		['rfloor', '\u230B'],
		['lang', '\u2329'],
		['rang', '\u232A'],
		['loz', '\u25CA'],
		['spades', '\u2660'],
		['clubs', '\u2663'],
		['hearts', '\u2665'],
		['diams', '\u2666'],
	]),
)

/**
 * The recursion depth the parser, the traversals, and the renderers honor before they
 * stop descending - the bound that keeps pathological input (thousands of nested `div`s,
 * a fuzzer's tag soup) from exhausting the call stack. Past this depth the parser appends
 * content to the deepest allowed element instead of nesting further, so parsing stays
 * total and no text is lost.
 */
export const MAX_DEPTH = 64
