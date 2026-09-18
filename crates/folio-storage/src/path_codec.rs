//! 平台感知的无损路径存储。
//!
//! `PathBuf` 在任何平台都不保证是合法 UTF-8，因此路径不会只保存为有损
//! 字符串后再用于访问文件。每条路径存储为：
//!
//! * 平台标记（`unix` / `windows`）；
//! * 平台原生无损字节；
//! * 单独的有损显示字符串，供 UI 与诊断使用。
//!
//! Unix 保存原始 `OsStr` 字节；Windows 保存 UTF-16 code unit 的小端字节。
//! 平台与主机一致时解码无损；数据库为设备本地，跨平台复制不受支持，
//! 异平台记录返回错误，禁止使用显示字符串访问文件系统。

use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::ffi::{OsStrExt, OsStringExt};
#[cfg(windows)]
use std::os::windows::ffi::{OsStrExt, OsStringExt};

/// 存储路径所用的平台标记。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PathPlatform {
    /// 类 Unix（`unix`）。
    Unix,
    /// Windows（`windows`）。
    Windows,
}

impl PathPlatform {
    /// 当前进程所在平台。
    pub fn current() -> Self {
        #[cfg(windows)]
        {
            PathPlatform::Windows
        }
        #[cfg(not(windows))]
        {
            PathPlatform::Unix
        }
    }

    /// 稳定的数据库标记。
    pub fn as_str(self) -> &'static str {
        match self {
            PathPlatform::Unix => "unix",
            PathPlatform::Windows => "windows",
        }
    }

    /// 解析数据库标记。
    pub fn parse(value: &str) -> Result<Self, PathCodecError> {
        match value {
            "unix" => Ok(PathPlatform::Unix),
            "windows" => Ok(PathPlatform::Windows),
            other => Err(PathCodecError::UnknownPlatform(other.to_owned())),
        }
    }
}

/// 存储路径编码/解码失败。
#[derive(Debug, thiserror::Error)]
pub enum PathCodecError {
    /// 异平台路径不能用于本机文件访问。
    #[error("stored path belongs to another platform")]
    ForeignPlatform,
    /// 路径为空或包含空字符。
    #[error("invalid empty or NUL-containing path")]
    InvalidPath,

    /// 存储的平台标记无法识别。
    #[error("unknown path platform tag `{0}`")]
    UnknownPlatform(String),
    /// Windows 字节载荷长度不为偶数，无法组成 UTF-16 code unit。
    #[error("invalid UTF-16 path payload")]
    InvalidUtf16,
}

/// 编码为存储形式的路径。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedPath {
    /// 字节所属平台。
    pub platform: PathPlatform,
    /// 平台原生无损字节。
    pub bytes: Vec<u8>,
    /// 供 UI 与诊断使用的有损字符串。
    pub display: String,
}

impl EncodedPath {
    /// 同一平台内的稳定键所用的原始字节。
    pub fn key(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

/// 解码后的路径及其保真度。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedPath {
    /// 重建路径；`lossless` 为 true 时与原文完全一致。
    pub path: PathBuf,
    /// 在本机是否可精确往返。
    pub lossless: bool,
}

/// 使用主机平台的无损表示编码路径。
pub fn encode_path(path: &Path) -> EncodedPath {
    let platform = PathPlatform::current();
    let display = path.to_string_lossy().into_owned();
    let bytes = match platform {
        PathPlatform::Unix => encode_unix(path),
        PathPlatform::Windows => encode_windows(path),
    };
    EncodedPath {
        platform,
        bytes,
        display,
    }
}

/// 在主机上解码存储路径。
///
/// 异平台、空路径或含空字符的路径返回错误，显示字符串不参与解码。
pub fn decode_path(
    platform: PathPlatform,
    bytes: &[u8],
    _display: &str,
) -> Result<DecodedPath, PathCodecError> {
    if bytes.is_empty()
        || match platform {
            PathPlatform::Unix => bytes.contains(&0),
            PathPlatform::Windows => wide_from_bytes(bytes)?.contains(&0),
        }
    {
        return Err(PathCodecError::InvalidPath);
    }
    if platform == PathPlatform::current() {
        match platform {
            PathPlatform::Unix => Ok(DecodedPath {
                path: decode_unix(bytes),
                lossless: true,
            }),
            PathPlatform::Windows => {
                let wide = wide_from_bytes(bytes)?;
                Ok(DecodedPath {
                    path: decode_windows(&wide),
                    lossless: true,
                })
            }
        }
    } else {
        Err(PathCodecError::ForeignPlatform)
    }
}

#[cfg(unix)]
fn encode_unix(path: &Path) -> Vec<u8> {
    path.as_os_str().as_bytes().to_vec()
}

#[cfg(not(unix))]
fn encode_unix(path: &Path) -> Vec<u8> {
    path.to_string_lossy().into_owned().into_bytes()
}

#[cfg(unix)]
fn decode_unix(bytes: &[u8]) -> PathBuf {
    PathBuf::from(std::ffi::OsString::from_vec(bytes.to_vec()))
}

#[cfg(not(unix))]
fn decode_unix(bytes: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(bytes).into_owned())
}

