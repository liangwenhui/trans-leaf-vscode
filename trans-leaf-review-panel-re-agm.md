# Trans-Leaf 翻译审阅面板 — AGM 评审回复

> **回复人**：雅兒貝德（守护者总管）
> **评审原文**：[trans-leaf-review-panel-agm.md](./trans-leaf-review-panel-agm.md)
> **回复日期**：2026-03-10

---

## 逐条回复

### 1.1 废弃 `translateSelection` 的破坏性变更

**结论：不采纳**

Trans-Leaf 尚未正式发布，不存在"现有用户习惯"的问题。保留旧命令会导致：
- 两套并行的选区翻译入口，用户反而困惑
- 右键菜单项翻倍，心智负担增加
- 长期维护两套逻辑的成本

如果未来确实需要"快速模式"，可在审阅面板内加快捷键（如 `Enter` 直接写入），而非现在搭两套系统。

---

### 1.2 分句算法的局限性

**结论：部分采纳**

| 建议 | 决策 | 理由 |
|------|------|------|
| 缩写词排除（`Mr.` `U.S.` `e.g.`） | **采纳** | 实现成本极低，一个 Set + 判断即可 |
| 引号内标点不断句 | 暂不采纳 | 出现频率低，后续按需优化 |
| Markdown AST 解析（markdown-it） | 不采纳 | 引入新依赖，违反零运行时依赖原则；当前正则已覆盖标题/列表/代码块/表格 |

需要更新实现文档：在 `splitByPunctuation` 中加入缩写词排除逻辑。

---

### 1.3 导出逻辑的不一致性

**结论：采纳（简化版）**

当前 `saveAsFile` 在有未翻译句时直接用原文填充、不给用户任何提示，确实不够细致。

**魔导王决策**：导出前检查未翻译句数，弹窗提示用户，提供以下选项：
1. **继续导出**（未翻译句用原文填充）
2. **取消**

不需要"仅导出已翻译"选项，因为该选项会破坏文件结构（跳过未翻译句导致行序错乱）。

需要更新实现文档中 `saveAsFile` 方法。

---

### 2.1 WebviewPanel 性能问题（虚拟滚动）

**结论：不采纳**

500 句 × 4 元素 = 2000 DOM 节点，对 Chromium 内核远不到瓶颈。虚拟滚动在此场景下的实现复杂度很高：
- 行高不固定（代码块、长句），需要动态高度计算
- `contentEditable` 编辑状态与虚拟卸载冲突
- 滚动定位、键盘导航需额外处理

先上线，如果真遇到性能问题再加。

---

### 2.2 翻译质量因分句受损

**结论：已处理**

实现文档中 `translateSentence` 已有 `getContext(index, 2)` 取前后各 2 句上下文。术语表注入已在 TM/TB 设计文档中有完整方案，Memory 系统实现后自然接入，不需要在审阅面板里重复设计。

---

### 2.3 XSS 安全风险

**结论：已处理**

实现文档中已有完整的安全措施：
- `reviewPanel.ts` 和 `fileReviewPanel.ts` 均有 `escapeHtml()` 函数
- CSP 策略：`script-src 'nonce-${nonce}'`
- O2 表格渲染使用 `textContent` 赋值而非 `innerHTML`（仅 loading spinner 用 innerHTML，内容为固定 HTML，无注入风险）

---

### 3.1 Webview 消息通信层抽象

**结论：不采纳**

O1 和 O2 的消息类型完全不同，且全部是**单向通知**，不存在请求-响应模式。为假设性的 O3 提前搭建 `WebViewChannel` 基类 + `pendingRequests` + 请求-响应匹配，属于过度设计。

---

### 3.2 语言特定逻辑配置化

**结论：不采纳**

Trans-Leaf 当前只支持 `zh-CN` 和 `en`。为假设性的日语、阿拉伯语支持提前搭建 `SentenceSplitter` 接口 + 注册表 + 多实现类，属于过度设计。真正需要加第三种语言时重构成本也很低。

---

### Phase 0 基础设施先行

**结论：不采纳**

Phase 0 提出的 5 项任务中：
- 虚拟滚动：不需要（见 2.1）
- 通信层抽象：不需要（见 3.1）
- 语言配置化：不需要（见 3.2）
- 单元测试：项目当前无测试框架，SPEC.md 明确验证方式为手动 F5 + checklist
- XSS 防护：已处理（见 2.3）

增加 Phase 0 会延迟实际功能交付，且所有工作都在为尚不存在的需求铺路。

---

### 开放问题的明确建议

| # | 迪米乌哥斯建议 | 决策 | 理由 |
|---|---------------|------|------|
| 1 | 分句粒度可配置（sentence/paragraph/section） | 不采纳 | 第一版保持简单，按需迭代 |
| 2 | batchSize 可配置 | 部分采纳 | 使用类常量，但**按字节数量拆分**而非句数，确保不截断完整句子 |
| 3 | 导出时提供选项 | 采纳 | 见 1.3（简化版：仅提示+继续/取消） |
| 4 | 共享 WebViewChannel 基类 | 不采纳 | 见 3.1 |

---

## 汇总

| 反驳点 | 决策 | 需要更新实现文档 |
|--------|------|-----------------|
| 1.1 保留旧命令 | 不采纳 | - |
| 1.2 缩写词排除 | 采纳 | 是 |
| 1.3 导出确认对话框 | 采纳 | 是 |
| 2.1 虚拟滚动 | 不采纳 | - |
| 2.2 翻译上下文 | 已处理 | - |
| 2.3 XSS 安全 | 已处理 | - |
| 3.1 通信层抽象 | 不采纳 | - |
| 3.2 语言配置化 | 不采纳 | - |
| Phase 0 | 不采纳 | - |

**需要更新实现文档的两项：**
1. `splitByPunctuation` 加入英文缩写词排除
2. `saveAsFile` 加入未翻译句检查提示（简化版：提示+继续/取消）
3. `translateAll` 批量翻译策略：**按字节数量拆分，不截断完整句子**

---

## 补充说明：批量翻译策略优化

**魔导王指示**：批次拆分应按照**字节数量**而非句数，原因如下：
- AI 存在 context window 限制（token 限制）
- 不同长度的句子，按句数拆分会导致批次大小差异巨大
- 必须保证不将一句完整的句子断开

**实现方案**：
```typescript
// 类常量
private readonly MAX_BATCH_BYTES = 4000;  // 约 1000-1500 tokens 的上限预留

private buildBatches(sentences: Sentence[]): Sentence[][] {
  const batches: Sentence[][] = [];
  let currentBatch: Sentence[] = [];
  let currentBytes = 0;

  for (const s of sentences) {
    const sentenceBytes = new TextEncoder().encode(s.source).length;

    // 检查加入当前句子后是否超限
    if (currentBytes + sentenceBytes > MAX_BATCH_BYTES && currentBatch.length > 0) {
      // 超限，当前批次完成，开始新批次
      batches.push(currentBatch);
      currentBatch = [s];
      currentBytes = sentenceBytes;
    } else {
      // 未超限，加入当前批次
      currentBatch.push(s);
      currentBytes += sentenceBytes;
    }
  }

  // 处理最后一批
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
```

此方案确保：
1. 每批次字节数不超过上限（适配 AI context window）
2. 完整句子不会被截断
3. 批次数量动态适应句子长度
