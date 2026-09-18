//! Owned domain types for face attributes.
//!
//! These types deliberately do not expose `skrifa` or `read-fonts` types in
//! Folio's public API.

use serde::Serialize;

use crate::names::LocalizedName;

/// Visual weight class of a face.
///
/// The value follows the OpenType `usWeightClass` scale (1..=1000, where
/// 400 is regular and 700 is bold). Variable fonts may declare values
/// outside that range; Folio preserves the declared value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FontWeight(f32);

impl FontWeight {
    /// Thin (100).
    pub const THIN: Self = Self(100.0);
    /// Extra light (200).
    pub const EXTRA_LIGHT: Self = Self(200.0);
    /// Light (300).
    pub const LIGHT: Self = Self(300.0);
    /// Regular (400).
    pub const REGULAR: Self = Self(400.0);
    /// Medium (500).
    pub const MEDIUM: Self = Self(500.0);
    /// Semi bold (600).
    pub const SEMI_BOLD: Self = Self(600.0);
    /// Bold (700).
    pub const BOLD: Self = Self(700.0);
    /// Extra bold (800).
    pub const EXTRA_BOLD: Self = Self(800.0);
    /// Black (900).
    pub const BLACK: Self = Self(900.0);

    /// Creates a weight from a numeric value.
    pub fn new(value: f32) -> Self {
        if value.is_finite() {
            Self(value)
        } else {
            Self::REGULAR
        }
    }

    /// Creates a weight from an OpenType `usWeightClass` value.
    ///
    /// Returns `None` for the invalid zero class. Values above 1000 are
    /// preserved because some fonts declare them.
    pub fn from_os2_class(class: u16) -> Option<Self> {
        if class == 0 {
            None
        } else {
            Some(Self(class as f32))
        }
    }

    /// Numeric weight value.
    pub fn value(self) -> f32 {
        self.0
    }
}

impl std::fmt::Display for FontWeight {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.0.fract() == 0.0 {
            write!(f, "{}", self.0 as i64)
        } else {
            write!(f, "{}", self.0)
        }
    }
}

impl Serialize for FontWeight {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_f32(self.0)
    }
}

/// Relative width (stretch) of a face as a ratio where 1.0 is normal.
///
/// Derived from OpenType `usWidthClass` (1..=9).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FontWidth(f32);

impl FontWidth {
    /// Ultra condensed (`usWidthClass` 1, ratio 0.5).
    pub const ULTRA_CONDENSED: Self = Self(0.5);
    /// Extra condensed (2, 0.625).
    pub const EXTRA_CONDENSED: Self = Self(0.625);
    /// Condensed (3, 0.75).
    pub const CONDENSED: Self = Self(0.75);
    /// Semi condensed (4, 0.875).
    pub const SEMI_CONDENSED: Self = Self(0.875);
    /// Normal (5, 1.0).
    pub const NORMAL: Self = Self(1.0);
    /// Semi expanded (6, 1.125).
    pub const SEMI_EXPANDED: Self = Self(1.125);
    /// Expanded (7, 1.25).
    pub const EXPANDED: Self = Self(1.25);
    /// Extra expanded (8, 1.5).
    pub const EXTRA_EXPANDED: Self = Self(1.5);
    /// Ultra expanded (9, 2.0).
    pub const ULTRA_EXPANDED: Self = Self(2.0);

    /// Creates a width from an OpenType `usWidthClass` value.
    pub fn from_width_class(class: u16) -> Option<Self> {
        match class {
            1 => Some(Self::ULTRA_CONDENSED),
            2 => Some(Self::EXTRA_CONDENSED),
            3 => Some(Self::CONDENSED),
            4 => Some(Self::SEMI_CONDENSED),
            5 => Some(Self::NORMAL),
            6 => Some(Self::SEMI_EXPANDED),
            7 => Some(Self::EXPANDED),
            8 => Some(Self::EXTRA_EXPANDED),
            9 => Some(Self::ULTRA_EXPANDED),
            _ => None,
        }
    }

    /// Numeric width ratio.
    pub fn ratio(self) -> f32 {
        self.0
    }

    /// 归一化宽度对应的 usWidthClass（1..=9），用于持久化往返。
    pub fn class(self) -> u16 {
        let bits = self.0.to_bits();
        let classes: [(f32, u16); 9] = [
            (Self::ULTRA_CONDENSED.0, 1),
            (Self::EXTRA_CONDENSED.0, 2),
            (Self::CONDENSED.0, 3),
            (Self::SEMI_CONDENSED.0, 4),
            (Self::NORMAL.0, 5),
            (Self::SEMI_EXPANDED.0, 6),
            (Self::EXPANDED.0, 7),
            (Self::EXTRA_EXPANDED.0, 8),
            (Self::ULTRA_EXPANDED.0, 9),
        ];
        classes
            .iter()
            .find(|(ratio, _)| ratio.to_bits() == bits)
            .map(|(_, class)| *class)
            .unwrap_or(5)
    }
}

impl Serialize for FontWidth {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_f32(self.0)
    }
}

/// Style / slant of a face.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FontStyle {
    /// Upright style.
    #[default]
    Normal,
    /// Italic style.
    Italic,
    /// Oblique style, optionally with the slant angle in degrees.
    Oblique {
        /// Slant angle in degrees, counter-clockwise from vertical.
        angle: Option<f32>,
    },
}

/// Version information declared by the font itself.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct FontVersion {
    /// `head.fontRevision` as a float, e.g. `2.001`.
    pub head_revision: Option<f64>,
    /// Human readable version string (name ID 5), e.g. `Version 2.001`.
    pub version_string: Option<String>,
}

/// A variation axis declared in the `fvar` table.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VariableAxis {
    /// Four character axis tag, e.g. `wght`.
    pub tag: String,
    /// Minimum value.
    pub min_value: f32,
    /// Default value.
    pub default_value: f32,
    /// Maximum value.
    pub max_value: f32,
    /// Whether the axis is hidden from user interfaces.
    pub hidden: bool,
    /// Preferred axis name.
    pub name: Option<String>,
    /// All decoded localized axis names.
    pub localized_names: Vec<LocalizedName>,
}

/// One coordinate of a named variation instance.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AxisCoordinate {
    /// Tag of the axis this coordinate belongs to.
    pub axis_tag: String,
    /// User space coordinate value.
    pub value: f32,
}

/// A named instance declared in the `fvar` table.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct NamedInstance {
    /// Preferred subfamily name of the instance.
    pub subfamily_name: Option<String>,
    /// PostScript name of the instance, when declared.
    pub postscript_name: Option<String>,
    /// Coordinates in axis order.
    pub coordinates: Vec<AxisCoordinate>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weight_class_validation() {
        assert_eq!(FontWeight::from_os2_class(0), None);
        assert_eq!(FontWeight::from_os2_class(400), Some(FontWeight::REGULAR));
        assert_eq!(
            FontWeight::from_os2_class(1000).map(FontWeight::value),
            Some(1000.0)
        );
    }

    #[test]
    fn width_class_mapping() {
        assert_eq!(FontWidth::from_width_class(0), None);
        assert_eq!(FontWidth::from_width_class(5), Some(FontWidth::NORMAL));
        assert_eq!(
            FontWidth::from_width_class(9).map(FontWidth::ratio),
            Some(2.0)
        );
    }
}
