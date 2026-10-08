//! 存放位置与传输偏好；不参与跨设备智慧收藏夹规则。

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontLocation {
    pub state: String,
    pub local_available: bool,
    pub cloud_available: bool,
    pub cloud_confirmed_at_ms: Option<u64>,
    pub files: Vec<FontFileLocation>,
    pub metadata_complete: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamilyLocation {
    pub state: String,
    pub local_face_count: u64,
    pub total_face_count: u64,
}

impl FontFamilyLocation {
    pub fn from_locations<'a>(locations: impl IntoIterator<Item = &'a FontLocation>) -> Self {
        let mut result = Self::default();
        let mut cloud_count = 0;
        let mut pending_count = 0;
        for location in locations {
            result.total_face_count += 1;
            result.local_face_count += u64::from(location.local_available);
            cloud_count += u64::from(location.cloud_available);
            pending_count += u64::from(location.state == "pendingUpload");
        }
        result.state =
            if result.local_face_count > 0 && result.local_face_count < result.total_face_count {
                "partial"
            } else if result.local_face_count > 0 && cloud_count > 0 {
                "both"
            } else if cloud_count > 0 {
                "cloudOnly"
            } else if pending_count > 0 {
                "pendingUpload"
            } else {
                "excluded"
            }
            .to_owned();
        result
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFileLocation {
    pub fingerprint: String,
    pub filename: String,
    pub file_size: u64,
    pub face_index: u32,
    pub local_sources: Vec<LocalFontLocation>,
    pub cloud_available: bool,
    pub upload_excluded: bool,
    pub download_policy: String,
    pub transfer_action: Option<String>,
    pub transfer_status: Option<String>,
    pub transfer_error: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFontLocation {
    pub path: String,
    pub kind: String,
    pub preview_source: bool,
}

impl FontLocation {
    pub fn matches(&self, filter: &str, fingerprint: Option<&str>) -> bool {
        if fingerprint.is_some_and(|value| !self.files.iter().any(|file| file.fingerprint == value))
        {
            return false;
        }
        match filter {
            "local" => self.local_available,
            "cloudOnly" => self.cloud_available && !self.local_available,
            "both" => self.cloud_available && self.local_available,
            "pendingUpload" => self.files.iter().any(|file| {
                !file.cloud_available
                    && !file.upload_excluded
                    && file
                        .local_sources
                        .iter()
                        .any(|source| source.kind == "managed")
            }),
            "excluded" => {
                self.local_available
                    && self.files.iter().any(|file| {
                        !file.cloud_available
                            && (file.upload_excluded
                                || !file
                                    .local_sources
                                    .iter()
                                    .any(|source| source.kind == "managed"))
                    })
            }
            _ => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn family_counts_each_face_once_and_keeps_cloud_only_normal() {
        let local = FontLocation {
            state: "both".into(),
            local_available: true,
            cloud_available: true,
            ..Default::default()
        };
        let cloud = FontLocation {
            state: "cloudOnly".into(),
            cloud_available: true,
            ..Default::default()
        };
        let family = FontFamilyLocation::from_locations([&local, &cloud, &cloud]);
        assert_eq!(family.state, "partial");
        assert_eq!((family.local_face_count, family.total_face_count), (1, 3));
        assert_eq!(
            FontFamilyLocation::from_locations([&cloud, &cloud]).state,
            "cloudOnly"
        );
        assert_eq!(FontFamilyLocation::from_locations([&local]).state, "both");
    }

    #[test]
    fn pausing_upload_does_not_hide_existing_cloud_copy() {
        let location = FontLocation {
            state: "both".into(),
            local_available: true,
            cloud_available: true,
            files: vec![FontFileLocation {
                cloud_available: true,
                upload_excluded: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(location.matches("both", None));
        assert!(!location.matches("excluded", None));
    }
}
