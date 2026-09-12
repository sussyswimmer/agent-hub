// Mock-only evaluator for intake `skip_if` (the real one lives in Rust: crates/quintet-core/src/skip_if.rs).
// Same grammar so the browser mock behaves like the app: || && ! () path == != 'str' "str" number true false.
type Ctx = { memory: unknown; profile: unknown; task: unknown };
type Tok = { t: "op"; v: string } | { t: "path"; v: string[] } | { t: "lit"; v: unknown };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("==", i) || src.startsWith("!=", i) || src.startsWith("&&", i) || src.startsWith("||", i)) { out.push({ t: "op", v: src.slice(i, i + 2) }); i += 2; continue; }
    if ("()!".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "'" || c === '"') { const j = src.indexOf(c, i + 1); if (j === -1) throw new Error("unterminated string"); out.push({ t: "lit", v: src.slice(i + 1, j) }); i = j + 1; continue; }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: "lit", v: Number(num[0]) }); i += num[0].length; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      if (w === "true" || w === "false") out.push({ t: "lit", v: w === "true" });
      else { const path = w.split("."); if (!["memory", "profile", "task"].includes(path[0]!) || path.length < 2) throw new Error(`bad path ${w}`); out.push({ t: "path", v: path }); }
      i += w.length; continue;
    }
    throw new Error(`unexpected ${c}`);
  }
  return out;
}

function lookup(ctx: Ctx, path: string[]): unknown {
  let cur: unknown = ctx[path[0] as keyof Ctx];
  for (const seg of path.slice(1)) { if (cur === null || typeof cur !== "object") return undefined; cur = (cur as Record<string, unknown>)[seg]; }
  return cur;
}
const truthy = (v: unknown) => !(v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0) || v === 0);
const eq = (a: unknown, b: unknown) => (a === undefined && b === null) || a === b || (typeof b === "number" && typeof a === "string" && Number(a) === b);

export function shouldSkip(src: string, ctx: Ctx): boolean {
  try {
    const toks = lex(src);
    let pos = 0;
    const peek = () => toks[pos];
    const isOp = (v: string) => { const t = peek(); return t?.t === "op" && t.v === v; };
    const primary = (): boolean => {
      const t = toks[pos++];
      if (!t) throw new Error("unexpected end");
      if (t.t === "op" && t.v === "(") { const v = expr(); if (!isOp(")")) throw new Error("expected )"); pos++; return v; }
      if (t.t === "op" && t.v === "!") return !primary();
      if (t.t === "path") {
        const val = lookup(ctx, t.v);
        if (isOp("==") || isOp("!=")) { const op = (toks[pos++] as { v: string }).v; const lit = toks[pos++]; if (lit?.t !== "lit") throw new Error("expected literal"); return op === "==" ? eq(val, lit.v) : !eq(val, lit.v); }
        return truthy(val);
      }
      throw new Error("unexpected token");
    };
    const and = (): boolean => { let l = primary(); while (isOp("&&")) { pos++; const r = primary(); l = l && r; } return l; };
    const expr = (): boolean => { let l = and(); while (isOp("||")) { pos++; const r = and(); l = l || r; } return l; };
    const v = expr();
    if (pos !== toks.length) throw new Error("trailing tokens");
    return v;
  } catch {
    return false; // a broken rule never skips, same as Rust
  }
}
