//! Two-priority FIFO: manual runs go ahead of scheduled ones; at most `max` run at once.

use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Manual,
    Scheduled,
}

impl Priority {
    pub fn from_trigger(trigger: &str) -> Self {
        if trigger.starts_with("scheduled") { Priority::Scheduled } else { Priority::Manual }
    }
}

#[derive(Debug)]
pub struct Queue {
    manual: VecDeque<String>,
    scheduled: VecDeque<String>,
    running: HashSet<String>,
    pub max: usize,
}

impl Queue {
    pub fn new(max: usize) -> Self {
        Self { manual: VecDeque::new(), scheduled: VecDeque::new(), running: HashSet::new(), max: max.max(1) }
    }
    pub fn enqueue(&mut self, run_id: String, p: Priority) {
        if self.running.contains(&run_id) || self.manual.contains(&run_id) || self.scheduled.contains(&run_id) { return; }
        match p { Priority::Manual => self.manual.push_back(run_id), Priority::Scheduled => self.scheduled.push_back(run_id) }
    }
    /// Next run to launch, if a slot is free. Marks it running.
    pub fn pop_next(&mut self) -> Option<String> {
        if self.running.len() >= self.max { return None; }
        let id = self.manual.pop_front().or_else(|| self.scheduled.pop_front())?;
        self.running.insert(id.clone());
        Some(id)
    }
    pub fn mark_done(&mut self, run_id: &str) { self.running.remove(run_id); }
    pub fn remove_queued(&mut self, run_id: &str) -> bool {
        let before = self.manual.len() + self.scheduled.len();
        self.manual.retain(|x| x != run_id);
        self.scheduled.retain(|x| x != run_id);
        before != self.manual.len() + self.scheduled.len()
    }
    pub fn is_running(&self, run_id: &str) -> bool { self.running.contains(run_id) }
    pub fn running_count(&self) -> usize { self.running.len() }
    pub fn queued_count(&self) -> usize { self.manual.len() + self.scheduled.len() }
    pub fn is_idle(&self) -> bool { self.running.is_empty() && self.queued_count() == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_before_scheduled_and_slots() {
        let mut q = Queue::new(2);
        q.enqueue("s1".into(), Priority::Scheduled);
        q.enqueue("m1".into(), Priority::Manual);
        q.enqueue("s2".into(), Priority::Scheduled);
        q.enqueue("m1".into(), Priority::Manual); // duplicate ignored
        assert_eq!(q.pop_next().as_deref(), Some("m1"));
        assert_eq!(q.pop_next().as_deref(), Some("s1"));
        assert_eq!(q.pop_next(), None, "two slots busy");
        q.mark_done("m1");
        assert_eq!(q.pop_next().as_deref(), Some("s2"));
        assert!(!q.is_idle());
        q.mark_done("s1"); q.mark_done("s2");
        assert!(q.is_idle());
    }
}
