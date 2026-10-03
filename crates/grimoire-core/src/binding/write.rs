//! Writing bindings from inside the app (DECISIONS 0028).
//!
//! §4 began "there is no in-app editor for bindings". The owner, using the app, could not see how
//! to make a familiar or point one at a folder without writing YAML by hand, and asked for one.
//! What did not change is the part of §4 that matters: **the file is the source of truth**. The
//! app writes the same `.binding.md` a person would, into the same folder, and the watcher picks
//! it up exactly as it would a hand edit. A binding written here can be opened in an editor and
//! changed there, and the other way round.
//!
//! An edit is surgical. Only the top-level keys whose values the form actually changed are
//! rewritten, so a comment or a key the form knows nothing about (`bounds.shell`, `codex`,
//! `isolation`, a typo someone is still fixing) survives a save. Every file written is parsed
//! back before it replaces anything, and written whole to a hidden temporary file first, so a
//! save can never leave half a binding in the folder for the watcher to read.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};
use ts_rs::TS;

use crate::binding::parse::{Binding, id_for, parse};
use crate::binding::schema::{AetherBudget, BindingFrontmatter, Bounds, IntakeField, IntakeKind};
use crate::types::{Autonomy, Engine, Order};

/// What the setup form edits: the parts of a binding a person needs to change to make a familiar
/// do what they want. Everything else in the frontmatter is left as the file has it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BindingForm {
    pub name: String,
    pub order: Order,
    pub engine: Engine,
    /// `None`, or blank, for the engine's own default.
    pub model: Option<String>,
    pub workspace: String,
    pub autonomy: Autonomy,
    pub aether: AetherBudget,
    pub intake: Vec<IntakeField>,
    /// Everything after the frontmatter, verbatim (§4).
    pub writ: String,
}

/// The form for a binding that parsed. A broken one has nothing to fill it with; it is fixed in
/// the file, where the error points.
pub fn form_of(b: &Binding) -> Option<BindingForm> {
    let f = b.front.as_ref()?;
    Some(BindingForm {
        name: f.name.clone(),
        order: f.order,
        engine: f.engine,
        model: f.model.clone(),
        workspace: f.workspace.clone(),
        autonomy: f.autonomy,
        aether: f.aether,
        intake: f.intake.clone(),
        writ: b.writ.trim_end().to_string(),
    })
}

/// The file name a new familiar is given: `Vellum` → `vellum`, `Night Owl 2` → `night-owl-2`.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "familiar".into() } else { out }
}

/// Tidy a form and say what is wrong with it, in words that say what to do.
pub fn check(form: &BindingForm) -> Result<BindingForm, String> {
    let mut f = form.clone();
    // As the file will read back: `\r\n` as `\n`, and no blank lines before or after. Kept as
    // typed, a writ starting with a blank line could never match what was written, and the save
    // was refused as a layout this could not edit.
    f.writ = f.writ.replace("\r\n", "\n").trim_start_matches('\n').trim_end().to_string();
    f.name = f.name.trim().to_string();
    if f.name.is_empty() {
        return Err("Give the familiar a name.".into());
    }
    if f.name.chars().count() > 60 || f.name.contains(['\n', '\r']) {
        return Err("Keep the name to one line of 60 characters or fewer.".into());
    }
    f.workspace = f.workspace.trim().to_string();
    if f.workspace.is_empty() {
        return Err(format!("Choose the folder {} works in.", f.name));
    }
    f.model = f.model.map(|m| m.trim().to_string()).filter(|m| !m.is_empty());
    if f.model.as_deref().is_some_and(|m| m.contains(char::is_whitespace)) {
        return Err("A model name has no spaces in it. Leave it blank for the engine's default.".into());
    }
    for (what, v) in [("tokens", f.aether.tokens), ("turns", f.aether.turns), ("minutes", f.aether.minutes)] {
        if v.is_some_and(|n| n <= 0) {
            return Err(format!("The budget's {what} has to be more than nothing, or left blank for no limit."));
        }
    }

    let mut seen: Vec<String> = Vec::new();
    let mut intake = Vec::new();
    for mut q in f.intake {
        q.ask = q.ask.trim().to_string();
        if q.ask.is_empty() {
            continue;
        }
        q.options = q.options.into_iter().map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).collect();
        if q.kind == IntakeKind::Select && q.options.is_empty() {
            return Err(format!("“{}” is a pick-one question with nothing to pick. Add its choices.", q.ask));
        }
        if q.kind != IntakeKind::Select {
            q.options.clear();
        }
        // The id is what a writ or a commission's `{{intake.id}}` refers to. Kept where it was
        // set, made from the question where it was not, and never the same as another's.
        // Made-up ids are kept short; one a person wrote is theirs, and a writ may name it whole.
        let base = if q.id.trim().is_empty() {
            slug(&q.ask).replace('-', "_").chars().take(32).collect()
        } else {
            q.id.trim().to_string()
        };
        let mut id = base.clone();
        let mut n = 2;
        while seen.contains(&id) {
            id = format!("{base}_{n}");
            n += 1;
        }
        seen.push(id.clone());
        q.id = id;
        intake.push(q);
    }
    f.intake = intake;
    Ok(f)
}

