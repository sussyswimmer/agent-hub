//! The shipped agents in agents-default/ must be valid and seed correctly.

use std::path::{Path, PathBuf};

use quintet_core::paths::QuintetPaths;
use quintet_core::registry::parse_agent_md;
use quintet_core::seed::{seed, SeedSource};
use quintet_core::types::{IntakeType, Model};

fn repo_root() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repo") }

const AGENTS: [&str; 5] = ["research", "college", "scout", "school", "tutor"];

#[test]
fn every_default_agent_is_valid() {
    for id in AGENTS {
        let p = repo_root().join("agents-default").join(id).join("agent.md");
        let text = std::fs::read_to_string(&p).expect("read");
        let a = parse_agent_md(&text, id, &p);
        assert!(a.error.is_none(), "{id}: {}", a.error.unwrap_or_default());
        let d = a.def.expect("def");
        assert_eq!(d.id, id);
        assert_eq!(d.outputs_dir, id);
        assert!(d.allowed_tools.iter().any(|t| t == "mcp__quintet__*"), "{id} must allow quintet tools");
        assert!(a.body.lines().count() < 250, "{id} body too long");
        assert!(a.body.contains("# Role"), "{id} body needs a Role section");
        assert!(std::fs::read_to_string(p.with_file_name("memory.md")).expect("memory").starts_with("---\n"));
        // Spec-mandated frontmatter facts (CLAUDE.md §5).
        match id {
            "research" => {
                assert_eq!(d.model, Model::Opus);
                assert_eq!(d.max_turns, 60);
                assert!(d.intake.iter().any(|f| f.id == "citation_style" && f.skip_if.as_deref() == Some("memory.default_citation_style")));
                assert!(d.intake.iter().any(|f| f.id == "integrity" && f.max == Some(3)));
            }
            "college" => {
                assert_eq!(d.model, Model::Opus);
                assert_eq!(d.max_turns, 40);
                let f = d.intake.iter().find(|f| f.kind == IntakeType::Integrity).expect("integrity field");
                assert_eq!(f.max, Some(2), "essays capped at level 2");
                assert_eq!(d.schedules.len(), 1);
            }
            "scout" => {
                assert_eq!(d.model, Model::Sonnet);
                assert_eq!(d.max_turns, 50);
                assert_eq!(d.schedules.iter().map(|s| s.cron.as_str()).collect::<Vec<_>>(), vec!["0 7 * * 1", "30 7 * * *"]);
                assert!(d.schedules.iter().any(|s| s.task == "db:deadline_watch"));
            }
            "school" => {
                assert_eq!(d.schedules.iter().map(|s| s.cron.as_str()).collect::<Vec<_>>(), vec!["0 19 * * 0", "45 6 * * 1-5"]);
                assert!(d.intake.iter().any(|f| f.id == "integrity" && f.skip_if.is_some()));
            }
            "tutor" => {
                assert_eq!(d.schedules[0].cron, "30 20 * * *");
                assert_eq!(d.schedules[0].task, "db:cards_due");
            }
            _ => unreachable!(),
        }
        assert!(d.schedules.iter().all(|s| s.tz == "Asia/Saigon"));
    }
}

#[test]
fn repo_defaults_seed_five_agents_and_profile() {
    let tmp = tempfile::tempdir().expect("tmp");
    let paths = QuintetPaths::at(tmp.path().join("Quintet"));
    let r = seed(&SeedSource::from_root(repo_root()), &paths).expect("seed");
    let mut ids = r.agents_created.clone();
    ids.sort();
    assert_eq!(ids, ["college", "research", "school", "scout", "tutor"]);
    assert!(r.profile_created);
    let profile = std::fs::read_to_string(paths.profile_md()).expect("profile");
    for h in ["School & grades", "Courses this year", "Activities", "Interests", "College goals", "Constraints & schedule", "Voice notes"] {
        assert!(profile.contains(&format!("## {h}")), "profile missing heading {h}");
    }
}
