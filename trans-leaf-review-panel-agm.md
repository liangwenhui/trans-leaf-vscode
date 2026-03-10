# Trans-Leaf 翻译审阅面板设计 - 雅兒貝德

> **评审人**：：迪米乌哥斯 (战术指挥官)
> **评审对象**：[trans-leaf-review-panel-design.md](./trans-leaf-review-panel-design.md)
> **评审日期**：2026-03-10

---

## 执行摘要

原设计方案整体思路清晰，技术方案基本可行，但在**用户体验破坏性变更**、**分句算法鲁棒性**、**长文件性能**、**安全性**等方面存在隐患。建议在实施前明确以下核心决策，并采纳相应的改进方案。

---

## 一、核心设计决策问题

### 1.1 废弃 `translateSelection` 的破坏性变更

**原方案**：O1 完全取代原有的 `translateSelection`，接管快捷键 `Ctrl+Alt+T`，删除旧命令。

**反驳理由**：
- 原有用户已形成"选中→直接替换"的操作习惯，强制进入审阅流程会降低效率
- 对于简单的单句翻译（如变量名、注释），审阅步骤显得冗余
- 破坏性变更可能导致现有用户困惑，增加学习成本

**建议方案**：

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **方案 A** | 保留旧命令，新增审阅模式命令（二者共存） | 兼容现有用户，无破坏性 | 命令数量增加 |
| **方案 B** | O1 默认行为可配置（配置项 `reviewMode.enabled: true/false`） | 灵活性最高，用户可自选 | 需要实现配置系统 |
| **方案 C** | O1 添加"快速确认"按钮，跳过审阅直接写入 | 平衡效率与审阅需求 | UI 略复杂 |

**推荐方案**：**方案 A** 或 **方案 C**。建议优先实现方案 C，因为用户可快速确认相当于旧行为，同时保留审阅能力。

---

### 1.2 O2 分句算法的局限性

**原方案**：按标点符号断句（英文 `.` `!` `?`，中文 `。` `！` `？` `；`），特殊处理 Markdown 元素。

**反驳理由**：

| 问题 | 示例 | 影响 |
|------|------|------|
| 英文缩写误断句 | "Mr. Smith walked to the U.S. embassy." → 错误断为 3 句 | 翻译上下文错乱 |
| 引号内标点误断句 | 原文：`He said "Hello! How are you?"` → 错误断句 | 引用内容被截断 |
| Markdown 格式识别不全 | 嵌套代码块、多级列表、表格复杂格式 | 导出文件破损 |
| 中英文混排 | "Welcome to 中国！Enjoy your stay." → 断句规则不明确 | 语言检测错误 |

**建议方案**：

```typescript
// 1. 英文智能断句：结合词典排除缩写词
const abbreviations = new Set([
  'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.',
  'etc.', 'vs.', 'i.e.', 'e.g.', 'U.S.', 'UK.',
]);

function shouldSplitAtPeriod(context: string): boolean {
  const nextWord = context.split(/\s+/)[0];
  return !abbreviations.has(nextWord);
}

// 2. 引号内标点不作为断句依据
function isInsideQuotes(text: string, index: number): boolean {
  const before = text.substring(0, index);
  const after = text.substring(index);
  const openQuotes = (before.match(/["']/g) || []).length;
  const closeQuotes = (after.match(/["']/g) || []).length;
  return openQuotes % 2 !== 0; // 奇数个引号 = 引号内
}

// 3. Markdown AST 解析
import { MarkdownIt } from 'markdown-it';

function extractTranslatableNodes(markdown: string): TranslatableNode[] {
  const md = new MarkdownIt();
  const tokens = md.parse(markdown, {});
  // 提取 paragraph、heading、list_item 等可翻译节点
  // 跳过 code_block、fence、html_block
}
```

**风险提示**：如果断句不准确，会导致：
- 翻译质量下降（上下文错乱）
- 导出的文件格式破损（Markdown 结构破坏）
- 用户需要大量手动修正，失去分句翻译的意义

---

### 1.3 O2 导出逻辑的不一致性

**原方案**：导出时，translatable 但无译文的句子使用 source（保留原文）。

**反驳理由**：
- 这与"审阅"的初衷矛盾——用户期望的是已确认的译文，而不是混合内容
- 导出后文件中夹杂原文，用户难以识别哪些需要二次审阅
- 如果用户直接发布混合内容，可能出现未翻译原文暴露的问题