/// Write a new familiar into `folder`. Refuses to replace one that is already there.
pub fn create(folder: &Path, form: &BindingForm) -> Result<Binding, String> {
    let form = check(form)?;
    let id = slug(&form.name);
    let path = folder.join(format!("{id}.binding.md"));
    if path.exists() {
        return Err(format!(
            "There is already a familiar file called {id}.binding.md. Choose another name, or open that one."
        ));
    }
    let text = render(&form);
    let binding = parse(&id, &path, &text);
    if let Some(e) = &binding.error {
        // A form that checked out and still rendered something that will not parse is a bug
        // here, not something the person typed; say what came back rather than writing it.
        return Err(format!("That would not make a working binding: {e}"));
    }
    std::fs::create_dir_all(folder).map_err(|e| format!("Could not make the bindings folder {}: {e}", folder.display()))?;
    put(&path, &text)?;
    Ok(binding)
}

/// Change an existing familiar's binding to match the form, leaving everything the form does
/// not cover exactly as it is in the file.
pub fn update(path: &Path, form: &BindingForm) -> Result<Binding, String> {
    write_form(path, form, None)
}

/// As `update`, for a form that was filled from the file as it was at `read`: only what changed
/// on the page since then is written. The settings page reads a binding once, and the file is
/// still the source of truth — a writ reworded in an editor while the page was open is kept by
/// a save that changed only the model, rather than quietly put back.
pub fn update_since(path: &Path, form: &BindingForm, read: &BindingForm) -> Result<Binding, String> {
    write_form(path, form, Some(read))
}

