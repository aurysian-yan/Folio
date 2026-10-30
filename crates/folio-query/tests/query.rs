//! 共享查询语义与确定性验收。
use folio_core::*;
use folio_query::*;
use std::collections::BTreeSet;
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
    face.metadata.enrichment.monospace = true;
    face.metadata.style = FontStyle::Oblique { angle: Some(-12.0) };
    face.metadata.width = Some(FontWidth::CONDENSED);
    face.metadata.enrichment.feature_tags.push("ss01".into());
    let id = face.id;
    let index = build(&c);
    for feature in [
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
fn variable_feature_uses_declared_axes_and_multiple_variants_uses_distinct_identities() {
    let mut c = catalog();
    let inter_id = c
        .families
        .iter()
        .find(|family| family.display_name.as_deref() == Some("Inter"))
        .unwrap()
        .id;
    let inter = c
        .families
        .iter_mut()
        .find(|family| family.id == inter_id)
        .unwrap();
    assert!(!inter.faces[0].metadata.variable_axes.is_empty());
    inter.faces[0].metadata.is_variable = false;

    let lato = c
        .families
        .iter_mut()
        .find(|family| family.display_name.as_deref() == Some("Lato"))
        .unwrap();
    assert!(lato.faces.len() > 1);
    lato.faces[0].metadata.is_variable = true;
    lato.faces[0].metadata.variable_axes.clear();

    let index = build(&c);
    let variable = query(
        &index,
        FacetFilter {
            features: vec![FontFeature::Variable],
            ..Default::default()
        },
    );
    assert_eq!(variable.total_matches, 1);
    assert_eq!(variable.families[0].family_id, inter_id);

    let multiple = query(
        &index,
        FacetFilter {
            multiple_variants: true,
            ..Default::default()
        },
    );
    assert_eq!(multiple.total_matches, 1);
    assert_eq!(multiple.families[0].display_name.as_deref(), Some("Lato"));
    assert!(multiple.families[0].matched_identity_ids.len() > 1);
}

#[test]
fn saved_query_round_trips_portable_facets_and_excludes_local_roots() {
    let facets = FacetFilter {
        categories: vec![FontCategory::SansSerif, FontCategory::Serif],
        scripts: vec!["Latin".into(), "Han".into()],
        licenses: vec![LicenseKind::SilOpenFontLicense, LicenseKind::Apache2],
        foundries: vec![FoundryKey::new("Example Foundry")],
        weights: vec![FontWeight::REGULAR, FontWeight::BOLD],
        widths: vec![FontWidth::NORMAL, FontWidth::CONDENSED],
        features: vec![FontFeature::Italic, FontFeature::OpenType("ss01".into())],
        states: vec![FontState::Favorite, FontState::Recent],
        multiple_variants: true,
        ..Default::default()
    };
    let saved = SavedFontQuery::from_filter(Some("  Lato  ".into()), facets.clone()).unwrap();
    let reversed = SavedFontQuery::from_filter(
        Some("  Lato  ".into()),
        FacetFilter {
            categories: facets.categories.iter().rev().copied().collect(),
            scripts: facets.scripts.iter().rev().cloned().collect(),
            licenses: facets.licenses.iter().rev().copied().collect(),
            foundries: facets.foundries.iter().rev().cloned().collect(),
            weights: facets.weights.iter().rev().copied().collect(),
            widths: facets.widths.iter().rev().copied().collect(),
            features: facets.features.iter().rev().cloned().collect(),
            states: facets.states.iter().rev().copied().collect(),
            multiple_variants: facets.multiple_variants,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        serde_json::to_string(&saved).unwrap(),
        serde_json::to_string(&reversed).unwrap()
    );
    let json = serde_json::to_string(&saved).unwrap();
    let decoded: SavedFontQuery = serde_json::from_str(&json).unwrap();
    let query = decoded.into_query(3, Some(12)).unwrap();
    assert_eq!(query.text.as_deref(), Some("  Lato  "));
    assert_eq!(query.scope, QueryScope::All);
    assert_eq!(query.offset, 3);
    assert_eq!(query.limit, Some(12));
    assert_eq!(query.facets.categories, facets.categories);
    assert_eq!(query.facets.scripts, vec!["Han", "Latin"]);
    assert_eq!(query.facets.licenses, facets.licenses);
    assert_eq!(query.facets.foundries, facets.foundries);
    assert_eq!(query.facets.weights, facets.weights);
    assert_eq!(
        query.facets.widths,
        vec![FontWidth::CONDENSED, FontWidth::NORMAL]
    );
    assert_eq!(query.facets.features, facets.features);
    assert_eq!(query.facets.states, facets.states);
    assert!(query.facets.multiple_variants);

    let local = FacetFilter {
        roots: vec![LibraryRootKey([7; 16])],
        ..Default::default()
    };
    assert!(matches!(
        SavedFontQuery::from_filter(None, local),
        Err(QueryError::NonPortableRootFilter)
    ));
    assert!(matches!(
        SavedFontQuery {
            widths: vec![0],
            ..Default::default()
        }
        .into_query(0, None),
        Err(QueryError::InvalidSavedWidth(0))
    ));
    assert!(matches!(
        SavedFontQuery {
            weights: vec![f32::NAN],
            ..Default::default()
        }
        .into_query(0, None),
        Err(QueryError::InvalidSavedWeight)
    ));
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

#[test]
fn system_font_filter_applies_before_counts_and_pagination_in_every_scope() {
    let mut c = catalog();
    let mut system_faces = BTreeSet::new();
    for family in &mut c.families {
        for face in &mut family.faces {
            if family.display_name.as_deref() == Some("Source Serif 4")
                || face.metadata.postscript_name.as_deref() == Some("Lato-Regular")
            {
                system_faces.insert(face.id);
                face.sources = vec![FontSource::local_file(
                    "/System/Library/Fonts/Example.ttf",
                    0,
                    1,
                    None,
                )];
            }
        }
    }
    assert!(!system_faces.is_empty());
    let identities: Vec<_> = c
        .families
        .iter()
        .flat_map(|f| f.faces.iter().map(|f| f.identity_id))
        .collect();
    let collection = CollectionId::from_bytes([9; 16]);
    let state = LibraryStateSnapshot {
        favorites: identities.clone(),
        recent: identities
            .iter()
            .map(|id| RecentFont {
                identity_id: *id,
                last_accessed_at_ns: 1,
            })
            .collect(),
        collections: vec![CollectionMembers {
            collection_id: collection,
            identities,
        }],
        ..Default::default()
    };
    let index = FontQueryIndex::build(&c, &state).unwrap();
    for scope in [
        QueryScope::All,
        QueryScope::Favorites,
        QueryScope::Recent,
        QueryScope::Collection(collection),
    ] {
        let result = index
            .query(&FontQuery {
                scope: scope.clone(),
                facets: FacetFilter {
                    hide_system_fonts: true,
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap();
        let expected = c
            .families
            .iter()
            .filter(|family| {
                family
                    .faces
                    .iter()
                    .any(|face| !cfg!(target_os = "macos") || !system_faces.contains(&face.id))
            })
            .count();
        assert_eq!(result.total_matches, expected);
        assert!(result
            .families
            .iter()
            .flat_map(|family| &family.matched_face_ids)
            .all(|id| !cfg!(target_os = "macos") || !system_faces.contains(id)));
        let page = index
            .query(&FontQuery {
                scope,
                facets: FacetFilter {
                    hide_system_fonts: true,
                    ..Default::default()
                },
                offset: 1,
                limit: Some(1),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total_matches, result.total_matches);
        assert_eq!(page.families, result.families[1..2]);
        assert_eq!(page.facet_summary, result.facet_summary);
    }
}

#[test]
fn system_font_filter_preserves_user_copies_cloud_faces_and_saved_state() {
    let mut c = catalog();
    let face = &mut c.families[0].faces[0];
    face.sources = vec![
        FontSource::local_file("/System/Library/Fonts/Example.ttf", 0, 1, None),
        FontSource::local_file("/Library/Fonts/Example.ttf", 0, 1, None),
    ];
    assert!(!is_macos_system_font(face));
    face.sources.clear();
    assert!(!is_macos_system_font(face));
    face.sources = vec![FontSource::local_file(
        "/System/LibraryExtra/Fonts/Example.ttf",
        0,
        1,
        None,
    )];
    assert!(!is_macos_system_font(face));
    let saved = SavedFontQuery::from_filter(
        None,
        FacetFilter {
            hide_system_fonts: true,
            ..Default::default()
        },
    )
    .unwrap();
    let json = serde_json::to_string(&saved).unwrap();
    let restored: SavedFontQuery = serde_json::from_str(&json).unwrap();
    assert!(
        restored
            .into_query(0, None)
            .unwrap()
            .facets
            .hide_system_fonts
    );
    let legacy: SavedFontQuery = serde_json::from_str("{}").unwrap();
    assert!(!legacy.hide_system_fonts);
}

#[test]
fn alphabet_sort_index_and_random_pages_share_filtered_order() {
    let mut c = catalog();
    let template = c.families[0].clone();
    c.families.clear();
    for i in 0u32..1043 {
        let mut family = template.clone();
        let mut bytes = [0u8; 16];
        bytes[..4].copy_from_slice(&i.to_be_bytes());
        family.id = FontFamilyId::from_bytes(bytes);
        family.display_name = Some(format!(
            "{} {i:04}",
            if i < 40 {
                "123"
            } else if i < 1000 {
                "阿里"
            } else {
                "思源"
            }
        ));
        family.faces.truncate(1);
        let face = &mut family.faces[0];
        face.family_id = family.id;
        face.id = FontFaceId::from_bytes(bytes);
        face.identity_id = FontIdentityId::from_bytes(bytes);
        c.families.push(family);
    }
    let mut state = LibraryStateSnapshot::default();
    state.favorites = c
        .families
        .iter()
        .step_by(2)
        .map(|family| family.faces[0].identity_id)
        .collect();
    let index = FontQueryIndex::build(&c, &state).unwrap();
    for scope in [QueryScope::All, QueryScope::Favorites] {
        let all = index
            .query(&FontQuery {
                scope: scope.clone(),
                sort: QuerySort::Alphabet,
                ..Default::default()
            })
            .unwrap();
        for offset in [0, 40, 480, 1000, 1040] {
            let page = index
                .query(&FontQuery {
                    scope: scope.clone(),
                    sort: QuerySort::Alphabet,
                    offset,
                    limit: Some(40),
                    ..Default::default()
                })
                .unwrap();
            assert_eq!(page.total_matches, all.total_matches);
            assert_eq!(
                page.families,
                all.families
                    .iter()
                    .skip(offset)
                    .take(40)
                    .cloned()
                    .collect::<Vec<_>>()
            );
        }
        assert_eq!(index.alphabet_group(all.families[0].family_id), "#");
        assert_eq!(
            index.alphabet_group(all.families.last().unwrap().family_id),
            "S"
        );
    }
}
