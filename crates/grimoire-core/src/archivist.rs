//! The archivist's deliberately narrow proposal language (§6.8).
//!
//! There is no dispatch operation here. The helper command is parsed by the live seal server,
//! tied to the summoning that asked, and converted into a proposal the owner must seal.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Proposal {
    pub familiar_id: String,
    pub prompt: String,
}

/// Read a proposal command out of a shell action.
///
/// The prompt is a JSON string so spaces and punctuation have one unambiguous representation:
/// `grimoire archivist-propose sconce "Research the question"`.
pub fn parse_command(command: &str) -> Option<Result<Proposal, String>> {
    const BARE: &str = "archivist-propose ";
    const EMBEDDED: &str = " archivist-propose ";

    let rest = command
        .strip_prefix(BARE)
        .or_else(|| command.split_once(EMBEDDED).map(|(_, rest)| rest))?;
    Some((|| {
        let (familiar_id, encoded_prompt) = rest.trim().split_once(' ').ok_or_else(|| {
            "An archivist proposal needs a familiar id and a JSON-quoted commission prompt.".to_string()
        })?;
        if familiar_id.is_empty()
            || !familiar_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err("The proposed familiar id is not valid.".into());
        }
        let prompt: String = serde_json::from_str(encoded_prompt.trim())
            .map_err(|_| "The proposed commission prompt must be one JSON string.".to_string())?;
        if prompt.trim().is_empty() {
            return Err("The proposed commission prompt is empty.".into());
        }
        Ok(Proposal { familiar_id: familiar_id.to_string(), prompt })
    })())
}
