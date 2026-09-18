//! Conservative classification of fonts that belong to an operating
//! system's private font environment.
//!
//! Classification is metadata only. Classified fonts are kept in the
//! catalog; the CLI only hides `Internal` faces by default and offers
//! `--show-internal` to reveal them.

use serde::Serialize;

/// How "system owned" a font looks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FontClassification {
    /// An ordinary user font.
    Normal,
    /// A well known system fallback font, e.g. `LastResort`.
    SystemLike,
    /// A private/internal font, e.g. names starting with a dot such as
    /// `.AppleSystemUIFont`.
    Internal,
}

/// Classifies a face from its PostScript and family names.
///
/// The rules are intentionally conservative and only cover strongly
/// recognized cases:
///
/// * names starting with `.` are `Internal`
/// * names containing `LastResort` are `SystemLike`
///
/// Everything else is `Normal`. The rules are pure and unit tested.
pub fn classify_names(
    postscript_name: Option<&str>,
    family_name: Option<&str>,
) -> FontClassification {
    let names = [postscript_name, family_name];
    let mut found = false;
    for name in names.into_iter().flatten() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        found = true;
        if trimmed.starts_with('.') {
            return FontClassification::Internal;
        }
    }
    if found
        && names
            .into_iter()
            .flatten()
            .any(|name| name.trim().to_ascii_lowercase().contains("lastresort"))
    {
        return FontClassification::SystemLike;
    }
    FontClassification::Normal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dot_prefixed_ps_name_is_internal() {
        assert_eq!(
            classify_names(Some(".AppleSystemUIFont"), Some(".AppleSystemUIFont")),
            FontClassification::Internal
        );
    }

    #[test]
    fn last_resort_is_system_like() {
        assert_eq!(
            classify_names(Some("LastResort"), Some("LastResort")),
            FontClassification::SystemLike
        );
    }

    #[test]
    fn ordinary_font_is_normal() {
        assert_eq!(
            classify_names(Some("Lato-Regular"), Some("Lato")),
            FontClassification::Normal
        );
    }

    #[test]
    fn missing_names_are_normal() {
        assert_eq!(classify_names(None, None), FontClassification::Normal);
        assert_eq!(
            classify_names(Some("   "), None),
            FontClassification::Normal
        );
    }
}
