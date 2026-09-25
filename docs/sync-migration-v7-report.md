# 云同步迁移缺陷报告：缺少 `sync_remote_cursors`

> 状态：已按第 6 节实施 v7 迁移修复，并增加缺表回归测试。

## 1. 现象

macOS App 侧栏「云端」中，123PAN 显示为已连接，但触发同步后设置窗口与云字体库报错：

```
本地存储失败：sqlite error: no such table: sync_remote_cursors
```

同步因此在该设备上不可用，云字体库无法与远端交换事件。

## 2. 现场证据

在本机检查所有 Folio 数据库的 `PRAGMA user_version` 与同步表：

```sh
sqlite3 "<db>" "PRAGMA user_version; SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sync%' ORDER BY name;"
```

| 数据库 | user_version | 同步表 |
| --- | --- | --- |
| `~/Library/Application Support/Folio/folio.sqlite` | 6 | 5 张齐全 |
| `~/Library/Containers/com.folio.app/.../folio.sqlite`（**App 实际使用**） | 6 | **缺 `sync_remote_cursors`**，其余 4 张在 |
| `~/Library/Containers/com.folio.p3c.validation/...` | 3 | 无 |
| `~/Library/Containers/com.folio.sidebar.preview/...` | 3 | 无 |

即：只有沙盒中的 App 库停在「schema 版本已到 6、但同步表不全」的不一致状态；非沙盒库为新建，表齐全。

## 3. 根因

代码位置：`crates/folio-storage/src/schema.rs`。

- `CURRENT_SCHEMA_VERSION = 6`，`migrate_to_v6` 一次性创建 5 张同步表
  （`sync_metadata`、`sync_events`、`sync_assets`、`sync_remote_cursors`、`sync_conflicts`）。
- 该步骤使用**不带 `IF NOT EXISTS` 的 `CREATE TABLE`**，本身不幂等。
- 迁移驱动逻辑为 `while version < CURRENT_SCHEMA_VERSION`：一旦 `user_version` 被写成 6，**不会再执行 v6**。

结论：开发过程中 `migrate_to_v6` 先定稿时只创建了部分同步表（4 张），之后把
`sync_remote_cursors` 补进 v6，但**没有提升 schema 版本**。较早生成的
`com.folio.app` 库记录了 `user_version = 6`，既拿不到后加的表，也不会重跑 v6
自修复。

触发路径：`folio-sync` 接收远端事件时调用
`insert_remote_sync_event` → 读取 `sync_remote_cursors`
（`crates/folio-storage/src/sync.rs`）→ 表不存在 → `StorageError` →
FFI 转为「本地存储失败：…」。

## 4. 影响范围

- 仅影响「在补表之前就已把 `user_version` 写成 6」的旧库，本机即
  `com.folio.app`。
- 全新安装、以及仍停在 v5 及更早的库不受影响（会完整执行 v6）。
- 沙盒 preview 的两个库停在 v3，未来迁移同样不受影响。
- 失败发生在「接收远端事件」阶段；本地已生成的待发布事件不会丢失，但该设备
  的云同步完全不可用。

## 5. 为什么测试未暴露

`crates/folio-storage/tests/migration.rs` 的 `v5_user_data_survives_sync_migration`
是**将 5 张同步表全部 DROP 后设回 v5**，再一次性走完 v6，属于「干净的旧版本」，
无法复现「已是 v6 但少一张表」的状态。因此 `cargo test` 全绿，问题只在真实
开发库上出现。

## 6. 修复方案（已实施）

唯一正确方向是**提升 schema 版本并增加幂等修复步骤**。单纯把 v6 改为
`IF NOT EXISTS` 无效，因为版本已是 6，不会重跑。

1. 将 `CURRENT_SCHEMA_VERSION` 提升为 **7**。
2. 在 `apply_step` 增加 `7 => migrate_to_v7`。
3. `migrate_to_v7` 用 `CREATE TABLE IF NOT EXISTS` 确保 5 张同步表都存在：
   对完整 v6 是无害空操作，对残缺 v6 是补表。
4. 同步更新版本断言：
   - `tests/migration.rs`：`assert_eq!(CURRENT_SCHEMA_VERSION, 6)`、
     `migrated.schema_version() == 6` 等
   - `tests/migration_v2.rs`、`tests/migration_v3.rs` 中的 `6`
5. 新增回归测试：构造「`user_version = 6` 但删除 `sync_remote_cursors`」的库，
   重新打开后断言版本为 7，且 `sync_remote_cursor("device")` 正常返回 0。
6. 可选：将 `migrate_to_v6` 也改为 `IF NOT EXISTS`，继续收敛开发库的同类
   残缺（非必需，v7 已兜底）。

> 备选（不推荐）：直接删除 `com.folio.app` 的 `folio.sqlite` 重建。可立即恢复，
> 但会丢失该库的字体来源、收藏、收藏夹与最近浏览等用户数据。

## 7. 验证

- `cargo test -p folio-storage -p folio-sync -p folio-ffi` 已通过，含 v6 缺表回归测试。
- `xcodebuild` 的 macOS Debug 构建已通过。
- 已用更新后的 App 启动真实 `com.folio.app` 库；库升级到 v7，`sync_remote_cursors` 已创建，云字体库不再显示缺表错误。
- 当前设备的 123PAN 连接已结束一次同步且未再显示缺表错误；双设备、断网恢复与冲突处理的实网验收仍待完成。
