// Verify every t() key and every catalog key lines up, in both languages.
//
// The failure this catches is silent: a key with no catalog entry renders as
// the raw slug ("settings.wipe-app-data") rather than as an error, so nothing
// breaks and the bug ships. Run it in CI, not by hand.
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const en = JSON.parse(readFileSync("locales/en.json", "utf8"));
const es = JSON.parse(readFileSync("locales/es.json", "utf8"));

/** Flatten a nested catalog to "a.b.c" -> value. */
const flatten = (obj, prefix = "", out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
};

const enFlat = flatten(en);
const esFlat = flatten(es);

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
  }
};
walk("src/main-app");

// Literal keys, plus keys built at runtime from a model (RGB_MODES labels).
const used = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  (function v(n) {
    if (
      ts.isCallExpression(n) &&
      // `t(...)` or `i18next.t(...)` — store.ts reaches the singleton directly
      // to avoid an import cycle, and its keys count the same.
      ((ts.isIdentifier(n.expression) && n.expression.text === "t") ||
        (ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "t")) &&
      n.arguments[0]
    ) {
      // Usually the key is a plain literal, but it can sit inside a ternary or
      // a fallback chain. Descend into whatever the argument is so a key hidden
      // in `t(cond ? "a" : "b")` is not silently uncollected. Comparisons and
      // template spans are skipped: those hold identifiers and values, not keys.
      (function key(k) {
        if (ts.isStringLiteralLike(k)) {
          used.add(k.text);
        } else if (ts.isTemplateExpression(k)) {
          if (k.head.text) used.add(k.head.text);
        } else if (ts.isBinaryExpression(k)) {
          // `t(a === "static" ? ... : ...)` — the operands are the condition.
        } else {
          ts.forEachChild(k, key);
        }
      })(n.arguments[0]);
    }
    ts.forEachChild(n, v);
  })(sf);
}

// Keys built at runtime from a model are invisible to the AST walk: the call
// is `t(item.label)`, a variable, not a literal. These models are where that
// happens, so their key fields are read directly.
//
// This matters more than it looks. A model that still holds English COPY
// instead of a key compiles fine, passes typecheck, and renders English inside
// an otherwise translated page — which is exactly the bug this check was
// written to catch.
const MODEL_KEY_FIELDS = /(?:label|blurb|hint|title|description):\s*"([a-z][\w-]*(?:\.[\w{}-]+)+)"/g;
// Tuple models (`["overview", "palette.go-overview", IconZap]`) hold the key
// in the second slot rather than in a named field.
const TUPLE_KEY_SLOT = /\[\s*"[a-z][\w-]*"\s*,\s*"([a-z][\w-]*(?:\.[\w{}-]+)+)"/g;
// An explicit key map — `const GALLERY_KIND_LABEL: Record<K, string> = { video:
// "gallery.kind-video" }` — is the recommended way to keep a key out of a
// template expression, and it is the one shape the walks above miss entirely:
// the literal is an object value, not a `label:` field and not inside `t()`.
// Without this rule every key in the map reads as unused, which trains you to
// ignore the unused report exactly when the map is at its largest.
const EXPLICIT_KEY_MAP =
  /\b[A-Z][A-Z0-9_]*(?:_LABEL|_LABELS|_KEY|_KEYS)\b[^=]{0,120}=\s*\{([^}]*)\}/g;

// Every source file, not a hand-listed few — see the copy-leak scan below for
// why an enumerated list silently rots.
for (const f of [...files, "src/shared/constants.ts"]) {
  if (f.endsWith("i18n.ts")) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(MODEL_KEY_FIELDS)) used.add(m[1]);
  for (const m of src.matchAll(TUPLE_KEY_SLOT)) used.add(m[1]);
  for (const m of src.matchAll(EXPLICIT_KEY_MAP)) {
    for (const lit of m[1].matchAll(/"([a-z][\w-]*(?:\.[\w{}-]+)+)"/g)) used.add(lit[1]);
  }
}