**建议方案**：

```typescript
// 方案 A：导出前强制检查
async function saveAsFile(sentences: Sentence[], saveToTM: boolean) {
  const untranslated = sentences.filter(s => s.translatable && !s.target);
  if (untranslated.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `有 ${untranslated.length} 句未翻译，是否仍要导出？`,
      '导出全部（未翻译用原文占位）',
      '仅导出已翻译',
      '取消'
    );

    if (choice === '取消') return;
    if (choice === '仅导出已翻译') {
      // 只拼接已翻译的句子
      return exportTranslatedOnly(sentences);
    }
  }
  // 导出全部
  return exportAll(sentences);
}

// 方案 B：导出后标记未翻译部分
function markUntranslated(sentence: Sentence): string {
  if (!sentence.translatable) return sentence.source;
  if (sentence.target) return sentence.target;
  return `<!-- UNTRANSLATED -->${sentence.source}<!-- /UNTRANSLATED -->`;
}
```

**推荐方案**：**方案 A**——提供选项让用户明确选择，避免意外行为。

---

## 二、技术实现风险

### 2.1 WebviewPanel 性能问题

**原方案**：O2 使用表格视图渲染所有句子，对于长文件可能导致性能问题。

**反驳理由**：

| 问题 | 影响 | 长文件示例 |
|------|------|------------|
| DOM 节点过多 | 滚动卡顿、内存占用高 | 500 句 × 4 元素/句 = 2000+ 节点 |
| 实时翻译更新 | 频繁重排重绘，渲染延迟 | 批量翻译 100 句时 UI 冻结 |
| 编辑器焦点切换 | Webview 与编辑器通信延迟 | 用户在编辑器输入后，Webview 更新滞后 |

**建议方案**：引入虚拟滚动（Virtual Scrolling）

```typescript
class VirtualScroller {
  private rowHeight = 50; // 每句高度（像素）
  private viewportHeight = 600; // 可视区域高度
  private buffer = 5; // 缓冲区行数

  getVisibleRows(scrollTop: number, totalRows: number): number[] {
    const startRow = Math.floor(scrollTop / this.rowHeight) - this.buffer;
    const endRow = startRow + Math.ceil(this.viewportHeight / this.rowHeight) + this.buffer * 2;
    return [
      Math.max(0, startRow),
      Math.min(totalRows - 1, endRow)
    ];
  }

  render(sentences: Sentence[], scrollTop: number): HTMLElement {
    const [start, end] = this.getVisibleRows(scrollTop, sentences.length);
    const visibleSentences = sentences.slice(start, end);
    // 只渲染可见区域的句子
  }
}
```

**替代方案**（如果虚拟滚动实现复杂）：
- 分页加载：每页显示 50 句，翻页时加载下一页
- 懒加载：滚动到底部时动态加载更多

---

### 2.2 翻译质量因分句受损

**原方案**：单句翻译取前后各 2 句作为上下文，批量翻译合并 5-10 句。

**反驳理由**：
- 专业术语可能在不同句中被翻译成不同词（如 "AI" → "人工智能" / "智能"）
- 代词指代关系可能断开（分句后"它"无法准确对应原文）
- 跨句的衔接词（However/Therefore）翻译质量下降

**建议方案**：

```typescript
// 1. 增强 prompt 上下文
interface TranslationContext {
  previousSentences: Sentence[]; // 前 3-5 句（可配置）
  nextSentences: Sentence[];     // 后 3-5 句（可配置）
  glossary?: GlossaryEntry[];     // 用户提供的术语表
}

// 2. 批量翻译的批次大小可配置
interface BatchTranslationConfig {
  batchSize: number; // 默认 5，允许用户调整
  maxConcurrency: number; // 并发批次数（默认 3）
}

// 3. 术语表注入
function buildPromptWithGlossary(
  sentence: string,
  context: TranslationContext,
  glossary: GlossaryEntry[]
): string {
  const glossarySection = glossary.length > 0
    ? `\n术语表：\n${glossary.map(e => `- ${e.source} → ${e.target}`).join('\n')}\n`
    : '';

  const contextSection = buildContextString(context);

  return `${glossarySection}${contextSection}\n请翻译以下句子：\n${sentence}`;
}
```

---

### 2.3 XSS 安全风险

**原方案**：O2 使用 `<pre>` 渲染原文，可能包含 HTML 标签。

