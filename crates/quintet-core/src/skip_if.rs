//! Tiny expression language for `intake[].skip_if` (CLAUDE.md §4, ADR-0007).
//!
//! ```text
//! expr    := or
//! or      := and ('||' and)*
//! and     := unary ('&&' unary)*
//! unary   := '!' unary | primary
//! primary := '(' expr ')' | path (('==' | '!=') literal)?
//! path    := ('memory' | 'profile' | 'task') ('.' ident)+
//! literal := 'str' | "str" | number | true | false
//! ```
//! A bare path is truthy when it exists and is not `null`, `false`, `""` or `[]`.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Or(Box<Expr>, Box<Expr>),
    And(Box<Expr>, Box<Expr>),
    Not(Box<Expr>),
    Truthy(Vec<String>),
    Eq(Vec<String>, Value),
    Ne(Vec<String>, Value),
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    LParen,
    RParen,
    Not,
    And,
    Or,
    Eq,
    Ne,
    Ident(String),
    Dot,
    Str(String),
    Num(f64),
    True,
    False,
}

fn lex(src: &str) -> Result<Vec<Tok>, String> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        match c {
            ' ' | '\t' | '\n' | '\r' => i += 1,
            '(' => { out.push(Tok::LParen); i += 1 }
            ')' => { out.push(Tok::RParen); i += 1 }
            '.' => { out.push(Tok::Dot); i += 1 }
            '!' => {
                if chars.get(i + 1) == Some(&'=') { out.push(Tok::Ne); i += 2 } else { out.push(Tok::Not); i += 1 }
            }
            '=' => {
                if chars.get(i + 1) == Some(&'=') { out.push(Tok::Eq); i += 2 } else { return Err(format!("unexpected `=` at {i}; use `==`")) }
            }
            '&' => {
                if chars.get(i + 1) == Some(&'&') { out.push(Tok::And); i += 2 } else { return Err(format!("unexpected `&` at {i}; use `&&`")) }
            }
            '|' => {
                if chars.get(i + 1) == Some(&'|') { out.push(Tok::Or); i += 2 } else { return Err(format!("unexpected `|` at {i}; use `||`")) }
            }
            '\'' | '"' => {
                let q = c;
                let mut j = i + 1;
                let mut s = String::new();
                while j < chars.len() && chars[j] != q {
                    s.push(chars[j]);
                    j += 1;
                }
                if j >= chars.len() { return Err("unterminated string".to_string()) }
                out.push(Tok::Str(s));
                i = j + 1;
            }
            c if c.is_ascii_digit() || (c == '-' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit())) => {
                let mut j = i + 1;
                while j < chars.len() && (chars[j].is_ascii_digit() || chars[j] == '.') { j += 1 }
                let text: String = chars[i..j].iter().collect();
                out.push(Tok::Num(text.parse().map_err(|_| format!("bad number `{text}`"))?));
                i = j;
            }
            c if c.is_ascii_alphabetic() || c == '_' => {
                let mut j = i + 1;
                while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') { j += 1 }
                let word: String = chars[i..j].iter().collect();
                out.push(match word.as_str() { "true" => Tok::True, "false" => Tok::False, _ => Tok::Ident(word) });
                i = j;
            }
            other => return Err(format!("unexpected character `{other}` at {i}")),
        }
    }
    Ok(out)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> { self.toks.get(self.pos) }
    fn next(&mut self) -> Option<Tok> { let t = self.toks.get(self.pos).cloned(); self.pos += 1; t }

    fn expr(&mut self) -> Result<Expr, String> {
        let mut left = self.and()?;
        while self.peek() == Some(&Tok::Or) {
            self.next();
            let right = self.and()?;
            left = Expr::Or(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn and(&mut self) -> Result<Expr, String> {
        let mut left = self.unary()?;
        while self.peek() == Some(&Tok::And) {
            self.next();
            let right = self.unary()?;
            left = Expr::And(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn unary(&mut self) -> Result<Expr, String> {
        if self.peek() == Some(&Tok::Not) {
            self.next();
            return Ok(Expr::Not(Box::new(self.unary()?)));
        }
        self.primary()
    }

    fn primary(&mut self) -> Result<Expr, String> {
        match self.next() {
            Some(Tok::LParen) => {
                let e = self.expr()?;
                if self.next() != Some(Tok::RParen) { return Err("expected `)`".to_string()) }
                Ok(e)
            }
            Some(Tok::Ident(root)) => {
                if !matches!(root.as_str(), "memory" | "profile" | "task") {
                    return Err(format!("path must start with memory., profile. or task. (got `{root}`)"));
                }
                let mut path = vec![root];
                while self.peek() == Some(&Tok::Dot) {
                    self.next();
                    match self.next() {
                        Some(Tok::Ident(seg)) => path.push(seg),
                        _ => return Err("expected identifier after `.`".to_string()),
                    }
                }
                if path.len() < 2 { return Err(format!("path `{}` needs at least one segment, e.g. `{}.key`", path[0], path[0])) }
                match self.peek() {
                    Some(Tok::Eq) => { self.next(); let lit = self.literal()?; Ok(Expr::Eq(path, lit)) }
                    Some(Tok::Ne) => { self.next(); let lit = self.literal()?; Ok(Expr::Ne(path, lit)) }
                    _ => Ok(Expr::Truthy(path)),
                }
            }
            other => Err(format!("unexpected token {other:?}")),
        }
    }

    fn literal(&mut self) -> Result<Value, String> {
        match self.next() {
            Some(Tok::Str(s)) => Ok(Value::String(s)),
            Some(Tok::Num(n)) => Ok(serde_json::json!(n)),
            Some(Tok::True) => Ok(Value::Bool(true)),
            Some(Tok::False) => Ok(Value::Bool(false)),
            other => Err(format!("expected a literal after comparison, got {other:?}")),
        }
    }
}

pub fn parse(src: &str) -> Result<Expr, String> {
    let toks = lex(src)?;
    if toks.is_empty() { return Err("empty expression".to_string()) }
    let mut p = Parser { toks, pos: 0 };
    let e = p.expr()?;
    if p.pos != p.toks.len() { return Err(format!("trailing tokens after expression: {:?}", &p.toks[p.pos..])) }
    Ok(e)
}

/// Registry-time check: the expression must parse.
pub fn validate(src: &str) -> Result<(), String> {
    parse(src).map(|_| ())
}

/// Evaluation context: three JSON objects.
#[derive(Debug, Default, Clone)]
pub struct Ctx {
    pub memory: Value,
    pub profile: Value,
    pub task: Value,
}

impl Ctx {
    fn lookup(&self, path: &[String]) -> Option<&Value> {
        let mut cur = match path.first()?.as_str() {
            "memory" => &self.memory,
            "profile" => &self.profile,
            "task" => &self.task,
            _ => return None,
        };
        for seg in &path[1..] {
            cur = cur.get(seg)?;
        }
        Some(cur)
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::Object(_)) => true,
    }
}

fn loose_eq(a: Option<&Value>, b: &Value) -> bool {
    match (a, b) {
        (None, Value::Null) => true,
        (None, _) => false,
        (Some(Value::Number(x)), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Some(Value::String(x)), Value::Number(y)) => x.parse::<f64>().ok() == y.as_f64(),
        (Some(x), y) => x == y,
    }
}

pub fn eval(e: &Expr, ctx: &Ctx) -> bool {
    match e {
        Expr::Or(a, b) => eval(a, ctx) || eval(b, ctx),
        Expr::And(a, b) => eval(a, ctx) && eval(b, ctx),
        Expr::Not(a) => !eval(a, ctx),
        Expr::Truthy(p) => truthy(ctx.lookup(p)),
        Expr::Eq(p, lit) => loose_eq(ctx.lookup(p), lit),
        Expr::Ne(p, lit) => !loose_eq(ctx.lookup(p), lit),
    }
}

/// Parse + evaluate in one go. A parse error evaluates to `false` (never skip on a broken rule).
pub fn should_skip(src: &str, ctx: &Ctx) -> bool {
    parse(src).map(|e| eval(&e, ctx)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ctx() -> Ctx {
        Ctx {
            memory: json!({"default_citation_style": "Chicago", "empty": "", "list": [1], "nested": {"a": {"b": true}}}),
            profile: json!({"class_of": 2028}),
            task: json!({"graded": "yes", "text": "hello"}),
        }
    }

    #[test]
    fn truthiness() {
        let c = ctx();
        assert!(should_skip("memory.default_citation_style", &c));
        assert!(!should_skip("memory.empty", &c));
        assert!(!should_skip("memory.missing", &c));
        assert!(should_skip("memory.list", &c));
        assert!(should_skip("memory.nested.a.b", &c));
        assert!(!should_skip("memory.nested.a.c", &c));
    }

    #[test]
    fn comparisons_and_logic() {
        let c = ctx();
        assert!(should_skip("task.graded == 'yes'", &c));
        assert!(!should_skip("task.graded != \"yes\"", &c));
        assert!(should_skip("profile.class_of == 2028", &c));
        assert!(should_skip("task.graded == 'no' || memory.list", &c));
        assert!(!should_skip("task.graded == 'no' && memory.list", &c));
        assert!(should_skip("!(task.graded == 'no')", &c));
        assert!(!should_skip("memory.missing == 'x'", &c));
        assert!(should_skip("memory.missing != 'x'", &c));
    }

    #[test]
    fn parse_errors() {
        assert!(validate("").is_err());
        assert!(validate("foo.bar").is_err());
        assert!(validate("memory").is_err());
        assert!(validate("memory.x =").is_err());
        assert!(validate("memory.x == 'unterminated").is_err());
        assert!(validate("(memory.x").is_err());
        assert!(validate("memory.x memory.y").is_err());
        assert!(validate("memory.default_citation_style").is_ok());
        assert!(validate("task.graded != 'yes'").is_ok());
        // Broken rule never skips.
        assert!(!should_skip("memory.x ==", &ctx()));
    }
}
