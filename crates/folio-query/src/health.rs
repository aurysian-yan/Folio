//! 可重建的来源重复、并存修订和关键元数据冲突分析。
use folio_core::*;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum ConflictField {
    Family,
    Subfamily,
    Manufacturer,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MetadataConflict {
    pub field: ConflictField,
    pub normalized_values: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct IdentityHealth {
    pub identity_id: FontIdentityId,
    pub face_ids: Vec<FontFaceId>,
    pub revision_ids: Vec<FontRevisionId>,
    pub duplicate_source_faces: Vec<FontFaceId>,
    pub conflicts: Vec<MetadataConflict>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct CatalogHealth {
    pub identities: Vec<IdentityHealth>,
}
pub fn analyze_catalog(catalog: &Catalog) -> CatalogHealth {
    let mut groups: BTreeMap<_, Vec<_>> = BTreeMap::new();
    for face in catalog.faces() {
        groups.entry(face.identity_id).or_default().push(face);
    }
    let mut identities = Vec::new();
    for (identity_id, faces) in groups {
        let revision_ids: Vec<_> = faces
            .iter()
            .map(|f| f.revision_id)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let mut conflicts = Vec::new();
        if revision_ids.len() > 1 {
            for field in [
                ConflictField::Family,
                ConflictField::Subfamily,
                ConflictField::Manufacturer,
            ] {
                let values: BTreeSet<_> = faces
                    .iter()
                    .filter_map(|f| match field {
                        ConflictField::Family => f.metadata.family_name.as_deref(),
                        ConflictField::Subfamily => f.metadata.subfamily_name.as_deref(),
                        ConflictField::Manufacturer => {
                            f.metadata.enrichment.foundry.manufacturer.as_deref()
                        }
                    })
                    .map(normalize_search)
                    .filter(|s| !s.is_empty())
                    .collect();
                if values.len() > 1 {
                    conflicts.push(MetadataConflict {
                        field,
                        normalized_values: values.into_iter().collect(),
                    });
                }
            }
        }
        let duplicate_source_faces: Vec<_> = faces
            .iter()
            .filter(|f| f.sources.len() > 1)
            .map(|f| f.id)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        if revision_ids.len() > 1 || !duplicate_source_faces.is_empty() {
            identities.push(IdentityHealth {
                identity_id,
                face_ids: faces
                    .iter()
                    .map(|f| f.id)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect(),
                revision_ids,
                duplicate_source_faces,
                conflicts,
            });
        }
    }
    CatalogHealth { identities }
}
