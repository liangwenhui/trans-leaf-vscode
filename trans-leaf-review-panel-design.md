# Trans-Leaf 翻译审阅面板设计

> 两种审阅模式：选区审阅 + 全文分句审阅

**相关文档：**
- [TM 翻译记忆设计](./trans-leaf-tm-design.md)

---

## 1. 概述

### 1.1 目标

**O1 — 选区翻译审阅**

选中文本后翻译（右键 / 快捷键），**不直接写入文件**，而是弹出审阅面板，展示原文和译文的对照视图。用户可以：
- 审阅并编辑译文
- 确认后写入文件（替换选区）
- 可选同时存入 TM

**O2 — 全文分句翻译审阅**

选择文件，进入分句模式。文本按照标点符号断句，分左右两栏 table 视图，逐句对照。用户可以：
- 逐句审阅、编辑译文
- 可选将每句存入 TM
- 全文处理完后，确认并另存为新文件

### 1.2 与现有功能的关系

| 功能 | 行为 | 适用场景 | 状态 |
|------|------|---------|------|
| ~~`translateSelection`~~ | ~~选中 → 翻译 → 直接替换~~ | ~~快速翻译~~ | **废弃，由 O1 取代** |
| `translateFile` (现有) | 全文 → 分段翻译 → **直接替换** | 快速全文翻译 | 保留 |
| `translateAndReview` (O1) | 选中 → 翻译 → **审阅弹窗** → 确认后写入 | 选区翻译 | **新增** |
| `translateFileReview` (O2) | 全文 → 分句 → **table 审阅** → 另存为 | 全文精细翻译 | **新增** |

O1 完全取代原有的 `translateSelection`，同时接管其快捷键 `Ctrl+Alt+T` 和右键菜单位置。

### 1.3 废弃清理

实施时需要删除/替换以下内容：

| 项目 | 操作 |
|------|------|
| `src/commands/translateSelection.ts` | 删除文件 |
| `extension.ts` 中 `translateSelectionToZh` / `translateSelectionToEn` 注册 | 替换为 O1 命令 |
| `package.json` 中 `translateSelectionToZh` / `translateSelectionToEn` | 替换为 O1 命令 |
| 快捷键 `Ctrl+Alt+T` | 改绑到 `translateAndReviewToZh` |

---

## 2. O1 — 选区翻译审阅

### 2.1 用户交互流程

```
1. 用户在编辑器中选中文本
2. 右键菜单 → "Trans-Leaf 翻译" → "翻译并审阅 (中文)" 或 "Translate & Review (English)"
   或快捷键 Ctrl+Alt+R
3. 状态栏显示翻译中...
4. 翻译完成 → 弹出 WebviewPanel（在编辑器旁边打开）
5. 面板展示：

   ┌────────────────────────┬────────────────────────┐
   │  Source (English)       │  Translation (中文)     │
   │                        │  (可编辑)               │
   │  This is the original  │  这是原文文本。          │
   │  text content.         │                        │
   │                        │                        │
   ├────────────────────────┴────────────────────────┤
   │  [□ Save to TM]          [Copy] [Cancel] [Write]│
   └─────────────────────────────────────────────────┘

6. 用户可以：
   a. 编辑译文 textarea
   b. 点击 "Write to File" → 替换选区 + 关闭面板
   c. 点击 "Copy" → 复制译文到剪贴板
   d. 点击 "Cancel" → 关闭面板，不做任何修改
   e. 勾选 "Save to TM" → 写入文件时同时存入翻译记忆库
```

### 2.2 UI 布局

```
┌─────────────────────────────────────────────────────┐
│  Translation Review        [English → 中文]          │
├────────────────────────┬──┬─────────────────────────┤
│  Source                 │  │  Translation (editable)  │
│                        │  │                          │
│  <pre> 原文展示        │竖│  <textarea> 译文可编辑    │
│  （只读，保留格式）     │线│                          │
│                        │  │                          │
├────────────────────────┴──┴─────────────────────────┤
│  [□ Save to TM]              [Copy] [Cancel] [Write]│
└─────────────────────────────────────────────────────┘
```