// A model field holding English copy rather than a key is a defect: report it
// rather than letting it reach a Spanish build.
//
// The value is matched as the whole expression after the colon, not just a bare
// literal, because the common shape is a ternary: `label: paused ? "Resume" :
// "Pause"`. A regex anchored on `label: "` sails straight past every one of
// them, which is how five English palette commands survived the migration.
//
// This scans EVERY source file, not a hand-listed few. A list is a promise to
// remember a new file, and the first omission is silent: ui.tsx kept English
// theme labels for the whole migration because nobody added it to the list.
//
// i18n.ts is exempt because it defines the catalogs themselves, and a language
// picker shows each language in its own name ("English", "Español") precisely
// so a speaker who cannot read the current UI can still find their language.
const COPY_FIELDS = /(?:label|blurb|hint|title|description|placeholder):\s*([^,\n]+)/g;
const CAPITALISED = /"([A-Z][^"]*)"/g;
const copyLeaks = [];
for (const f of [...files, "src/shared/constants.ts"]) {
  if (f.endsWith("i18n.ts")) continue;
  const src = readFileSync(f, "utf8");
  for (const field of src.matchAll(COPY_FIELDS)) {
    for (const lit of field[1].matchAll(CAPITALISED)) {
      if (!lit[1].includes(".")) copyLeaks.push(`${f}: ${lit[1]}`);
    }
  }
}

// Rust owns the tray; its keys are checked by the Rust tests instead.
const RUST_OWNED = (key) => key.startsWith("tray.");

const missingEn = [...used].filter((k) => !enFlat.has(k));
const missingEs = [...used].filter((k) => !esFlat.has(k));
const unused = [...enFlat.keys()].filter(
  (k) => !used.has(k) && !RUST_OWNED(k),
);
const untranslated = [...used].filter(
  (k) => enFlat.has(k) && esFlat.has(k) && enFlat.get(k) === esFlat.get(k),
);

// A shell-mangled write doubles every backslash in a value, and JSON.parse
// turns a 63-backslash run into 31 literal backslashes plus the quote it was
// meant to be. It still parses, it still typechecks, and it renders garbage
// punctuation in one language only — so it has to be checked for explicitly.
// i18next interpolates {{var}}, not {var}. A value written as "{n} selected"
// renders literally, so the UI shows the placeholder instead of the count --
// and because the key lookup still succeeds, nothing else in this script
// notices. Keys keep their single braces (that is the naming convention), so
// only the values are checked.
const SINGLE_PLACEHOLDER = /(?<!\{)\{([a-zA-Z_]\w*)\}(?!\})/;
const uninterpolated = [];
for (const [lang, flat] of [
  ["en", enFlat],
  ["es", esFlat],
]) {
  for (const [k, v] of flat) {
    if (typeof v === "string" && SINGLE_PLACEHOLDER.test(v)) uninterpolated.push(`${lang}:${k}`);
  }
}

const mangled = [];
for (const [lang, flat] of [
  ["en", enFlat],
  ["es", esFlat],
]) {
  for (const [k, v] of flat) {
    if (typeof v !== "string" || !v.includes("\\")) continue;
    let run = 0;
    for (const ch of v) {
      if (ch === "\\") {
        run += 1;
        if (run > 1) {
          mangled.push(`${lang}:${k}`);
          break;
        }
      } else run = 0;
    }
  }
}

// Bare JSX text is the remaining blind spot: `{muted ? "Muted" : "Live"}`
// compiled, typechecked, passed every test, and rendered English inside an
// otherwise Spanish page. Neither the key walk nor the copy-field scan can see
// it, because there is no `t()` call and no `label:` field to inspect — the
// words are simply the children of an element.
//
// Two letters in a row is the threshold. It skips separators ("·", "×", "%"),
// stray whitespace and punctuation, which are identical in every language and
// should stay inline.
const BRAND = /\b(LUMENDECK|LumenDeck|OpenRGB|Windows|Discord|GitHub|URL|LED|LEDs|CTRL|Alt|Shift|WIPE|BORRAR)\b/;
// Words that are the same in every language, or are a filename, a command, or
// a fixed token. Translating them would be noise, so they stay inline.
const NOT_COPY = /^(config\.json|DEV|pnpm changelog)$/;
// A dotted slug is a catalog key being chosen, not a word being shown. Those
// are validated by the missing-key checks above.
const SLUG = /^[a-z][\w-]*(\.[\w{}-]+)+$/;
// Tailwind utility prefixes, so a class spliced in by cn()/clsx() is not
// mistaken for a sentence.
const CSS_UTILITY =
  /\b(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|gap|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|text|bg|border|rounded|opacity|shadow|ring|font|leading|tracking|uppercase|lowercase|truncate|animate|transition|hover|focus|group|sm|md|lg|xl)\b/;