fn write_form(path: &Path, form: &BindingForm, read: Option<&BindingForm>) -> Result<Binding, String> {
    let original = std::fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let id = id_for(path);
    let current = parse(&id, path, &original);
    let Some(front) = current.front.as_ref() else {
        return Err(format!(
            "This binding has an error, so it cannot be changed here: {}. Fix it in the file first.",
            current.error.as_deref().unwrap_or("it could not be read")
        ));
    };
    let form = match (read, form_of(&current)) {
        (Some(read), Some(now)) => since(&check(form)?, &check(read).unwrap_or_else(|_| read.clone()), now),
        _ => form.clone(),
    };
    let form = check(&form)?;
    let Some((mut yaml, rest)) = split(&original) else {
        return Err("This binding has no frontmatter to change.".into());
    };

    let mut set = |key: &str, value: Option<Value>| yaml = set_key(&yaml, key, value);
    if front.name != form.name {
        set("name", Some(Value::String(form.name.clone())));
    }
    if front.order != form.order {
        set("order", Some(plain(&form.order)));
    }
    if front.engine != form.engine {
        set("engine", Some(plain(&form.engine)));
    }
    if front.model != form.model {
        set("model", form.model.clone().map(Value::String));
    }
    if front.workspace != form.workspace {
        set("workspace", Some(Value::String(form.workspace.clone())));
    }
    if front.autonomy != form.autonomy {
        set("autonomy", Some(plain(&form.autonomy)));
    }
    if let Some(bounds) = bounds_for(front, &form) {
        set("bounds", Some(bounds_value(&bounds)));
    }
    if front.aether != form.aether {
        set("aether", Some(aether_value(&form.aether)));
    }
    if front.intake != form.intake {
        set("intake", (!form.intake.is_empty()).then(|| intake_value(&form.intake)));
    }

    let writ_changed = current.writ.trim_end() != form.writ.trim_end();
    let rest = if writ_changed { format!("\n\n{}\n", form.writ.trim_end()) } else { rest };
    let text = format!("---\n{}\n---{}", yaml.trim_end_matches('\n'), rest);

    let binding = parse(&id, path, &text);
    if binding.error.is_some() || form_of(&binding).as_ref() != Some(&form) {
        // The surgical edit missed — a key written in some form this does not recognise, or a
        // comment in the middle of a list it replaced, say. Better to refuse than to write a
        // file that does not say what the form said, or does not parse at all.
        return Err(format!(
            "The settings at the top of {} are laid out in a way this page cannot edit safely, so nothing was saved. Change them in the file.",
            path.display()
        ));
    }
    if text != original {
        put(path, &text)?;
    }
    Ok(binding)
}

/// Each field as the page left it if the page changed it since `read`, and as the file has it
/// now if not. A list or the budget counts as one field.
fn since(page: &BindingForm, read: &BindingForm, mut file: BindingForm) -> BindingForm {
    macro_rules! take {
        ($($field:ident),*) => {$(
            if page.$field != read.$field {
                file.$field = page.$field.clone();
            }
        )*};
    }
    take!(name, order, engine, model, workspace, autonomy, aether, intake, writ);
    file
}

/// Put a familiar away. The file is renamed rather than deleted, so a familiar removed by
/// mistake is one rename from coming back; the watcher sees it go either way.
pub fn retire(path: &Path) -> Result<PathBuf, String> {
    let mut to = path.with_extension("md.removed");
    let mut n = 2;
    while to.exists() {
        to = path.with_extension(format!("md.removed-{n}"));
        n += 1;
    }
    std::fs::rename(path, &to).map_err(|e| format!("Could not put {} away: {e}", path.display()))?;
    Ok(to)
}

/// A whole new binding, in the order a person would write one.
fn render(form: &BindingForm) -> String {
    let mut m = Mapping::new();
    m.insert("name".into(), Value::String(form.name.clone()));
    m.insert("order".into(), plain(&form.order));
    m.insert("engine".into(), plain(&form.engine));
    if let Some(model) = &form.model {
        m.insert("model".into(), Value::String(model.clone()));
    }
    m.insert("workspace".into(), Value::String(form.workspace.clone()));
    m.insert("autonomy".into(), plain(&form.autonomy));
    if form.autonomy == Autonomy::Bounded {
        m.insert("bounds".into(), bounds_value(&inside(&form.workspace)));
    }
    m.insert("aether".into(), aether_value(&form.aether));
    m.insert("reliquary".into(), Value::String("read".into()));
    if !form.intake.is_empty() {
        m.insert("intake".into(), intake_value(&form.intake));
    }
    let yaml = serde_yaml_ng::to_string(&m).unwrap_or_default();
    format!("---\n{}---\n\n{}\n", yaml, form.writ.trim_end())
}

