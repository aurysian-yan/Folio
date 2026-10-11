//! 跨平台字符表会话与离屏字形渲染。

mod bitmap;
mod glyph;
mod session;
pub use glyph::{GlyphImage, RenderRequest};
pub use session::{
    CharacterMapService, OpenCharacterMap, OpenCharacterMapResult, QueryCharacterMap,
    RenderCharacterMapError,
};
