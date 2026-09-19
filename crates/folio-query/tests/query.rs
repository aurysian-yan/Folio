//! 共享查询语义与确定性验收。
use folio_core::*;
use folio_query::*;
fn fixture(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/fonts")
        .join(name)
}
fn catalog() -> Catalog {
    scan_files(
        &[
            fixture("Lato-Regular.ttf"),
            fixture("Lato-Bold.ttf"),
            fixture("Lato-Italic.ttf"),
            fixture("SourceSerif4-Regular.otf"),
            fixture("Inter-Variable.ttf"),
        ],
        &ScanOptions::default(),
    )
    .unwrap()
    .catalog
}
fn build(c: &Catalog) -> FontQueryIndex {
    FontQueryIndex::build(c, &LibraryStateSnapshot::default()).unwrap()
}
fn text(index: &FontQueryIndex, value: &str) -> QueryResult {
    index
        .query(&FontQuery {
            text: Some(value.into()),
            ..Default::default()
        })
        .unwrap()
}
fn query(index: &FontQueryIndex, facets: FacetFilter) -> QueryResult {
    index
        .query(&FontQuery {
            facets,
            ..Default::default()
        })
        .unwrap()
}
fn lato(c: &Catalog) -> &FontFamily {
    c.families
        .iter()
        .find(|f| f.display_name.as_deref() == Some("Lato"))
        .unwrap()
}
#[test]
fn all_required_search_fields_and_token_and_are_indexed() {
    let mut c = catalog();
    let family = c
        .families
        .iter_mut()
        .find(|f| f.display_name.as_deref() == Some("Lato"))
        .unwrap();
    for face in &mut family.faces {
        face.metadata.enrichment.foundry.manufacturer = Some("Example Foundry".into());
        face.metadata.enrichment.foundry.designer = Some("Jane Designer".into());
        face.metadata.enrichment.foundry.vendor_id = Some("TEST".into());
        face.metadata.localized_names.push(LocalizedName {
            kind: NameKind::Family,
            language: Some("zh".into()),
            value: "示例字体".into(),
            locale: None,
        });
    }
    let index = build(&c);
    for term in [
        "Lato",
        "Lat",
        "示例字体",
        "Lato-Regular",
        "Regular",
        "Lato-Regular.ttf",
        "Example Foundry",
        "Jane Designer",
        "TEST",
        "OFL",
        "lAtO",
        "Lato Bold",
    ] {
        assert!(text(&index, term).total_matches > 0, "{term}");
    }
    assert_eq!(text(&index, "Lato no-such-token").total_matches, 0);
    let result = text(&index, "Lato Bold");
    assert_eq!(result.total_matches, 1);
    assert_eq!(result.families[0].matched_face_ids.len(), 1);
}
#[test]
fn normalization_handles_canonical_unicode_whitespace_case_without_transliteration() {
    assert_eq!(
        normalize_search("  CAFÉ\u{a0} FONTS "),
        normalize_search("cafe\u{301}\tfonts")
    );
    assert_ne!(normalize_search("cafe"), normalize_search("café"));
    assert_ne!(normalize_search("Ａ"), normalize_search("A"));
    let mut c = catalog();
    c.families[0].display_name = Some("Café Fonts".into());
    let index = build(&c);
    assert_eq!(
        text(&index, "CAFE\u{301}  fonts").families[0].family_id,
        c.families[0].id
    );
}
#[test]
fn ranking_prefers_exact_then_prefix_then_substring_family() {
    let mut c = catalog();
    assert!(c.families.len() >= 3);
    for (family, name) in c.families.iter_mut().zip(["Lato", "Lato Next", "My Lato"]) {
        family.display_name = Some(name.into());
    }
    let r = text(&build(&c), "lato");
    assert_eq!(
        r.families
            .iter()
            .take(3)
            .map(|f| f.display_name.as_deref().unwrap())
            .collect::<Vec<_>>(),
        ["Lato", "Lato Next", "My Lato"]
    );
    assert!(r.families[0].score > r.families[1].score && r.families[1].score > r.families[2].score);
}
#[test]
fn same_facet_or_cross_facet_and_and_family_count() {
    let mut c = catalog();
    for (i, family) in c.families.iter_mut().enumerate() {
        for face in &mut family.faces {
            let e = &mut face.metadata.enrichment;
            e.category = if i == 0 {
                FontCategory::SansSerif
            } else {
                FontCategory::Monospace
            };
            e.scripts = vec![ScriptCoverage {
                script: if i == 2 { "Han" } else { "Latin" }.into(),
                codepoint_count: 1,
            }];
            e.license.detected_kind = LicenseKind::SilOpenFontLicense;
        }
    }
    let index = build(&c);
    let categories = vec![FontCategory::SansSerif, FontCategory::Monospace];
    assert_eq!(
        query(
            &index,
            FacetFilter {
                categories: categories.clone(),
                ..Default::default()
            }
        )
        .total_matches,
        3
    );
    let r = query(
        &index,
        FacetFilter {
            categories,
            scripts: vec!["Latin".into()],
            licenses: vec![LicenseKind::SilOpenFontLicense],
            ..Default::default()
        },
    );
    assert_eq!(r.total_matches, 2);
    let count = r
        .facet_summary
        .iter()
        .find(|v| v.value == FacetValue::Script("Latin".into()))
        .unwrap();
    assert_eq!(count.family_count, 2);
}
#[test]
fn weight_bold_and_feature_italic_must_match_one_face() {
    let mut c = catalog();
    c.families
        .retain(|f| f.display_name.as_deref() == Some("Lato"));
    let filters = FacetFilter {
        weights: vec![FontWeight::BOLD],
        features: vec![FontFeature::Italic],
        ..Default::default()
    };
    assert_eq!(query(&build(&c), filters.clone()).total_matches, 0);
    let face = c.families[0]
        .faces
        .iter_mut()
        .find(|f| f.metadata.style == FontStyle::Italic)
        .unwrap();
    face.metadata.weight = Some(FontWeight::BOLD);
    let id = face.id;
    let r = query(&build(&c), filters);
    assert_eq!(r.total_matches, 1);
    assert_eq!(r.families[0].matched_face_ids, vec![id]);
    assert_eq!(r.families[0].matched_identity_ids.len(), 1);
}
#[test]
fn scopes_report_unresolved_and_compose_with_text_and_facets() {
    let c = catalog();
    let faces = &lato(&c).faces;
    let selected = faces
        .iter()
        .find(|f| f.metadata.weight == Some(FontWeight::BOLD))
        .unwrap();
    let missing = FontIdentityId::from_bytes([99; 16]);
    let cid = CollectionId::from_bytes([1; 16]);
    let state = LibraryStateSnapshot {
        favorites: vec![selected.identity_id, missing],
        recent: vec![
            RecentFont {
                identity_id: selected.identity_id,
                last_accessed_at_ns: 10,
            },
            RecentFont {
                identity_id: missing,
                last_accessed_at_ns: 20,
            },
        ],
        collections: vec![CollectionMembers {
            collection_id: cid,
            identities: vec![selected.identity_id, missing],
        }],
        ..Default::default()
    };
    let index = FontQueryIndex::build(&c, &state).unwrap();
    for scope in [
        QueryScope::Favorites,
        QueryScope::Recent,
        QueryScope::Collection(cid),
    ] {
        let q = FontQuery {
            text: Some("Lato Bold".into()),
            scope,
            facets: FacetFilter {
                weights: vec![FontWeight::BOLD],
                ..Default::default()
            },
            ..Default::default()
        };
        let r = index.query(&q).unwrap();
        assert_eq!(r.total_matches, 1);
        assert_eq!(r.families[0].matched_face_ids, vec![selected.id]);
        assert_eq!(r.unresolved_scope_items, vec![missing]);
    }
    assert!(matches!(
        index.query(&FontQuery {
            scope: QueryScope::Collection(CollectionId::from_bytes([8; 16])),
            ..Default::default()
        }),
        Err(QueryError::CollectionNotFound(_))
    ));
}
#[test]
fn recent_sort_and_state_update_do_not_rebuild_metadata() {
    let c = catalog();
    let first = &c.families[0].faces[0];
    let second = &c.families[1].faces[0];
    let mut index = build(&c);
    let state = LibraryStateSnapshot {
        favorites: vec![first.identity_id],
        recent: vec![
            RecentFont {
                identity_id: first.identity_id,
                last_accessed_at_ns: 10,
            },
            RecentFont {
                identity_id: second.identity_id,
                last_accessed_at_ns: 20,
            },
        ],
        ..Default::default()
    };
    index.update_state(&state);
    let q = FontQuery {
        scope: QueryScope::Recent,
        ..Default::default()
    };
    let r = index.query(&q).unwrap();
    assert_eq!(r.families[0].family_id, second.family_id);
    assert_eq!(r.families[1].family_id, first.family_id);
    assert_eq!(index.query(&q).unwrap(), r);
    assert_eq!(
        query(
            &index,
            FacetFilter {
                states: vec![FontState::Favorite],
                ..Default::default()
            }
        )
        .families[0]
            .family_id,
        first.family_id
    );
}
#[test]
fn overlapping_roots_or_does_not_duplicate_family_or_count() {
    let c = catalog();
    let family = lato(&c);
    let roots = vec![
        RootMembership {
            root_id: LibraryRootKey([1; 16]),
            face_ids: family.faces.iter().map(|f| f.id).collect(),
        },
        RootMembership {
            root_id: LibraryRootKey([2; 16]),
            face_ids: family.faces.iter().map(|f| f.id).collect(),
        },
    ];
    let index = FontQueryIndex::build(
        &c,
        &LibraryStateSnapshot {
            roots,
            ..Default::default()
        },
    )
    .unwrap();
    let r = query(
        &index,
        FacetFilter {
            roots: vec![LibraryRootKey([1; 16]), LibraryRootKey([2; 16])],
            ..Default::default()
        },
    );
    assert_eq!(r.total_matches, 1);
    assert_eq!(r.families[0].matched_face_ids.len(), family.faces.len());
    assert!(r
        .facet_summary
        .iter()
        .filter(|f| matches!(f.value, FacetValue::Root(_)))
        .all(|f| f.family_count == 1));
}
#[test]
fn pagination_summary_and_serialization_are_deterministic() {
    let mut c = catalog();
    let index = build(&c);
    let q = FontQuery::default();
    let expected = index.query(&q).unwrap();
    let bytes = serde_json::to_vec(&expected).unwrap();
    for _ in 0..5 {
        assert_eq!(
            serde_json::to_vec(&index.query(&q).unwrap()).unwrap(),
            bytes
        );
    }
    c.families.reverse();
    for f in &mut c.families {
        f.faces.reverse();
    }
    assert_eq!(build(&c).query(&q).unwrap(), expected);
    let page = index
        .query(&FontQuery {
            offset: 1,
            limit: Some(1),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.total_matches, expected.total_matches);
    assert_eq!(page.facet_summary, expected.facet_summary);
    assert_eq!(page.families, expected.families[1..2]);
    assert!(index
        .query(&FontQuery {
            offset: usize::MAX,
            ..Default::default()
        })
        .unwrap()
        .families
        .is_empty());
}
#[test]
fn foundry_key_merges_canonical_case_variants_but_keeps_display_label() {
    let mut c = catalog();
    for (i, f) in c.families.iter_mut().enumerate() {
        for face in &mut f.faces {
            face.metadata.enrichment.foundry.manufacturer =
                Some(if i == 0 { "CAFÉ" } else { "cafe\u{301}" }.into());
        }
    }
    let r = query(
        &build(&c),
        FacetFilter {
            foundries: vec![FoundryKey::new("café")],
            ..Default::default()
        },
    );
    assert_eq!(r.total_matches, c.family_count());
    let facets: Vec<_> = r
        .facet_summary
        .iter()
        .filter(|f| matches!(f.value, FacetValue::Foundry(_)))
        .collect();
    assert_eq!(facets.len(), 1);
    assert_eq!(facets[0].family_count, c.family_count());
    assert!(facets[0].display_label.is_some());
}
#[test]
fn duplicate_sources_multiple_revisions_and_conflicts_are_distinct() {
    let mut c = catalog();
    c.families
        .retain(|f| f.display_name.as_deref() == Some("Lato"));
    c.families[0].faces.truncate(1);
    c.families[0].faces[0]
        .sources
        .push(FontSource::local_file("duplicate.ttf", 0, 1, None));
    let health = analyze_catalog(&c);
    assert_eq!(health.identities[0].duplicate_source_faces.len(), 1);
    assert_eq!(health.identities[0].revision_ids.len(), 1);
    assert!(health.identities[0].conflicts.is_empty());
    let mut next = c.families[0].faces[0].clone();
    next.id = FontFaceId::from_bytes([7; 16]);
    next.revision_id = FontRevisionId::from_bytes([8; 16]);
    next.sources.truncate(1);
    next.metadata.font_version.version_string = Some("Version 2.0".into());
    c.families[0].faces.push(next);
    assert!(analyze_catalog(&c).identities[0].conflicts.is_empty());
    c.families[0].faces[0]
        .metadata
        .enrichment
        .foundry
        .manufacturer = Some("Original".into());
    c.families[0].faces[1]
        .metadata
        .enrichment
        .foundry
        .manufacturer = Some("Unrelated".into());
    let h = analyze_catalog(&c);
    assert_eq!(h.identities[0].revision_ids.len(), 2);
    assert_eq!(
        h.identities[0].conflicts[0].field,
        ConflictField::Manufacturer
    );
    let index = build(&c);
    for state in [
        FontState::MultipleRevisions,
        FontState::DuplicateSources,
        FontState::MetadataConflict,
    ] {
        assert_eq!(
            query(
                &index,
                FacetFilter {
                    states: vec![state],
                    ..Default::default()
                }
            )
            .total_matches,
            1
        );
    }
}
#[test]
fn width_feature_and_weight_multiselect_and_empty_index() {
    let mut c = catalog();
    let face = &mut c.families[0].faces[0];
    face.metadata.is_variable = true;
    face.metadata.enrichment.monospace = true;
    face.metadata.style = FontStyle::Oblique { angle: Some(-12.0) };
    face.metadata.width = Some(FontWidth::CONDENSED);
    face.metadata.enrichment.feature_tags.push("ss01".into());
    let id = face.id;
    let index = build(&c);
    for feature in [
        FontFeature::Variable,
        FontFeature::Monospace,
        FontFeature::Oblique,
        FontFeature::OpenType("ss01".into()),
    ] {
        assert!(query(
            &index,
            FacetFilter {
                features: vec![feature],
                widths: vec![FontWidth::CONDENSED],
                ..Default::default()
            }
        )
        .families
        .iter()
        .any(|f| f.matched_face_ids.contains(&id)));
    }
    assert!(
        query(
            &index,
            FacetFilter {
                weights: vec![FontWeight::BOLD, FontWeight::REGULAR],
                ..Default::default()
            }
        )
        .total_matches
            > 0
    );
    assert_eq!(
        build(&Catalog::default())
            .query(&FontQuery::default())
            .unwrap()
            .total_matches,
        0
    );
}
#[test]
fn build_rejects_inconsistent_catalog_ids() {
    let mut c = catalog();
    c.families.push(c.families[0].clone());
    assert!(matches!(
        FontQueryIndex::build(&c, &Default::default()),
        Err(QueryError::DuplicateFamily(_))
    ));
    c.families.pop();
    let duplicate = c.families[0].faces[0].clone();
    c.families[0].faces.push(duplicate);
    assert!(matches!(
        FontQueryIndex::build(&c, &Default::default()),
        Err(QueryError::InvalidFace(_))
    ));
}