#[cfg(windows)]
fn encode_windows(path: &Path) -> Vec<u8> {
    bytes_from_wide(&path.as_os_str().encode_wide().collect::<Vec<_>>())
}

#[cfg(not(windows))]
fn encode_windows(path: &Path) -> Vec<u8> {
    bytes_from_wide(&path.to_string_lossy().encode_utf16().collect::<Vec<_>>())
}

#[cfg(windows)]
fn decode_windows(wide: &[u16]) -> PathBuf {
    PathBuf::from(std::ffi::OsString::from_wide(wide))
}

#[cfg(not(windows))]
fn decode_windows(wide: &[u16]) -> PathBuf {
    PathBuf::from(String::from_utf16_lossy(wide))
}

/// 将 UTF-16 code unit 编码为小端字节。
pub(crate) fn bytes_from_wide(wide: &[u16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(wide.len() * 2);
    for unit in wide {
        out.extend_from_slice(&unit.to_le_bytes());
    }
    out
}

/// 将小端字节解码为 UTF-16 code unit。
pub(crate) fn wide_from_bytes(bytes: &[u8]) -> Result<Vec<u16>, PathCodecError> {
    if bytes.len() % 2 != 0 {
        return Err(PathCodecError::InvalidUtf16);
    }
    Ok(bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_tags_round_trip() {
        assert_eq!(PathPlatform::parse("unix").unwrap(), PathPlatform::Unix);
        assert_eq!(
            PathPlatform::parse("windows").unwrap(),
            PathPlatform::Windows
        );
        assert!(matches!(
            PathPlatform::parse("plan9"),
            Err(PathCodecError::UnknownPlatform(_))
        ));
    }

    #[test]
    fn utf16_byte_codec_is_exact() {
        let wide = vec![0x0041u16, 0x4E2D, 0xD83D, 0xDE00];
        let bytes = bytes_from_wide(&wide);
        assert_eq!(bytes.len(), 8);
        assert_eq!(wide_from_bytes(&bytes).unwrap(), wide);
    }

    #[test]
    fn utf16_byte_codec_rejects_odd_length() {
        assert!(matches!(
            wide_from_bytes(&[0x41, 0x00, 0x42]),
            Err(PathCodecError::InvalidUtf16)
        ));
    }

    #[test]
    #[cfg(unix)]
    fn unix_round_trip_preserves_non_utf8() {
        let raw = vec![
            b'/', b't', b'm', b'p', b'/', 0xff, 0xfe, b'f', b'o', b'n', b't',
        ];
        let path = PathBuf::from(std::ffi::OsString::from_vec(raw.clone()));
        let encoded = encode_path(&path);
        assert_eq!(encoded.platform, PathPlatform::Unix);
        assert_eq!(encoded.bytes, raw);
        let decoded = decode_path(encoded.platform, &encoded.bytes, &encoded.display).unwrap();
        assert!(decoded.lossless);
        assert_eq!(decoded.path, path);
    }

    #[test]
    fn foreign_platform_decode_never_uses_display() {
        let foreign = match PathPlatform::current() {
            PathPlatform::Unix => PathPlatform::Windows,
            PathPlatform::Windows => PathPlatform::Unix,
        };
        assert!(matches!(
            decode_path(foreign, &[0xff, 0xfe], "C:\\Fonts\\x"),
            Err(PathCodecError::ForeignPlatform)
        ));
    }
}
