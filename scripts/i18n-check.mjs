import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const en = JSON.parse(readFileSync("locales/en.json", "utf8"));
const es = JSON.parse(readFileSync("locales/es.json", "utf8"));

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

const used = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  (function v(n) {
    if (
      ts.isCallExpression(n) &&
      ((ts.isIdentifier(n.expression) && n.expression.text === "t") ||
        (ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "t")) &&
      n.arguments[0]
    ) {
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

const MODEL_KEY_FIELDS = /(?:label|blurb|hint|title|description):\s*"([a-z][\w-]*(?:\.[\w{}-]+)+)"/g;
const TUPLE_KEY_SLOT = /\[\s*"[a-z][\w-]*"\s*,\s*"([a-z][\w-]*(?:\.[\w{}-]+)+)"/g;
const EXPLICIT_KEY_MAP =
  /\b[A-Z][A-Z0-9_]*(?:_LABEL|_LABELS|_KEY|_KEYS)\b[^=]{0,120}=\s*\{([\s\S]*?)^\s*\}/gm;

for (const f of [...files, "src/shared/constants.ts"]) {
  if (f.endsWith("i18n.ts")) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(MODEL_KEY_FIELDS)) used.add(m[1]);
  for (const m of src.matchAll(TUPLE_KEY_SLOT)) used.add(m[1]);
  for (const m of src.matchAll(EXPLICIT_KEY_MAP)) {
    for (const lit of m[1].matchAll(/"([a-z][\w-]*(?:\.[\w{}-]+)+)"/g)) used.add(lit[1]);
  }
}

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

const RUST_OWNED = (key) => key.startsWith("tray.");

const missingEn = [...used].filter((k) => !enFlat.has(k));
const missingEs = [...used].filter((k) => !esFlat.has(k));
const unused = [...enFlat.keys()].filter(
  (k) => !used.has(k) && !RUST_OWNED(k),
);
const untranslated = [...used].filter(
  (k) => enFlat.has(k) && esFlat.has(k) && enFlat.get(k) === esFlat.get(k),
);

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

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const placeholderNames = (v) =>
  typeof v === "string"
    ? [...v.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(",")
    : "";
const placeholderMismatch = [];
for (const [k, v] of enFlat) {
  const en = placeholderNames(v);
  const es = placeholderNames(esFlat.get(k));
  if (en !== es) placeholderMismatch.push(`${k}: en {{${en}}} vs es {{${es}}}`);
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

const BRAND = /\b(LUMENDECK|LumenDeck|OpenRGB|Windows|Discord|GitHub|URL|LED|LEDs|CTRL|Alt|Shift|WIPE|BORRAR)\b/;
const NOT_COPY = /^(config\.json|DEV|pnpm changelog)$/;
const SLUG = /^[a-z][\w-]*(\.[\w{}-]+)+$/;
const CSS_UTILITY =
  /\b(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|gap|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|text|bg|border|rounded|opacity|shadow|ring|font|leading|tracking|uppercase|lowercase|truncate|animate|transition|hover|focus|group|sm|md|lg|xl)\b/;
const NON_TEXT_ATTR = new Set([
  "className", "id", "key", "type", "href", "src", "d", "fill", "stroke",
  "viewBox", "strokeWidth", "rx", "ry", "cx", "cy", "r", "x", "y", "x1",
  "x2", "y1", "y2", "points", "width", "height", "role", "name", "to", "from",
  "values", "patternUnits", "gradientUnits", "offset", "stopColor",
  "fillOpacity", "strokeOpacity", "opacity", "fontSize", "letterSpacing",
  "viewBox", "xmlns", "form", "method", "target", "rel", "autoComplete",
]);

function isTranslationKey(n) {
  const call = n.parent;
  if (!call || !ts.isCallExpression(call)) return false;
  if (call.arguments[0] !== n) return false;
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text === "t";
  return ts.isPropertyAccessExpression(e) && e.name.text === "t";
}

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
    if (CSS_UTILITY.test(trimmed)) return;
    if (/var\(--|rgba?\(|gradient\(|calc\(/.test(trimmed)) return;
    if (!/\s/.test(trimmed) && !/^[A-Z]/.test(trimmed)) return;
    jsxLeaks.push(`${f}:${lineOf(n.getStart(sf))}: ${trimmed}`);
  };

  (function v(n) {
    if (ts.isJsxText(n)) flag(n, n.text);

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

    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer)) {
      const name = ts.isIdentifier(n.name) ? n.name.text : "";
      if (TEXT_ATTR.has(name)) flag(n.initializer, n.initializer.text);
    }

    if (ts.isCallExpression(n)) {
      const sink = callSinkName(n);
      if (sink && n.arguments.length > 1) {
        for (const arg of n.arguments.slice(1)) {
          if (ts.isStringLiteralLike(arg) && !isTranslationKey(arg)) {
            if (!SLUG.test(arg.text)) flag(arg, arg.text);
          }
          if (ts.isTemplateExpression(arg)) {
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
report("PLACEHOLDER MISMATCH BETWEEN CATALOGS", placeholderMismatch);

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

if (placeholderMismatch.length) {
  console.error(
    "\nFAIL: the two catalogs disagree on a placeholder name; the unmatched one renders literally.",
  );
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