- 左右各 50%，中间竖线分隔
- 原文只读，`<pre>` 保留格式
- 译文可编辑，`<textarea>`
- 底部：左侧 TM checkbox，右侧操作按钮

### 2.3 命令流程

```typescript
async function translateAndReview(targetLang?: 'zh-CN' | 'en'): Promise<void> {
  // 1. 校验：编辑器、选区、API Key（复用 translateSelection 的逻辑）
  // 2. 检测源语言
  // 3. 构建 prompt（复用 buildSimpleSelectionPrompt）
  // 4. 调用 AI 翻译（复用 Translator）
  // 5. 翻译完成后：不替换选区，而是打开审阅面板
  //    TranslationReviewPanel.show(source, target, sourceLang, targetLang, onWrite)
  // 6. onWrite 回调：editor.edit() 替换选区
}
```

### 2.4 写入文件注意事项

用户审阅时可能已经改变了编辑器焦点或选区。写入时需要：
- 保存原始 `editor` 和 `selection` 引用
- 写入前检查 editor 是否仍然有效
- 如果选区已变化，提示用户

---

## 3. O2 — 全文分句翻译审阅

### 3.1 用户交互流程

```
1. 用户打开一个文件
2. 命令面板 / 状态栏菜单 → "Trans-Leaf: 分句翻译审阅"
   或快捷键 Ctrl+Alt+Shift+R
3. 选择目标语言
4. 打开 WebviewPanel，显示分句 table 视图
5. 文本自动按标点断句，每句一行：

   ┌───┬──────────────────────┬──────────────────────┬──────┐
   │ # │  Source               │  Translation          │      │
   ├───┼──────────────────────┼──────────────────────┼──────┤
   │ 1 │  This is sentence 1. │  这是第一句。         │  [▶] │
   │ 2 │  Here is another one.│  这是另一句。         │  [▶] │
   │ 3 │  ## Section Title     │  ## 章节标题          │  [▶] │
   │ 4 │  More text here.     │  (未翻译)             │  [▶] │
   │...│  ...                 │  ...                 │  ... │
   ├───┴──────────────────────┴──────────────────────┴──────┤
   │  进度 2/15                                              │
   │  [全部翻译] [□ Save all to TM]  [Cancel] [Save As File] │
   └────────────────────────────────────────────────────────┘

6. 用户可以：
   a. 点击单行 [▶] → 翻译该句
   b. 点击 "全部翻译" → 并发翻译所有未翻译句
   c. 点击译文单元格 → 直接编辑
   d. 勾选 "Save all to TM" → 保存时所有句对存入 TM
   e. 点击 "Save As File" → 拼接所有译文，另存为新文件
   f. 点击 "Cancel" → 关闭面板
```

### 3.2 分句算法

按标点符号断句，同时保留格式元素（标题、代码块、空行）作为独立行：

```typescript
interface Sentence {
  index: number;
  /** 原文 */
  source: string;
  /** 译文 */
  target: string;
  /** 是否可翻译（代码块、空行等标记为不可翻译） */
  translatable: boolean;
  /** 状态 */
  status: 'untranslated' | 'translating' | 'translated' | 'edited';
}
```

**断句规则**：

| 语言 | 断句标点 |
|------|---------|
| 中文 | `。` `！` `？` `；`（句末） |
| 英文 | `.` `!` `?`（后跟空格或换行） |
| 通用 | 换行符 `\n`（空行作为独立行） |

