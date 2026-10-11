//! 指定字款的 Unicode 字符映射与稳定分页。

use read_fonts::{
    tables::cmap::{CmapIterLimits, CmapSubtable},
    FontRef, TableProvider,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use unicode_script::UnicodeScript;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterEntry {
    pub codepoint: u32,
    pub glyph_id: u32,
    pub script: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterScript {
    pub name: String,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterPage {
    pub entries: Vec<CharacterEntry>,
    pub total: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CharacterMapError {
    #[error("characterMap.error.invalidFont")]
    InvalidFont,
    #[error("characterMap.error.invalidQuery")]
    InvalidQuery,
}

#[derive(Clone, Debug)]
pub struct CharacterMapIndex {
    entries: Vec<CharacterEntry>,
    glyphs: BTreeSet<u32>,
    pub scripts: Vec<CharacterScript>,
}

impl CharacterMapIndex {
    pub fn from_data(data: &[u8], face_index: u32) -> Result<Self, CharacterMapError> {
        let font =
            FontRef::from_index(data, face_index).map_err(|_| CharacterMapError::InvalidFont)?;
        let glyph_count = font
            .maxp()
            .map_err(|_| CharacterMapError::InvalidFont)?
            .num_glyphs() as u32;
        let mut mappings = BTreeMap::new();
        let mut scripts = BTreeMap::<String, u32>::new();
        let cmap = font.cmap().map_err(|_| CharacterMapError::InvalidFont)?;
        let subtable = cmap
            .best_subtable()
            .filter(|(_, record, _)| !record.is_mac_roman())
            .map(|(_, _, table)| table);
        let pairs: Box<dyn Iterator<Item = (u32, read_fonts::types::GlyphId)> + '_> =
            match &subtable {
                Some(CmapSubtable::Format0(table)) => Box::new((0..256).filter_map(|codepoint| {
                    table
                        .map_codepoint(codepoint)
                        .map(|glyph| (codepoint, glyph))
                })),
                Some(table) => Box::new(table.iter_with_limits(CmapIterLimits {
                    max_char: 0x110000,
                    glyph_count,
                })),
                None => Box::new(std::iter::empty()),
            };
        for (codepoint, glyph) in pairs {
            let Some(character) = char::from_u32(codepoint) else {
                continue;
            };
            let glyph_id = glyph.to_u32();
            if glyph_id == 0 {
                continue;
            }
            if glyph_id >= glyph_count {
                return Err(CharacterMapError::InvalidFont);
            }
            mappings.insert(
                codepoint,
                CharacterEntry {
                    codepoint,
                    glyph_id,
                    script: character.script().full_name().to_owned(),
                },
            );
        }
        let entries: Vec<_> = mappings.into_values().collect();
        for entry in &entries {
            *scripts.entry(entry.script.clone()).or_default() += 1;
        }
        let glyphs = entries.iter().map(|entry| entry.glyph_id).collect();
        Ok(Self {
            entries,
            glyphs,
            scripts: scripts
                .into_iter()
                .map(|(name, count)| CharacterScript { name, count })
                .collect(),
        })
    }

    pub fn len(&self) -> u32 {
        self.entries.len() as u32
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn contains_glyph(&self, glyph_id: u32) -> bool {
        self.glyphs.contains(&glyph_id)
    }

    pub fn query(
        &self,
        text: &str,
        script: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<CharacterPage, CharacterMapError> {
        let codepoint = parse_character_search(text)?;
        let script = script.filter(|value| !value.is_empty());
        let limit = limit.clamp(1, 1024) as usize;
        if let Some(codepoint) = codepoint {
            let entry = self
                .entries
                .binary_search_by_key(&codepoint, |entry| entry.codepoint)
                .ok()
                .map(|index| &self.entries[index])
                .filter(|entry| script.is_none_or(|script| entry.script == script));
            return Ok(CharacterPage {
                entries: if offset == 0 {
                    entry.cloned().into_iter().collect()
                } else {
                    vec![]
                },
                total: u32::from(entry.is_some()),
                offset,
            });
        }
        if script.is_none() {
            return Ok(CharacterPage {
                entries: self
                    .entries
                    .iter()
                    .skip(offset as usize)
                    .take(limit)
                    .cloned()
                    .collect(),
                total: self.len(),
                offset,
            });
        }
        let matches = |entry: &&CharacterEntry| {
            codepoint.is_none_or(|value| entry.codepoint == value)
                && script.is_none_or(|value| entry.script == value)
        };
        let total = self.entries.iter().filter(matches).count() as u32;
        let entries = self
            .entries
            .iter()
            .filter(matches)
            .skip(offset as usize)
            .take(limit)
            .cloned()
            .collect();
        Ok(CharacterPage {
            entries,
            total,
            offset,
        })
    }
}

pub fn parse_character_search(text: &str) -> Result<Option<u32>, CharacterMapError> {
    if text.is_empty() {
        return Ok(None);
    }
    let trimmed = text.trim();
    if let Some(hex) = trimmed
        .strip_prefix("U+")
        .or_else(|| trimmed.strip_prefix("u+"))
    {
        if hex.is_empty() || hex.len() > 6 || !hex.bytes().all(|value| value.is_ascii_hexdigit()) {
            return Err(CharacterMapError::InvalidQuery);
        }
        return u32::from_str_radix(hex, 16)
            .ok()
            .filter(|value| char::from_u32(*value).is_some())
            .map(Some)
            .ok_or(CharacterMapError::InvalidQuery);
    }
    let mut characters = text.chars();
    match (characters.next(), characters.next()) {
        (Some(character), None) => Ok(Some(character as u32)),
        _ => Err(CharacterMapError::InvalidQuery),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_unicode_scalars_without_normalizing_characters() {
        for (text, codepoint) in [
            ("A", 0x41),
            (" ", 0x20),
            ("𠀀", 0x20000),
            ("u+1F600", 0x1f600),
            (" U+0041 ", 0x41),
        ] {
            assert_eq!(parse_character_search(text), Ok(Some(codepoint)));
        }
        for text in [
            "U+D800",
            "U+110000",
            "U+",
            "U+0000000",
            "ab",
            "a\u{301}",
            "😀😀",
        ] {
            assert_eq!(
                parse_character_search(text),
                Err(CharacterMapError::InvalidQuery)
            );
        }
    }

    #[test]
    fn pagination_preserves_aliases_scripts_and_order() {
        let index = CharacterMapIndex {
            entries: vec![
                CharacterEntry {
                    codepoint: 32,
                    glyph_id: 1,
                    script: "Common".into(),
                },
                CharacterEntry {
                    codepoint: 65,
                    glyph_id: 2,
                    script: "Latin".into(),
                },
                CharacterEntry {
                    codepoint: 66,
                    glyph_id: 2,
                    script: "Latin".into(),
                },
                CharacterEntry {
                    codepoint: 0x20000,
                    glyph_id: 3,
                    script: "Han".into(),
                },
            ],
            glyphs: [1, 2, 3].into(),
            scripts: vec![],
        };
        let page = index.query("", Some("Latin"), 1, 256).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.entries[0].codepoint, 66);
        assert_eq!(
            index.query("U+20000", None, 0, 256).unwrap().entries[0].glyph_id,
            3
        );
        assert!(index.query("", None, 20, 256).unwrap().entries.is_empty());
    }
}
