use quintet_core::db::{self, Db};
use quintet_core::runs::recovery::{recover_on_launch, CRASH_REASON};
use quintet_core::types::RunStatus;

#[test]
fn running_runs_become_failed_and_queued_are_reported() {
    let db = Db::open_in_memory().expect("db");
    let running = db::runs::insert(&db, &db::runs::NewRun { agent_id: "a", trigger: "manual", session_id: "s1", integrity_level: None, intake_json: None, task_title: "crashed" }).expect("insert");
    db::runs::mark_running(&db, &running.id, Some(4_000_000), "/tmp/x.jsonl", "/tmp/out").expect("running");
    let queued = db::runs::insert(&db, &db::runs::NewRun { agent_id: "a", trigger: "manual", session_id: "s2", integrity_level: None, intake_json: None, task_title: "waiting" }).expect("insert");
    let done = db::runs::insert(&db, &db::runs::NewRun { agent_id: "a", trigger: "manual", session_id: "s3", integrity_level: None, intake_json: None, task_title: "done" }).expect("insert");
    db::runs::set_status(&db, &done.id, RunStatus::Done, None).expect("done");

    let rec = recover_on_launch(&db).expect("recover");
    assert_eq!(rec.len(), 2);
    let r = db::runs::get(&db, &running.id).expect("get").expect("row");
    assert_eq!(r.status, RunStatus::Failed);
    assert_eq!(r.error.as_deref(), Some(CRASH_REASON));
    assert!(r.pid.is_none());
    assert!(r.ended_at.is_some());
    assert_eq!(db::runs::get(&db, &queued.id).expect("get").expect("row").status, RunStatus::Queued);
    assert_eq!(db::runs::get(&db, &done.id).expect("get").expect("row").status, RunStatus::Done);
    // Idempotent.
    let rec2 = recover_on_launch(&db).expect("recover");
    assert_eq!(rec2.len(), 1);
    assert_eq!(rec2[0].from, RunStatus::Queued);
}