**特殊处理**：
- Markdown 标题（`# ...`）→ 独立一行
- 代码块（` ``` ` 包裹）→ 整块作为一行，标记 `translatable: false`
- 列表项（`- ...` / `1. ...`）→ 每项独立一行
- 空行 → 保留，标记 `translatable: false`
- 表格行 → 每行独立，保留 `|` 格式

### 3.3 UI 布局

```
┌──────────────────────────────────────────────────────────┐
│  File Translation Review   filename.md   [en → 中文]      │
├───┬──────────────────────┬──────────────────────┬────────┤
│ # │  Source               │  Translation          │ Action │
├───┼──────────────────────┼──────────────────────┼────────┤
│ 1 │  原文（只读）         │  译文（可点击编辑）    │  [▶]   │
│ 2 │  ...                 │  ...                 │  [▶]   │
│ 3 │  ```code block```    │  ```code block```    │  🔒    │
│ 4 │  ...                 │  ...                 │  [▶]   │
│...│                      │                      │        │
├───┴──────────────────────┴──────────────────────┴────────┤
│  已翻译 2/15 句                                           │
│  [全部翻译]  [□ Save all to TM]     [Cancel] [Save As]    │
└──────────────────────────────────────────────────────────┘
```

- 表格布局，行号 + 原文 + 译文 + 操作
- 原文列只读
- 译文列：点击进入编辑模式（`contenteditable` 或行内 `<textarea>`）
- 不可翻译行（代码块、空行）显示锁定图标 🔒，灰色底色
- 已翻译行高亮（浅绿色底色），未翻译行默认底色

### 3.4 翻译策略

**单句翻译**（点击 [▶]）：
```
1. 该行 status = 'translating'，显示 loading 动画
2. 构建 prompt：上下文取前后各 2 句作为参考
3. 调用 AI 翻译单句
4. 填入译文，status = 'translated'
```

**全部翻译**（点击 [全部翻译]）：
```
1. 筛选所有 translatable && untranslated 的句
2. 将相邻句合并为小批次（每批 5-10 句），减少 API 调用次数
3. 并发翻译各批次（复用 concurrency 配置）
4. 每句完成时实时更新 UI
5. 进度条更新
```

**批次合并翻译**的 prompt 格式：
```
请逐句翻译以下文本，每句用 "---" 分隔输出：

[句1]
---
[句2]
---
[句3]
```

### 3.5 导出

**Save As File**：
```
1. 按句 index 顺序拼接：
   - translatable 且有译文 → 使用 target
   - translatable 但无译文 → 使用 source（保留原文）
   - 不可翻译 → 使用 source
2. 弹出文件保存对话框
   - 默认文件名：{原文件名}.{targetLang}.{ext}
   - 例如：README.zh-CN.md
