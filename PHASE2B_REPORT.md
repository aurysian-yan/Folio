# Folio — Phase 2B 验证报告

完成日期：2026-09-19（Asia/Shanghai）。

**READY FOR PHASE 3**

本次先提交 Phase 2A：`09e46e6 feat: 完成字体库持久化与增量刷新`。
该提交前 build、fmt、clippy、149 项测试均实际执行通过。随后只实现 Phase 2B；
2B 改动留在工作区，未进入平台实现。契约见
[architecture.md Part III](docs/architecture.md#part-iii--library-state--queryphase-2b)。

## 1. Repository changes / 新模块

- 新增 `folio-core/src/library.rs`：共享持久状态 DTO、CollectionId、来源查询键、
  名称规范化与 Identity resolution。
- 新增 `folio-core/src/metadata.rs`：许可、厂商、嵌入权限、脚本、分类与特征。
- 扩展 name 收集与 FaceMetadata；不改变 Identity / Revision / Face / Family ID 算法。
- 新增 `folio-storage/src/state.rs`，增加 schema v2 和 payload v2。
- 新增 `folio-query`：可重建纯内存索引、查询 DTO、健康分析、测试与冒烟示例。
- 更新 README / architecture，增加本报告和 v1 schema / payload 测试 fixture。
- 前端、Tauri、React、HeroUI、Tailwind、package.json、pnpm lock 均未修改。

## 2. Dependencies added

| 依赖 | 用途 | 说明 |
| --- | --- | --- |
| `unicode-script = 0.5.8` | Unicode Script 属性 | 使用维护的 Unicode 数据，避免手写整张表 |
| `getrandom = 0.4.3` | 128 位 Collection ID 随机源 | 复用 lockfile 原有版本；未增加 UUID 框架 |
| `folio-query` | 查询 crate | 运行时仅依赖 core、Serde、thiserror；storage 仅是 dev-dependency |

未升级既有 Fontations、SQLite、bincode 或前端依赖。所有最终版本记录于 Cargo.lock。

## 3. Schema v2 / Migration strategy

新增 `collections`、`collection_members`、`favorites`、`recent_fonts`。
迁移采用现有版本循环与事务，每一步建表、索引与版本提升原子提交。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| fresh DB → v2 | PASS | `migration::empty_database_migrates_to_current` |
| 真实 v1 DB → v2 | PASS | `migration_v2::real_v1_schema_preserves_roots_cache_and_rebuilds_old_payload` |
| v1 roots 与原 cache blob 保留 | PASS | 同上，逐值检查 root ID 和原 payload |
| v2 reopen no-op | PASS | migration / migration_v2 测试 |
| future schema reject | PASS | 原 migration + audit 测试 |
| v1→v2 中途失败 rollback | PASS | `failed_v1_to_v2_rolls_back_tables_and_version` |

v1 fixture 是 Phase 2A 实现实际产生的 schema 与 Lato 元数据 blob，不是 v2
数据库修改 user_version。来源、SHA-256、用途和许可关联记录于
`crates/folio-storage/tests/fixtures/README.md`。

## 4. Cache payload version strategy

`CACHE_PAYLOAD_VERSION = 2`，新增的 FontEnrichment 进入 Folio 自有 DTO。
先检查版本再尝试 bincode 解码；严格加载返回 CacheIncompatible。
已知 v1 的重建提示与 CacheCorrupt 分开，实际测试确认旧 blob 不计为损坏。
迁移本身不动 source_files；可读源在 refresh 时重解析并写 v2，离线旧载荷
原行保留但不贡献无法解码的 Face。durable state 不受载荷版本影响。

**PASS**：真实 v1 blob → v2 runtime → 重建 → 下一次 metadata hit。
原有 payload 大小限制、解码边界、hash 绑定、损坏隔离测试继续通过。

## 5. Collections / Favorites / Recent

Collection 使用随机不透明 16 字节 ID，与名称、路径、rowid 无关；重命名稳定。
原样保存用户显示名称，以 NFC + Unicode lowercase + NFC + 空白折叠作为唯一键。
不移除重音、标点，也不进行兼容字符合并。所有 membership 保存 FontIdentityId。

API 覆盖 create / rename / delete / list、成员单个或批量 add / remove / list；
重复 membership 幂等。删除集合仅级联删除成员，不影响 favorites/recent/cache。

Favorites 提供 set / is / list / bulk_set；布尔值由记录存在性表达。
Recent 提供 record / list(limit) / clear；同一 identity 更新最新纳秒时间，
不增加访问次数。只有显式 record 产生 Recent，搜索和 refresh 无副作用。

Bulk membership / favorite 在一次事务中完成；注入后续写入失败验证前序修改
及集合时间完整回滚。时间使用 checked UTC Unix 纳秒，无法表示时 typed error，
同一对象的更新时间不会随系统时钟回拨而倒退。

上述 CRUD、规范化冲突、bulk、幂等、时间、排序、limit、删除边界：**PASS**。

## 6. Unresolved identity behavior

三类用户引用不通过 FK 依赖可重建缓存，未知但合法的 ID 仍可读取。
`resolve_identities` 返回 resolved 状态；受限 Scope 返回全部 unresolved IDs，
不受分页、text/facet 过滤影响。损坏 ID 长度返回 InvalidStoredId，原记录保留。

**PASS**：清空缓存、Rebuild、根离线及返回、有效同 Identity 修订、来源移动、
删除根目录和真正更换 Identity 时，用户状态保留且不会按名称误迁移。

需要明确区分：resolved 是“当前 Catalog 有该 Identity”，不是“当前文件在线”。
为保留 Phase 2A offline contract，离线时已有陈旧缓存仍可 resolve；清空缓存后
离线目录为空，引用变为 unresolved；恢复文件后重新 resolve。此区分已写入
共享 DTO 注释、架构与测试，未改变原离线保留缓存行为。

## 7. Metadata additions / License / Embedding / Foundry

保留 name IDs **0 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14** 的 localized records
及合理首选值。原记录包含语言和原始 locale；没有仅保留英文。

LicenseInfo：description、URL、OFL / Apache2 / MIT / Custom / Unknown。
使用完整标题、标准 URL 或明确 MIT 授权片段；多个种类同时出现保守归 Custom。
不提供商业使用保证，不用 fsType 推断许可。

EmbeddingPermissions 独立保留 raw flags / OS2 version，解释 Installable、
Restricted、PreviewAndPrint、Editable、Invalid、No Subsetting、Bitmap Only；
版本差异依照 [OpenType OS/2](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype)。

FoundryInfo 分别保存 manufacturer、designer、vendor_id、vendor_url、designer_url。
Manufacturer 用作可读 Facet，Vendor ID 是辅助信息，无硬编码 vendor 数据库。

**PASS**：`enrichment` 中名称、许可保守识别、OS/2 权限、vendor/厂商/设计师
测试；其中名称和权限走生成合法表与现有合法字体二进制解析。

## 8. Script / Category / Feature models

ScriptCoverage 根据 Fontations 选出的 cmap mappings，排除 glyph 0，使用
unicode-script 聚合技术脚本名及实际 codepoint_count。OS/2 Unicode / Code Page
bits 独立保留，不充当实测覆盖。语言名称元数据不用于 Script Facet。

**PASS**：生成 cmap 二进制覆盖 Latin、Cyrillic、Greek、Han、Hiragana、Katakana、
Hangul、Arabic、Hebrew、Thai、Devanagari；并验证缺失 glyph 不算覆盖、中文
name record 不自动产生 Han coverage。不推断自然语言支持。

FontCategory 从 post fixed-pitch / PANOSE / OS2 family class 提取，保留 Unknown。
**PASS**：结构化分类、Monospace 与 Unknown 回退通过二进制解析验证。

Feature 支持 Variable、Italic、Oblique、Monospace、Color 与 GSUB / GPOS
feature tags；保留 axes、named instances，不执行 shaping。
**PASS**：实际 Lato GSUB/GPOS 的 liga / kern 提取、排序去重及缺表行为，
现有 variable 回归、Query Feature Facet 测试。

## 9. Query architecture / Search

输入为 Catalog + LibraryStateSnapshot，构建平台无关 FontQueryIndex。
索引可重建；update_state 只替换轻量状态，不重新规范化字体文本。Query 无 SQL、
无字体文件读取，不依赖 SQLite FTS 编译选项。

搜索涵盖 Family 显示名称及本地化名称、subfamily / localized subfamily、Full
Name、PostScript、basename、manufacturer、designer、vendor ID、license kind /
description 与 description。完整绝对路径不进入检索。

规范化采用 NFC / Unicode lowercase / whitespace collapse；原始数据不改写。
多 token 全部必须匹配同一个 Face，允许匹配不同字段。只支持 exact / prefix /
substring，没有 fuzzy、音译或复杂 query language。

Ranking 对完整 Family exact / prefix / substring 给优先分，随后按字段权重与
匹配形式打分；Family 分数取匹配 Face 最大值。平局按规范化名称和 FamilyId。
默认 text → Relevance，空 query → Name，Recent scope → 最近时间降序。

**PASS**：所有指定搜索字段、多 token、Unicode 大小写/规范等价、排序和重复
序列化稳定性测试。具体权重记录于 architecture §35。

## 10. Facet model / OR–AND / Same-face / Scope

独立 Facet groups：Category、Script、License、Foundry、Weight、Width、Feature、
Root、State。Weight/Width 复用 domain 类型，不丢失 numeric weight。
FoundryKey 由规范化 manufacturer 构成，原 display label 独立返回。

**同 Facet OR，跨 Facet AND，跨 Facet 必须同一个 Face 满足。**
返回 FamilyMatch，同时返回实际 matched FaceId / IdentityId、分数和 Recent 时间。
Scope：All / Favorites / Recent / Collection。未知 Collection 有 typed error，
合法空 scope 或无搜索结果不是错误。支持稳定 offset/limit 和 total_matches。

**PASS**：Sans OR Monospace、category + script + license、Bold Normal 与
Regular Italic 不拼凑匹配、加入 Bold Italic 后匹配、Scope 与 text/facet 组合、
Recent 排序、空目录、状态更新及构建错误。

## 11. Source-root filtering

Storage 快照用缓存的 FaceId 构建 root memberships，query 使用独立
LibraryRootKey（由 LibraryRootId.into() 转换）；不在 query 引入平台路径编码。
按具体 Face 归属，不用 Identity 的其他修订串配来源；多个 roots 取 OR。

**PASS**：真实嵌套重叠根目录 → storage snapshot → query，和内存多 root 测试；
只返回一个 Family/Face，不把同一路径的重叠归属误计为 DuplicateSources。

## 12. Duplicate / Multiple revision / Metadata conflict

纯 Rust CatalogHealth 按 logical Identity 聚合：

- DuplicateSources：同 materialized revision 对应多个实际来源。
- MultipleRevisions：同 Identity 有多个 RevisionId。
- MetadataConflict：不同修订的非空 family/subfamily/manufacturer 规范化值冲突。

缺失字段或正常 font_version 更新不视为冲突，不改动身份算法、不自动修复。
Health 可直接映射 State Facet。

**PASS**：重复来源、并存修订、制造 manufacturer 冲突和普通版本更新不误报；
Phase 2A 的真实 binary copy / valid revision 回归同样继续通过。

## 13. Facet summary

统计过滤后、分页前的匹配结果，以 **Family count** 计数。一个家族多个匹配
Face 具有同一值时只计一次；只统计真正匹配 Face 的值。稳定有序输出，不实现
复杂 disjunctive faceting。Foundry label 的选择不依赖输入顺序。

**PASS**：同家族去重、多个 roots、分页前计数、输入反序与重复 JSON 一致。

## 14. New test count / Regression / Final verification

新增 **31** 项测试：core metadata 8、storage state 7、migration v2 2、query
semantics 13、storage→query integration 1。

最终实际环境：macOS arm64，rustc 1.94.1，cargo 1.94.1。

| 项目 / 命令 | 结果 |
| --- | --- |
| Phase 1 既有 89 项测试 | PASS |
| Phase 2A 既有 60 项测试 | PASS；仅当前 schema 断言由 1 更新为 2 |
| Phase 2B 新增 31 项测试 | PASS |
| `cargo build --workspace` | PASS |
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS：180 passed，0 failed，0 ignored |
| `git diff --check` | PASS |
| 前端文件差异检查 | PASS：无差异 |
| Phase 3 代码边界检查 | PASS：无平台、UI、激活、FFI、同步实现 |

原 macOS 非 UTF-8 文件系统测试存在其既有 EILSEQ 提前返回，不能把测试框架的
ok 解释为该文件系统场景真实执行通过；见以下 NOT VERIFIED。

## 15. Query smoke results

最终以 release profile 实际运行两组：

```sh
cargo run --release -p folio-query --example query_smoke -- /tmp/folio-phase2b-final-fixtures.sqlite fixtures/fonts
cargo run --release -p folio-query --example query_smoke -- /tmp/folio-phase2b-final-system.sqlite /System/Library/Fonts
```

只使用仓库合法 fixtures 和公开系统字体目录；只报告聚合统计，未复制系统字体
或在报告中列出字体名称。

| 指标 | Fixtures | System Fonts |
| --- | ---: | ---: |
| Faces / Families | 5 / 3 | 786 / 377 |
| Cold issues | 3 | 0 |
| Warm metadata hits | 8 | 369 |
| Warm hash / parse | 0 / 0 | 0 / 0 |
| Index build ms | 0.738 | 22.446 |
| A plain search 家族数 | 1 | 2 |
| B multi-token 家族数 | 1 | 2 |
| C 单 Facet 家族数 | 1 | 188 |
| D 同 Facet 多值家族数 | 2 | 337 |
| E 多 Facet 家族数 | 1 | 39 |
| F Favorites scope 家族数 | 1 | 1 |
| G Collection scope 家族数 | 1 | 1 |
| H 健康条目 / 冲突数 | 0 / 0 | 0 / 0 |
| 实际执行结果 | PASS | PASS |

Fixtures 的 3 个 issues 是已有 2 个不支持的 WOFF/WOFF2 加 1 个故意损坏文件。
普通/多 token 查询根据样本第一张 Face 构造，原始查询文本不在报告中暴露。
真实样本没有发现冲突；冲突正例由可控 query 测试覆盖，不能以零结果证明检测
逻辑已覆盖所有现实冲突。

## 16. 20k performance sanity observations

同一冒烟程序把已解析元数据复制为 **20,000 个 Face / 20,000 个 Family**，
赋予不同 ID 后建立索引。测量包含完整分页前匹配与 Facet summary，不设 timing
pass/fail assertion，不把主机结果当稳定 benchmark。

| 元数据来源 | 建索引 ms | 空查询 ms / matches | 多 token ms / matches | 多 Facet ms / matches |
| --- | ---: | ---: | ---: | ---: |
| Fixtures | 1187.260 | 101.693 / 20000 | 74.125 / 12062 | 64.180 / 16000 |
| System Fonts | 580.034 | 61.806 / 20000 | 28.540 / 428 | 0.376 / 50 |

实际运行：**PASS**。Fixture 许可文本较长、重复元数据较多；token 可以命中不同
字段，数字 token 也可能命中 description 中的数字，因此匹配数不只由 synthetic
family 后缀决定。System 的多 Facet 只匹配 50 个家族，不能与 16000 匹配的
查询做等工作量比较。先前一次并发构建期间也观察到更慢的 3414 ms 建索引 /
297 ms 空查询，说明主机调度与负载影响明显；表格记录最终命令的实测值。

没有发现每查询重 parse / 重 normalization 或明显平方级循环。仍是线性扫描
加有序聚合，长文本和大量 Facet 输出有可见成本；没有承诺固定输入延迟。

## 17. Known limitations / NOT VERIFIED

- **NOT VERIFIED**：Windows/Linux/Android 运行时、Windows 交叉编译，本次未执行；
  不将 Phase 2A 的历史跨平台编译结果冒充本次结果。
- **NOT VERIFIED**：macOS 非 UTF-8 文件系统端到端，原测试遇 EILSEQ 提前返回。
  原有纯路径编解码测试实际通过。
- **NOT VERIFIED**：进程强杀/断电、磁盘故障、并发写入压力、独立第三方审计。
  已验证的是 SQLite 事务错误注入回滚和现有同步操作契约。
- **NOT VERIFIED**：所有可能的字体分类或所有许可文本的语义正确性；当前是
  保守声明识别，Unknown/Custom 是合法结果，不是法律或自然语言支持保证。
- **NOT VERIFIED**：Color 的真实渲染效果。仅记录可读相关表的声明信号。
- cmap 使用 Fontations 所选映射，未实现完整多 subtable union、Script_Extensions、
  variation-selector 覆盖与 OpenType language-system tags。
- Unicode lowercase 不是完整 locale-aware casefold；不会把 ß 自动等同 ss。
- 搜索索引与输出在内存中；无 fuzzy、FTS、复杂增量索引、disjunctive faceting。
- 健康冲突只检查非空 family/subfamily/manufacturer，不是字体修复器。
- Recent 同纳秒或时钟回拨时以保留时间与 ID 排序，不额外维护访问序号。
- 所有 Phase 2A 的 size/mtime 信任假设、陈旧离线快照、单 root 事务和同步连接
  约束继续存在。

## 18. Remaining Phase 2 blockers / Final verdict

当前 Phase 2 验收范围内无剩余 blocker。Catalog、Persistence、Incremental
Refresh、Collections、Favorites、Recent、Metadata、Search、Faceted Filtering
与 Conflict Analysis 均已实现并有实际验证证据。

**READY FOR PHASE 3**

本次在 Phase 2B 停止，没有开始 CoreText、macOS app、SwiftUI、Android、Windows、
Tauri UI、Hot Reload 或 WebDAV。