/// The bounds a binding should have after the form is saved, if they need to change.
///
/// §6.4's `bounded` rung reads `bounds.write`, and a binding set to it with no bounds would ask
/// about every write — which is `propose` under another name. So the form's "change files in its
/// folder" means exactly that: the folder, and nothing else. A list someone wrote by hand is
/// left alone, unless it was the old folder and the folder moved.
fn bounds_for(front: &BindingFrontmatter, form: &BindingForm) -> Option<Bounds> {
    if form.autonomy != Autonomy::Bounded {
        return None;
    }
    let old = inside(&front.workspace).write;
    if front.bounds.write.is_empty() || (front.bounds.write == old && front.workspace != form.workspace) {
        let mut b = front.bounds.clone();
        b.write = inside(&form.workspace).write;
        return (b != front.bounds).then_some(b);
    }
    None
}

fn inside(workspace: &str) -> Bounds {
    Bounds { write: vec![format!("{}/**", workspace.trim_end_matches('/'))], ..Bounds::default() }
}

fn bounds_value(b: &Bounds) -> Value {
    let mut m = Mapping::new();
    let list = |v: &[String]| Value::Sequence(v.iter().cloned().map(Value::String).collect());
    m.insert("write".into(), list(&b.write));
    if !b.deny.is_empty() {
        m.insert("deny".into(), list(&b.deny));
    }
    m.insert("network".into(), Value::Bool(b.network));
    if !b.shell.is_empty() {
        m.insert("shell".into(), list(&b.shell));
    }
    Value::Mapping(m)
}

fn aether_value(a: &AetherBudget) -> Value {
    let mut m = Mapping::new();
    for (k, v) in [("tokens", a.tokens), ("turns", a.turns), ("minutes", a.minutes)] {
        if let Some(n) = v {
            m.insert(k.into(), Value::Number(n.into()));
        }
    }
    m.insert("on_exceed".into(), plain(&a.on_exceed));
    Value::Mapping(m)
}

fn intake_value(questions: &[IntakeField]) -> Value {
    Value::Sequence(
        questions
            .iter()
            .map(|q| {
                let mut m = Mapping::new();
                m.insert("id".into(), Value::String(q.id.clone()));
                m.insert("ask".into(), Value::String(q.ask.clone()));
                m.insert("type".into(), plain(&q.kind));
                if !q.options.is_empty() {
                    m.insert("options".into(), Value::Sequence(q.options.iter().cloned().map(Value::String).collect()));
                }
                m.insert("required".into(), Value::Bool(q.required));
                Value::Mapping(m)
            })
            .collect(),
    )
}

/// An enum as the bare word the binding uses for it (`quill`, `propose`, `bind`).
fn plain<T: Serialize>(v: &T) -> Value {
    serde_yaml_ng::to_value(v).unwrap_or(Value::Null)
}

/// The frontmatter and everything after its closing fence, the fence's own line included in
/// neither. `\r\n` is read as `\n`, and written back that way.
fn split(text: &str) -> Option<(String, String)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text).replace("\r\n", "\n");
    let rest = text.strip_prefix("---\n")?;
    let end = rest
        .match_indices("\n---")
        .find(|(i, _)| {
            let after = &rest[i + 4..];
            after.is_empty() || after.starts_with('\n')
        })
        .map(|(i, _)| i)?;
    Some((rest[..end].to_string(), rest[end + 4..].to_string()))
}

/// Whether a line opens a top-level key, and which.
fn top_key(line: &str) -> Option<&str> {
    if line.starts_with([' ', '\t', '#', '-']) {
        return None;
    }
    let (key, _) = line.split_once(':')?;
    let key = key.trim_end();
    (!key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).then_some(key)
}