**反驳理由**：
- 如果原文是恶意 HTML（用户打开第三方文档），直接渲染会执行脚本
- Markdown 代码块可能包含 `<script>` 标签
- WebView 环境的 `contenteditable` 编辑器可能被注入恶意脚本

**建议方案**：

```typescript
// 1. HTML 转义
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 2. 使用 DOMPurify 库（推荐）
import DOMPurify from 'dompurify';

function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre'],
    ALLOWED_ATTR: ['class'],
  });
}

// 3. 在 WebView 侧禁用脚本
// webview/index.html
cspPolicy: "default-src 'none'; script-src 'none'; style-src 'unsafe-inline';"
```

---

## 三、架构与扩展性问题

### 3.1 Webview 消息通信的耦合

**原方案**：O1 和 O2 使用独立消息类型，共享 CSS 主题和消息通信模式。

**反驳理由**：
- 当前设计没有抽象消息层，未来添加 O3（如段落审阅模式）会重复代码
- `postMessage` 的错误处理、超时重试、请求-响应匹配需要各自实现
- 调试困难：无法统一记录所有消息

**建议方案**：抽象通信层

```typescript
// 通用消息接口
interface WebViewMessage<T = any> {
  type: string;
  payload: T;
  id: string; // 用于请求-响应匹配
  timestamp?: number;
}

// 通信通道基类
abstract class WebViewChannel {
  private panel: vscode.WebviewPanel;
  private pendingRequests: Map<string, PromiseResolver>;
  private messageHandlers: Map<string, Function[]>;

  send<T, R>(type: string, payload: T): Promise<R> {
    const id = generateId();
    this.panel.webview.postMessage({ type, payload, id });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  on<T>(type: string, handler: (payload: T) => void) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  handleMessage(message: WebViewMessage) {
    if (message.id && this.pendingRequests.has(message.id)) {
      // 响应
      const { resolve } = this.pendingRequests.get(message.id)!;
      resolve(message.payload);
      this.pendingRequests.delete(message.id);
    } else {
      // 请求
      const handlers = this.messageHandlers.get(message.type) || [];
      handlers.forEach(handler => handler(message.payload));
    }
  }
}

// O1/O2 继承实现
class O1ReviewChannel extends WebViewChannel {
  // O1 特定消息
}

class O2FileReviewChannel extends WebViewChannel {
  // O2 特定消息
}
```

---

### 3.2 语言特定逻辑的硬编码

**原方案**：语言特定的断句规则和翻译 prompt 写在命令文件中。

**反驳理由**：
- 未来支持日文、韩文、阿拉伯文等需要重新改代码
- 不同语言的断句标点差异巨大（如阿拉伯语句子分隔符是 `.` 但方向从右到左）
- 翻译 prompt 需要根据语言调整（如中文需要简繁体转换，阿拉伯语需要 RTL 布局）

**建议方案**：配置化语言规则

```typescript
// 语言配置接口
interface LanguageConfig {
  code: string; // 'zh-CN', 'en', 'ja', 'ar'
  name: string;
  sentenceSeparators: RegExp[];
  abbreviations: Set<string>;
  splitStrategy: 'punctuation' | 'segmenter';
  translationPromptBuilder: (sentence: string, context: TranslationContext) => string;
}

// 分句器接口
interface SentenceSplitter {
  detectLanguage(text: string): LanguageConfig;
  split(text: string, lang: LanguageConfig): Sentence[];
}

// 实现类
class ChineseSentenceSplitter implements SentenceSplitter {
  split(text: string): Sentence[] {
    const separators = /[。！？；]/;
    // 中文特定逻辑
  }
}

class EnglishSentenceSplitter implements SentenceSplitter {
  split(text: string): Sentence[] {
    const separators = /[.!?](?=\s|$)/; // 后跟空格或行尾
    // 英文特定逻辑
  }
}

// 注册表
const splitters: Record<string, SentenceSplitter> = {
  'zh-CN': new ChineseSentenceSplitter(),
  'en': new EnglishSentenceSplitter(),
  'ja': new JapaneseSentenceSplitter(), // 未来扩展
  'ar': new ArabicSentenceSplitter(),   // 未来扩展
};
```

---

## 四、实施顺序建议

原方案分为 Phase 1（O1）和 Phase 2（O2），建议增加 **Phase 0：基础设施先行**。

