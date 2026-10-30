use pinyin::ToPinyin;

// 字母分组与完整拼音键共用缓存，跨平台排序保持一致。
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct AlphabetName {
    pub group: String,
    key: String,
    original: String,
}

impl AlphabetName {
    pub fn new(name: &str) -> Self {
        let original = name.trim().to_owned();
        let key: String = original
            .chars()
            .map(|ch| {
                ch.to_pinyin()
                    .map(|py| py.plain().to_owned())
                    .unwrap_or_else(|| ch.to_lowercase().collect())
            })
            .collect();
        let group = key
            .chars()
            .next()
            .filter(char::is_ascii_alphabetic)
            .map(|ch| ch.to_ascii_uppercase().to_string())
            .unwrap_or_else(|| "#".to_owned());
        Self {
            group,
            key,
            original,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_names_have_stable_groups_and_keys() {
        let cases = [
            (" 阿里", "A"),
            ("思源黑体", "S"),
            ("思源黑體", "S"),
            ("Arial", "A"),
            ("arial", "A"),
            ("123", "#"),
            (".Font", "#"),
            ("", "#"),
            ("かな", "#"),
        ];
        for (name, group) in cases {
            assert_eq!(AlphabetName::new(name).group, group);
        }
        assert_eq!(
            AlphabetName::new("Arial").key,
            AlphabetName::new("arial").key
        );
        assert_eq!(AlphabetName::new(" 思源 ").key, "siyuan");
        assert_eq!(AlphabetName::new("重").key, "zhong");
        assert!(AlphabetName::new("#") < AlphabetName::new("阿里"));
        assert!(AlphabetName::new("阿里") < AlphabetName::new("Arial"));
    }
}