/// Replace one top-level key's whole block — its line and everything indented under it — with
/// `value`, or remove it for `None`, or add it at the end if it is not there. Every other line,
/// comments included, is left where it was.
fn set_key(yaml: &str, key: &str, value: Option<Value>) -> String {
    let lines: Vec<&str> = yaml.lines().collect();
    let rendered = value.map(|v| {
        let mut m = Mapping::new();
        m.insert(Value::String(key.into()), v);
        serde_yaml_ng::to_string(&m).unwrap_or_default()
    });

    let Some(start) = lines.iter().position(|l| top_key(l) == Some(key)) else {
        let mut out = yaml.trim_end_matches('\n').to_string();
        if let Some(r) = rendered {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(r.trim_end_matches('\n'));
        }
        return out;
    };
    // The block runs to the next top-level key or column-0 comment. Blank lines at its end are
    // the space before whatever follows, and stay.
    let mut end = start + 1;
    while end < lines.len() && top_key(lines[end]).is_none() && !lines[end].starts_with('#') {
        end += 1;
    }
    while end > start + 1 && lines[end - 1].trim().is_empty() {
        end -= 1;
    }

    let mut out: Vec<String> = lines[..start].iter().map(|s| s.to_string()).collect();
    if let Some(r) = rendered {
        out.extend(r.trim_end_matches('\n').lines().map(str::to_string));
    }
    out.extend(lines[end..].iter().map(|s| s.to_string()));
    out.join("\n")
}