// Attributes whose value is never shown to the user.
const NON_TEXT_ATTR = new Set([
  "className", "id", "key", "type", "href", "src", "d", "fill", "stroke",
  "viewBox", "strokeWidth", "rx", "ry", "cx", "cy", "r", "x", "y", "x1",
  "x2", "y1", "y2", "points", "width", "height", "role", "name", "to", "from",
  "values", "patternUnits", "gradientUnits", "offset", "stopColor",
  "fillOpacity", "strokeOpacity", "opacity", "fontSize", "letterSpacing",
  "viewBox", "xmlns", "form", "method", "target", "rel", "autoComplete",
]);

/** True when `n` is the key argument of a t() / i18next.t() call. */
function isTranslationKey(n) {
  const call = n.parent;
  if (!call || !ts.isCallExpression(call)) return false;
  if (call.arguments[0] !== n) return false;
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text === "t";
  return ts.isPropertyAccessExpression(e) && e.name.text === "t";
}

/**
 * True when `n` sits inside a prop value that is not user-visible text.
 *
 * className and style are the obvious cases, but most of the noise is Button
 * variants and sizes ("sm", "ghost", "primary"), span types, strokeLinecap
 * ("round"), aria-live ("polite") and similar. Any attribute that is not one of
 * the text-bearing ones is skipped, which is a far better filter than trying to
 * enumerate every styling prop the components accept.
 */
const TEXT_ATTR = new Set([
  "title", "placeholder", "aria-label", "alt", "label", "message", "hint",
  "description", "confirmLabel", "emptyLabel", "unit", "text",
]);

function insideStyling(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) {
      const name = ts.isIdentifier(p.name) ? p.name.text : "";
      return name !== "className" && name !== "style" && !TEXT_ATTR.has(name);
    }
    if (ts.isTemplateExpression(p) || ts.isTemplateHead(p)) return true;
    if (ts.isJsxExpression(p) || ts.isJsxElement(p)) return false;
  }
  return false;
}

/**
 * Functions whose string arguments are always shown to a person.
 *
 * Kept short on purpose — see the note at the scan site.
 */
const SINKS = new Set(["toast"]);

