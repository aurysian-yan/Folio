//! 真实目录查询与约 2 万字面的性能冒烟；只输出聚合统计。
use folio_core::*;
use folio_query::*;
use folio_storage::{FolioDatabase, RefreshMode};
use std::{path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: query_smoke <temporary-db> <font-directory>".into());
    }
    let mut db = FolioDatabase::open(PathBuf::from(&args[0]))?;
    db.add_root(PathBuf::from(&args[1]), true)?;
    let cold = db.refresh(RefreshMode::Incremental)?;
    let warm = db.refresh(RefreshMode::Incremental)?;
    assert_eq!(warm.stats.files_hashed, 0);
    assert_eq!(warm.stats.files_reparsed, 0);
    let catalog = &warm.catalog;
    let first = catalog.faces().next().ok_or("empty catalog")?;
    let collection = db.create_collection("Smoke")?;
    db.set_favorite(first.identity_id, true)?;
    db.add_collection_members(collection.id, &[first.identity_id])?;
    let state = db.library_state_snapshot()?;
    let start = Instant::now();
    let index = FontQueryIndex::build(catalog, &state)?;
    let build_ms = start.elapsed().as_secs_f64() * 1000.0;
    let family = first.metadata.family_name.clone().unwrap_or_default();
    let subfamily = first.metadata.subfamily_name.clone().unwrap_or_default();
    let mut other = FontCategory::SansSerif;
    if first.metadata.enrichment.category == other {
        other = FontCategory::Serif;
    }
    let cases = [
        FontQuery {
            text: Some(family.clone()),
            ..Default::default()
        },
        FontQuery {
            text: Some(format!("{family} {subfamily}")),
            ..Default::default()
        },
        FontQuery {
            facets: FacetFilter {
                categories: vec![first.metadata.enrichment.category],
                ..Default::default()
            },
            ..Default::default()
        },
        FontQuery {
            facets: FacetFilter {
                categories: vec![first.metadata.enrichment.category, other],
                ..Default::default()
            },
            ..Default::default()
        },
        FontQuery {
            facets: FacetFilter {
                categories: vec![first.metadata.enrichment.category],
                licenses: vec![first.metadata.enrichment.license.detected_kind],
                ..Default::default()
            },
            ..Default::default()
        },
        FontQuery {
            scope: QueryScope::Favorites,
            ..Default::default()
        },
        FontQuery {
            scope: QueryScope::Collection(collection.id),
            ..Default::default()
        },
    ];
    let counts: Vec<_> = cases
        .iter()
        .map(|q| index.query(q).map(|r| r.total_matches))
        .collect::<Result<_, _>>()?;
    assert!(counts.iter().all(|n| *n > 0));
    println!("{{\"faces\":{},\"families\":{},\"cold_issues\":{},\"warm_metadata_hits\":{},\"warm_hashes\":{},\"warm_parses\":{},\"index_build_ms\":{:.3},\"query_counts_A_G\":{:?},\"health_identities\":{},\"conflicts\":{}}}",catalog.face_count(),catalog.family_count(),cold.issues.len(),warm.stats.metadata_cache_hits,warm.stats.files_hashed,warm.stats.files_reparsed,build_ms,counts,index.health().identities.len(),index.health().identities.iter().filter(|h|!h.conflicts.is_empty()).count());
    let templates: Vec<_> = catalog.faces().cloned().collect();
    let mut large = Catalog::default();
    for i in 0..20_000u128 {
        let mut face = templates[i as usize % templates.len()].clone();
        let raw = (i + 1).to_le_bytes();
        let family_id = FontFamilyId::from_bytes(raw);
        face.id = FontFaceId::from_bytes(raw);
        face.identity_id = FontIdentityId::from_bytes(raw);
        face.revision_id = FontRevisionId::from_bytes(raw);
        face.family_id = family_id;
        large.families.push(FontFamily {
            id: family_id,
            display_name: Some(format!("Synthetic Family {i:05}")),
            localized_names: Vec::new(),
            faces: vec![face],
        });
    }
    let start = Instant::now();
    let index = FontQueryIndex::build(&large, &LibraryStateSnapshot::default())?;
    let build_ms = start.elapsed().as_secs_f64() * 1000.0;
    let perf_queries = [
        FontQuery::default(),
        FontQuery {
            text: Some("synthetic family 000".into()),
            ..Default::default()
        },
        FontQuery {
            facets: FacetFilter {
                categories: vec![FontCategory::SansSerif, FontCategory::Serif],
                scripts: vec!["Latin".into()],
                licenses: vec![LicenseKind::SilOpenFontLicense],
                ..Default::default()
            },
            ..Default::default()
        },
    ];
    let mut timings = Vec::new();
    let mut matches = Vec::new();
    for q in perf_queries {
        let start = Instant::now();
        let result = index.query(&q)?;
        timings.push(start.elapsed().as_secs_f64() * 1000.0);
        matches.push(result.total_matches);
    }
    println!("{{\"synthetic_faces\":20000,\"index_build_ms\":{build_ms:.3},\"empty_text_multifacet_ms\":{timings:?},\"matches\":{matches:?}}}");
    Ok(())
}