/// Write the whole file somewhere the watcher ignores, then move it into place in one step.
fn put(path: &Path, text: &str) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("binding");
    let tmp = path.with_file_name(format!(".{name}.saving"));
    std::fs::write(&tmp, text).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not write {}: {e}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binding::load;
    use crate::binding::schema::OnExceed;

    fn form() -> BindingForm {
        BindingForm {
            name: "Night Owl".into(),
            order: Order::Lantern,
            engine: Engine::Claude,
            model: None,
            workspace: "~/notes".into(),
            autonomy: Autonomy::Propose,
            aether: AetherBudget { tokens: Some(100_000), turns: None, minutes: Some(20), on_exceed: OnExceed::Bind },
            intake: vec![],
            writ: "# Writ\n\nYou are Night Owl. Read, then report.".into(),
        }
    }

    const HAND_WRITTEN: &str = "---\n# written by hand\nname: Vellum\norder: quill   # brass\nengine: claude\nworkspace: ~/work/essays\nisolation: none\nautonomy: propose\nbounds:\n  write: [\"~/work/essays/**\"]\n  shell: [\"git status\"]\naether:\n  tokens: 250000\n  on_exceed: bind\nfavourite_colour: green\nintake:\n  - id: piece\n    ask: Which piece?\n    type: text\n    required: true\n---\n\n# Writ\n\nYou are Vellum.\n";

    #[test]
    fn a_new_familiar_is_written_as_a_binding_that_loads() {
        let dir = tempfile::tempdir().unwrap();
        let made = create(dir.path(), &form()).unwrap();
        assert_eq!(made.id, "night-owl");
        let back = load(&dir.path().join("night-owl.binding.md"));
        assert!(back.is_valid(), "{:?}", back.error);
        assert!(back.warnings.is_empty(), "{:?}", back.warnings);
        assert_eq!(form_of(&back).unwrap(), check(&form()).unwrap());
        assert_eq!(back.writ.trim_end(), "# Writ\n\nYou are Night Owl. Read, then report.");
    }

    #[test]
    fn a_new_familiar_never_replaces_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("night-owl.binding.md"), "keep me").unwrap();
        let e = create(dir.path(), &form()).unwrap_err();
        assert!(e.contains("already"), "{e}");
        assert_eq!(std::fs::read_to_string(dir.path().join("night-owl.binding.md")).unwrap(), "keep me");
    }

    #[test]
    fn bounded_means_its_own_folder() {
        let dir = tempfile::tempdir().unwrap();
        let mut f = form();
        f.autonomy = Autonomy::Bounded;
        let made = create(dir.path(), &f).unwrap();
        assert_eq!(made.front.unwrap().bounds.write, vec!["~/notes/**".to_string()]);
    }

    #[test]
    fn an_edit_changes_what_the_form_changed_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let mut f = form_of(&load(&path)).unwrap();
        f.workspace = "~/Documents/essays".into();
        f.model = Some("sonnet".into());
        update(&path, &f).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        // The comments, the unknown key, the keys the form does not cover, and the writ survive.
        for kept in ["# written by hand", "order: quill   # brass", "favourite_colour: green", "isolation: none", "shell: [\"git status\"]", "\n# Writ\n\nYou are Vellum.\n"] {
            assert!(text.contains(kept), "lost {kept:?} from:\n{text}");
        }
        assert!(text.contains("workspace: ~/Documents/essays"), "{text}");
        assert!(text.contains("model: sonnet"), "{text}");
        let back = load(&path);
        assert!(back.is_valid());
        assert_eq!(form_of(&back).unwrap(), check(&f).unwrap());
    }

    #[test]
    fn an_edit_that_changes_nothing_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let f = form_of(&load(&path)).unwrap();
        update(&path, &f).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), HAND_WRITTEN);
    }

    #[test]
    fn questions_writ_and_budget_can_all_be_changed_and_a_model_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN.replace("engine: claude\n", "engine: claude\nmodel: opus\n")).unwrap();
        let mut f = form_of(&load(&path)).unwrap();
        f.model = None;
        f.intake = vec![
            IntakeField { id: String::new(), ask: "Which piece?".into(), kind: IntakeKind::Text, options: vec![], required: false },
            IntakeField { id: String::new(), ask: "What kind of pass?".into(), kind: IntakeKind::Select, options: vec!["line".into(), " ".into(), "cut".into()], required: true },
        ];
        f.aether.tokens = None;
        f.aether.on_exceed = OnExceed::Steer;
        f.writ = "Be brief.".into();
        update(&path, &f).unwrap();

        let back = load(&path);
        let front = back.front.clone().unwrap();
        assert_eq!(front.model, None);
        assert_eq!(front.intake[0].id, "which_piece");
        assert!(!front.intake[0].required);
        assert_eq!(front.intake[1].options, vec!["line".to_string(), "cut".to_string()]);
        assert_eq!(front.aether, AetherBudget { tokens: None, turns: None, minutes: None, on_exceed: OnExceed::Steer });
        assert_eq!(back.writ.trim_end(), "Be brief.");
        assert!(std::fs::read_to_string(&path).unwrap().contains("favourite_colour: green"));
    }

    #[test]
    fn moving_the_folder_moves_bounds_that_were_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN.replace("autonomy: propose", "autonomy: bounded")).unwrap();
        let mut f = form_of(&load(&path)).unwrap();
        f.workspace = "~/elsewhere".into();
        update(&path, &f).unwrap();
        let front = load(&path).front.unwrap();
        assert_eq!(front.bounds.write, vec!["~/elsewhere/**".to_string()]);
        // The rest of the bounds were written by hand and stay.
        assert_eq!(front.bounds.shell, vec!["git status".to_string()]);
    }

    #[test]
    fn a_form_that_says_nothing_useful_is_refused_with_what_to_do() {
        let mut f = form();
        f.name = "  ".into();
        assert!(check(&f).unwrap_err().contains("name"));
        let mut f = form();
        f.workspace = String::new();
        assert!(check(&f).unwrap_err().contains("folder"));
        let mut f = form();
        f.aether.turns = Some(0);
        assert!(check(&f).unwrap_err().contains("turns"));
        let mut f = form();
        f.intake = vec![IntakeField { id: String::new(), ask: "Which?".into(), kind: IntakeKind::Select, options: vec![], required: true }];
        assert!(check(&f).unwrap_err().contains("choices"));
    }

    #[test]
    fn a_file_laid_out_in_a_way_the_edit_cannot_follow_is_refused_not_mangled() {
        // A column-0 comment inside the intake list ends the block the edit replaces, so the
        // questions after it would be left behind. The check after the edit catches it.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        let text = HAND_WRITTEN.replace(
            "    required: true\n---",
            "    required: true\n# the second one is new\n  - id: mode\n    ask: What pass?\n    type: text\n---",
        );
        std::fs::write(&path, &text).unwrap();
        assert_eq!(load(&path).front.unwrap().intake.len(), 2);
        let mut f = form_of(&load(&path)).unwrap();
        f.intake.remove(1);
        let e = update(&path, &f).unwrap_err();
        assert!(e.contains("Change them in the file"), "{e}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
    }

    #[test]
    fn instructions_with_blank_lines_round_them_save_as_written() {
        // The file keeps no blank lines before the writ, so a form whose writ starts with them
        // could never match what it wrote, and the save was refused as a layout it could not edit.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let mut f = form_of(&load(&path)).unwrap();
        f.writ = "\n\n\r\nBe brief.\r\nShow your working.\n\n".into();
        update(&path, &f).unwrap();
        assert_eq!(load(&path).writ.trim_end(), "Be brief.\nShow your working.");

        let mut g = form();
        g.writ = "\n\nYou are Night Owl.".into();
        let made = create(dir.path(), &g).unwrap();
        assert_eq!(form_of(&made).unwrap(), check(&g).unwrap());
    }

    #[test]
    fn a_save_changes_only_what_was_changed_on_the_page() {
        // The settings page reads the file once. A change made in the file after that — the writ
        // reworded in an editor — survives a save that changed only the model on the page.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let read = form_of(&load(&path)).unwrap();
        std::fs::write(&path, HAND_WRITTEN.replace("You are Vellum.", "You are Vellum, and terse.")).unwrap();
        let mut f = read.clone();
        f.model = Some("opus".into());
        update_since(&path, &f, &read).unwrap();
        let back = load(&path);
        assert_eq!(back.front.as_ref().unwrap().model.as_deref(), Some("opus"));
        assert_eq!(back.writ.trim_end(), "# Writ\n\nYou are Vellum, and terse.");
        // And what the page did change wins over the file, field by field.
        let read = form_of(&back).unwrap();
        let mut f = read.clone();
        f.writ = "Be brief.".into();
        std::fs::write(&path, std::fs::read_to_string(&path).unwrap().replace("model: opus", "model: haiku")).unwrap();
        update_since(&path, &f, &read).unwrap();
        let back = load(&path);
        assert_eq!(back.writ.trim_end(), "Be brief.");
        assert_eq!(back.front.unwrap().model.as_deref(), Some("haiku"));
    }

    #[test]
    fn a_question_id_written_by_hand_is_kept_whole() {
        // Ids the app makes up from a question are kept short; one a person wrote is theirs, and
        // a writ's `{{intake.…}}` may name it.
        let long = "the_piece_we_are_working_on_this_week";
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN.replace("id: piece", &format!("id: {long}"))).unwrap();
        let mut f = form_of(&load(&path)).unwrap();
        f.workspace = "~/elsewhere".into();
        update(&path, &f).unwrap();
        assert_eq!(load(&path).front.unwrap().intake[0].id, long);
    }

    #[test]
    fn a_broken_binding_is_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("broken.binding.md");
        std::fs::write(&path, "---\nname: Broken\norder: trumpet\n---\n").unwrap();
        let e = update(&path, &form()).unwrap_err();
        assert!(e.contains("Fix it in the file"), "{e}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "---\nname: Broken\norder: trumpet\n---\n");
    }

    #[test]
    fn a_retired_familiar_is_kept_beside_the_folder_and_no_longer_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vellum.binding.md");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let first = retire(&path).unwrap();
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let second = retire(&path).unwrap();
        assert_ne!(first, second);
        assert!(first.exists() && second.exists() && !path.exists());
        assert!(crate::binding::load_folder(dir.path()).is_empty());
    }

    #[test]
    fn names_become_file_names_a_person_would_choose() {
        assert_eq!(slug("Vellum"), "vellum");
        assert_eq!(slug("Night Owl 2"), "night-owl-2");
        assert_eq!(slug("  --Ünïcode!  "), "n-code");
        assert_eq!(slug("!!!"), "familiar");
    }
}
