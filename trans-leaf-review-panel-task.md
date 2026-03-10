# Trans-Leaf 翻译审阅面板 — 任务卡片

> 基于 impl 文件生成，每个任务完成后需 `npm run compile` 编译通过

---

## Phase 1: O1 选区翻译审阅

| # | 工作描述 | 对应 impl 标题 | 完成后 |
|---|----------|----------------|--------|
| 1 | 创建 `src/webview/reviewPanel.ts` O1审阅面板 | 1.1 新增文件 → `src/webview/reviewPanel.ts` | ✅ 编译通过 |
| 2 | 创建 `src/commands/translateAndReview.ts` O1命令 | 1.1 新增文件 → `src/commands/translateAndReview.ts` | ✅ 编译通过 |
| 3 | 修改 `extension.ts` 注册O1命令，移除旧translateSelection | 1.2 修改文件 → `extension.ts` | ✅ 编译通过 |
| 4 | 修改 `package.json` 替换命令、菜单、快捷键 | 1.2 修改文件 → `package.json` | ✅ 编译通过 |
| 5 | 修改 `chatView.ts` 命令ID引用 | 1.2 修改文件 → `chatView.ts` | ✅ 编译通过 |
| 6 | 删除 `src/commands/translateSelection.ts` | 1.3 删除文件 | ✅ 编译通过 |
| 7 | Phase 1 整体编译验证 + 手动测试 | Phase 1 编译验证 Checklist | ✅ |

**Phase 1 手动测试：**
- [ ] F5 启动扩展，选中文本 → 右键 → "翻译并审阅 → 中文"
- [ ] 弹出面板，左右分栏，原文只读，译文可编辑
- [ ] 编辑译文 → "Write to File" → 确认选区已替换
- [ ] 测试 "Copy" / "Cancel"
- [ ] 快捷键 `Ctrl+Alt+T` 验证

---

## Phase 2: O2 全文分句翻译审阅

| # | 工作描述 | 对应 impl 标题 | 完成后 |
|---|----------|----------------|--------|
| 8 | 创建 `src/commands/translateFileReview.ts` O2命令+分句算法 | 2.1 新增文件 → `src/commands/translateFileReview.ts` | ✅ 编译通过 |
| 9 | 创建 `src/webview/fileReviewPanel.ts` O2审阅面板 | 2.1 新增文件 → `src/webview/fileReviewPanel.ts` | ✅ 编译通过 |
| 10 | 修改 `extension.ts` 注册O2命令 | 2.2 修改文件 → `extension.ts` 追加 | ✅ 编译通过 |
| 11 | 修改 `package.json` 添加O2命令和快捷键 | 2.2 修改文件 → `package.json` 追加 | ✅ 编译通过 |
| 12 | Phase 2 整体编译验证 + 手动测试 | Phase 2 编译验证 Checklist | ✅ |

**Phase 2 手动测试：**
- [ ] F5 启动扩展，打开 .md 文件
- [ ] 命令面板 → "Trans-Leaf: 分句翻译审阅"
- [ ] 选择目标语言，确认表格视图
- [ ] 点击单行 [▶] → 确认翻译
- [ ] 点击 "全部翻译" → 确认批量翻译
- [ ] 编辑译文 → 确认状态变为 "edited"
- [ ] "Save As File" → 确认保存
- [ ] 快捷键 `Ctrl+Alt+Shift+R` 验证

---

## 编译命令

```bash
cd ~/workspaces/my-projects/trans-leaf-vscode
npm run compile
npm run lint
```

---

_生成时间: 2026-03-10_