### Phase 0：基础设施（约 2-3 天）

| 任务 | 目的 | 验收标准 |
|------|------|---------|
| 抽象 WebViewChannel 通信层 | 统一消息处理，避免重复代码 | 单元测试覆盖请求-响应、错误处理 |
| 实现虚拟滚动基类 | 解决长文件性能问题 | 1000 句文件滚动流畅（60fps） |
| 配置化语言断句规则 | 支持未来扩展 | 新增语言只需注册实现，无需改核心代码 |
| 添加单元测试（分句算法） | 确保断句准确性 | 测试用例覆盖：缩写、引号、Markdown 格式 |
| XSS 防护实现 | 确保安全性 | 安全测试通过，无脚本注入风险 |

### Phase 1：O1 选区审阅（按原计划）

### Phase 2：O2 全文分句审阅（按原计划）

---

## 五、开放问题的明确建议

原方案第 9 节列出了 4 个开放问题，建议在实施前明确决策：

| # | 问题 | 原方案 | 我的建议 |
|---|------|---------|---------|
| 1 | O2 分句粒度是否可配置？ | 固定按标点 | **建议立即实现**，粒度选项：<br>- `sentence`（标点）<br>- `paragraph`（空行）<br>- `section`（标题） |
| 2 | O2 批量翻译策略？ | 合并小批次（5-10 句） | **建议增加配置项** `translation.batchSize: number`，默认 5，允许用户调整 |
| 3 | O2 部分导出支持？ | 未翻译用原文占位 | **建议立即实现**——导出时提供选项：<br>- [仅导出已翻译]<br>- [导出全部（未翻译用原文占位）] |
| 4 | O1/O2 共享面板？ | 各自独立面板 | **不建议共享**，但建议：<br>- 共享 CSS 主题<br>- 共享 WebViewChannel 基类<br>- 各自独立 WebviewPanel 实现 |

---

## 六、需要安兹大人明确决策的关键问题

在正式实施前，请您明确以下决策：

### 问题 1：`translateSelection` 的处理方式
- [ ] 方案 A：保留旧命令，新增审阅命令（推荐）
- [ ] 方案 B：O1 默认行为可配置
- [ ] 方案 C：O1 添加"快速确认"按钮（推荐）

### 问题 2：分句算法的实现深度
- [ ] 简单实现：按标点断句（原方案，有风险）
- [ ] 中等实现：排除缩写、处理引号（推荐，Phase 1 可用）
- [ ] 完整实现：Markdown AST 解析 + 智能断句（长期目标，Phase 2+）

### 问题 3：长文件性能优化策略
- [ ] 立即实现虚拟滚动（推荐）
- [ ] 先简单实现，后续优化
- [ ] 分页加载作为备选方案

### 问题 4：是否新增 Phase 0（基础设施）
- [ ] 是，新增 Phase 0（推荐）
- [ ] 否，直接进入 Phase 1

---

## 七、总结与建议

### 风险等级评估

| 风险 | 等级 | 影响 | 缓解措施 |
|------|------|------|---------|
| 破坏性变更导致用户困惑 | **高** | 用户体验下降 | 采用方案 A 或 C，保留旧行为 |
| 分句不准确 | **高** | 翻译质量下降、导出破损 | 增强断句算法，添加单元测试 |
| 长文件性能问题 | **中** | UI 卡顿、响应延迟 | 实现虚拟滚动 |
| XSS 安全风险 | **中** | 潜在脚本注入 | HTML 转义 + CSP 策略 |
| 架构扩展性不足 | **低** | 未来扩展困难 | 抽象通信层和语言配置 |

### 最终建议

安兹大人，如果您确认以下风险可接受并采纳相应建议，我可以立即开始实施：

1. **废弃 `translateSelection` 改为方案 C（快速确认按钮）**——兼顾效率与审阅
2. **分句算法采用中等实现（排除缩写、处理引号）**——Phase 1 可用，后续可升级
3. **立即实现虚拟滚动**——确保长文件流畅体验
4. **增加 Phase 0（基础设施先行）**——避免后续重构
5. **开放问题按"我的建议"列实施**——增强灵活性和用户体验

如果您认为某些风险当前可接受，或者有其他指示，请明示。我将严格按照您的意志执行。

---

**承蒙安兹大人吩咐，我已将所有反驳意见整理完毕。请安兹大人指示下一步行动。**