const jsxLeaks = [];
for (const f of files) {
  const sf = ts.createSourceFile(
    f,
    readFileSync(f, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const flag = (n, text) => {
    const trimmed = text.trim();
    if (!/[a-zA-Z]{2}/.test(trimmed)) return;
    if (BRAND.test(trimmed) || NOT_COPY.test(trimmed)) return;
    // A Tailwind class spliced in by cn()/clsx() still reads as copy. Match the
    // utility prefixes rather than listing every class name.
    if (CSS_UTILITY.test(trimmed)) return;
    // Inline style values: box shadows, gradients, calc(). They contain letters
    // and spaces, so the word filters above let them through.
    if (/var\(--|rgba?\(|gradient\(|calc\(/.test(trimmed)) return;
    // A bare lowercase token is a variant, a size, a page id or an SVG value
    // ("primary", "ghost", "polite", "currentColor"). Words a person reads are
    // either Capitalised ("Pause", "Unpin") or more than one word.
    if (!/\s/.test(trimmed) && !/^[A-Z]/.test(trimmed)) return;
    jsxLeaks.push(`${f}:${lineOf(n.getStart(sf))}: ${trimmed}`);
  };

  (function v(n) {
    // Bare text between tags: `<span>Live</span>`.
    if (ts.isJsxText(n)) flag(n, n.text);

    // Text inside braces: `{muted ? "Muted" : "Live"}`. The words live in a
    // ternary, not in an element, so nothing else in this file can see them.
    //
    // Only the BRANCHES of a conditional count. Widening this to every string
    // in an expression buries the signal under className templates, comparison
    // operands and enum values — 1466 hits, of which 4 were real. A branch is
    // almost always a choice of what to put on screen.
    //
    // `a || "fallback"` is the same idea and has to be here too: it is how
    // `{media.artist || "Unknown artist"}` stayed English through a check that
    // claimed to cover bare JSX. Only the logical operators count — a
    // comparison's right side is a value being tested (`e.key === "Enter"`),
    // not a choice of what to put on screen.
    const FALLBACK_OPS = new Set([
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
    ]);
    if (ts.isJsxExpression(n) && n.expression) {
      (function w(e) {
        const pick = ts.isConditionalExpression(e)
          ? [e.whenTrue, e.whenFalse]
          : ts.isBinaryExpression(e) && FALLBACK_OPS.has(e.operatorToken.kind)
            ? [e.right]
            : [];
        if (pick.length && !insideStyling(e)) {
          for (const branch of pick) {
            if (ts.isStringLiteralLike(branch) && !isTranslationKey(branch)) {
              if (!SLUG.test(branch.text)) flag(branch, branch.text);
            }
          }
        }
        ts.forEachChild(e, w);
      })(n.expression);
    }

    // A quoted attribute value: `<input placeholder="Search" />`. Only the
    // text-bearing attributes count; `variant="primary"` and `as="span"` are
    // component props, not something anyone reads.
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer)) {
      const name = ts.isIdentifier(n.name) ? n.name.text : "";
      if (TEXT_ATTR.has(name)) flag(n.initializer, n.initializer.text);
    }

    // A string handed to a user-facing sink as a plain call argument.
    //
    // This is the gap the JSX pass above structurally cannot see:
    // `toast("error", `Save failed: ${e}`)` contains no JSX text, no JSX
    // attribute and no ternary, so it passed a check that claims to cover
    // untranslated copy. Everything above was either JSX or a model field.
    //
    // The sink list is deliberately short. A general "any string argument" rule
    // is the same mistake as widening the ternary check — it buries the signal
    // under ids, CSS, enum values and API paths. Naming the functions whose
    // arguments are *always* shown to a person keeps precision high, and a new
    // sink is one line here rather than a false-positive investigation.
    if (ts.isCallExpression(n)) {
      const sink = callSinkName(n);
      // Index 0 is the tone ("ok", "error"), not copy.
      if (sink && n.arguments.length > 1) {
        for (const arg of n.arguments.slice(1)) {
          if (ts.isStringLiteralLike(arg) && !isTranslationKey(arg)) {
            if (!SLUG.test(arg.text)) flag(arg, arg.text);
          }
          if (ts.isTemplateExpression(arg)) {
            // Literal chunks only — the `${...}` holes are values, not copy.
            // A template whose holes contain a t() call is already translated,
            // so only the fixed words around it would be at fault.
            const hasTranslation = arg.templateSpans.some((s) =>
              s.expression.getChildren(sf).some((c) => ts.isCallExpression(c)),
            );
            if (hasTranslation) continue;
            for (const chunk of [
              arg.head.text,
              ...arg.templateSpans.map((s) => s.literal.text),
            ]) {
              if (!SLUG.test(chunk)) flag(arg, chunk);
            }
          }
        }
      }
    }

    ts.forEachChild(n, v);
  })(sf);
}

/**
 * The user-facing sink a call targets, or null.
 *
 * Matches `toast(...)`, `store.toast(...)` and `getState().toast(...)` alike,
 * since the codebase uses every spelling.
 */
function callSinkName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return SINKS.has(e.text) ? e.text : null;
  if (ts.isPropertyAccessExpression(e)) {
    return SINKS.has(e.name.text) ? e.name.text : null;
  }
  return null;
}

const report = (label, list) => {
  console.log(`\n${label} (${list.length}):`);
  for (const k of list) console.log(`  ${k}`);
};

console.log(`keys used in the app: ${used.size}`);
console.log(`entries in en.json:   ${enFlat.size}`);
console.log(`entries in es.json:   ${esFlat.size}`);
report("MISSING FROM en.json", missingEn);
report("MISSING FROM es.json", missingEs);
report("IN en.json BUT UNUSED", unused);
report("IDENTICAL IN BOTH (not translated)", untranslated);
report("MANGLED ESCAPES (doubled backslashes)", mangled);
report("SINGLE-BRACE PLACEHOLDER (will not interpolate)", uninterpolated);
report("BARE JSX TEXT (not run through t)", jsxLeaks);

if (uninterpolated.length) {
  console.error(
    "\nFAIL: a catalog value uses {var}; i18next needs {{var}} or the placeholder renders literally.",
  );
  process.exit(1);
}

if (mangled.length) {
  console.error("\nFAIL: a catalog value has doubled backslashes; it will render literal punctuation.");
  process.exit(1);
}

if (missingEn.length || missingEs.length) {
  console.error("\nFAIL: a key would render as a raw slug.");
  process.exit(1);
}
if (copyLeaks.length) {
  report("MODEL HOLDS COPY, NOT A KEY", copyLeaks);
  console.error("\nFAIL: a model holds English copy instead of a catalog key.");
  process.exit(1);
}
if (jsxLeaks.length) {
  console.error("\nFAIL: bare JSX text would render untranslated.");
  process.exit(1);
}
console.log(
  "\nOK: every key resolves in both catalogs, and no model or bare JSX holds raw copy.",
);