3. 写入文件
```

---

## 4. 共享技术方案

### 4.1 实现方式

O1 和 O2 都使用 `vscode.window.createWebviewPanel`：
- O1：轻量面板，左右分栏，单段文本
- O2：表格面板，多行逐句视图

### 4.2 O1/O2 面板复用

两个面板共享：
- CSS 主题变量（`--vscode-*`）
- 消息通信模式（postMessage）
- Save to TM 逻辑

但各自独立实现，不强制抽象为一个类（避免过度设计）。

### 4.3 WebView ↔ Extension 消息

**O1 消息：**

| 方向 | 消息类型 | 数据 | 说明 |
|------|---------|------|------|
| WebView → Ext | `write-to-file` | `{ text, saveToTM }` | 写入文件（替换选区） |
| WebView → Ext | `copy` | `{ text }` | 复制译文到剪贴板 |
| WebView → Ext | `close` | — | 关闭面板 |

**O2 消息：**

| 方向 | 消息类型 | 数据 | 说明 |
|------|---------|------|------|
| Ext → WebView | `init` | `{ sentences, sourceLang, targetLang, fileName }` | 初始化分句数据 |
| Ext → WebView | `sentence-updated` | `{ index, target, status }` | 单句翻译完成 |
| Ext → WebView | `batch-progress` | `{ completed, total }` | 批量翻译进度 |
| WebView → Ext | `translate-sentence` | `{ index }` | 翻译指定句 |
| WebView → Ext | `translate-all` | — | 翻译所有未翻译句 |
| WebView → Ext | `update-target` | `{ index, target }` | 用户编辑了译文 |
| WebView → Ext | `save-as-file` | `{ saveToTM }` | 另存为文件 |
| WebView → Ext | `close` | — | 关闭面板 |

---

## 5. 新增文件

| 文件 | 说明 |
|------|------|
| `src/webview/reviewPanel.ts` | O1 选区审阅面板 |
| `src/webview/fileReviewPanel.ts` | O2 全文分句审阅面板 |
| `src/commands/translateAndReview.ts` | O1 命令 |
| `src/commands/translateFileReview.ts` | O2 命令 + 分句算法 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `extension.ts` | 注册 O1 + O2 新命令 |
| `package.json` | 声明命令、菜单、快捷键 |

---

## 6. package.json 变更

### 6.1 新增命令

```jsonc
// O1
{ "command": "transLeaf.translateAndReviewToZh", "title": "Trans-Leaf: 翻译并审阅 → 中文" },
{ "command": "transLeaf.translateAndReviewToEn", "title": "Trans-Leaf: Translate & Review → English" },
// O2
{ "command": "transLeaf.translateFileReview", "title": "Trans-Leaf: 分句翻译审阅" }
```

### 6.2 右键子菜单

替换现有的 `translateSubMenu`（移除旧的 translateSelection）：

```jsonc
"transLeaf.translateSubMenu": [
  { "command": "transLeaf.translateAndReviewToZh", "group": "1_review@1" },
  { "command": "transLeaf.translateAndReviewToEn", "group": "1_review@2" }
]
```

### 6.3 状态栏菜单

新增 O2 入口：

```
Trans-Leaf Menu:
  - Translate File to Chinese
  - Translate File to English
  - 分句翻译审阅        ← 新增 (O2)
  - Settings
```

### 6.4 快捷键

```jsonc
// O1 接管原有 translateSelection 的快捷键
{ "command": "transLeaf.translateAndReviewToZh", "key": "ctrl+alt+t", "when": "editorHasSelection" },
// O2 全文分句
{ "command": "transLeaf.translateFileReview", "key": "ctrl+alt+shift+r", "when": "editorTextFocus" }
```

---

## 7. Save to TM 预留

当前 TM 尚未实现。两个面板的 "Save to TM" 先做 UI 预留：

- O1：单个 checkbox，保存时该句对存入 TM
- O2："Save all to TM" checkbox，保存时所有已翻译句对批量存入 TM
- Extension 侧预留 `saveToTM` 参数，当前为空操作
- 后续 TM 实现后，接入 `MemoryManager.saveTM()`

---

## 8. 实施步骤

### Phase 1：O1 选区审阅（取代 translateSelection）

1. 创建 `src/webview/reviewPanel.ts`
2. 创建 `src/commands/translateAndReview.ts`
3. 修改 `extension.ts`：注册 O1 命令，移除旧 translateSelection 注册
4. 修改 `package.json`：替换命令、菜单、快捷键
5. 删除 `src/commands/translateSelection.ts`
6. 编译验证

### Phase 2：O2 全文分句审阅

1. 实现分句算法（在 `translateFileReview.ts` 中）
2. 创建 `src/webview/fileReviewPanel.ts`
3. 创建 `src/commands/translateFileReview.ts`
4. 修改 `extension.ts` + `package.json`
5. 编译验证

---

## 9. 开放问题

| # | 问题 | 当前方案 | 备选 |
|---|------|---------|------|
| 1 | O2 分句粒度是否可配置？ | 固定按标点 | 配置项选择 sentence / paragraph |
| 2 | O2 批量翻译是逐句发 API 还是合并发？ | 合并小批次（5-10 句） | 逐句发 |
| 3 | O2 是否支持部分导出（只导出已翻译的）？ | 未翻译用原文占位 | 仅导出已翻译句 |
| 4 | O1 和 O2 是否共享同一个 WebviewPanel？ | 各自独立面板 | 同一面板切换模式 |
