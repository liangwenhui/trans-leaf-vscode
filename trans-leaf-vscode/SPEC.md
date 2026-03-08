# Trans-Leaf VS Code Extension — 实施规格文档

> 本文档面向实现者，包含所有技术决策和实现细节。拿到此文档后应无需猜测任何实现选择。

---

## 1. 项目定位

Trans-Leaf 是一款 **VS Code 翻译插件**，核心价值：

- **像 Coding Agent 处理代码一样处理翻译**：先理解文件上下文（领域、语境），再分段调用 AI，而非简单地把文本丢给翻译 API
- **严格保留原文格式**（缩进、换行、代码块、Markdown 标记等）
- 当前仅支持 **中英互译**

**废弃说明**：原有 Wails 桌面应用（`trans-leaf/` 目录）不再推进，VS Code 插件是唯一产品形态。

---

## 2. 技术栈

| 技术 | 用途 |
|------|------|
| TypeScript | 插件开发语言 |
| VS Code Extension API | 命令、菜单、编辑器操作 |
| esbuild | 打包构建 |
| node-fetch 或内置 fetch (Node 18+) | HTTP 请求调用 AI API |

**不需要**：前端框架、Webview（第一阶段）、数据库

---

## 3. 项目结构

```
trans-leaf-vscode/
├── .vscode/
│   ├── launch.json              # F5 调试配置
│   └── tasks.json               # 构建任务
├── src/
│   ├── extension.ts             # 插件入口（activate/deactivate）
│   ├── commands/
│   │   ├── translateSelection.ts  # 翻译选中文本
│   │   └── translateFile.ts       # 翻译全文
│   ├── translator/
│   │   ├── types.ts              # 接口定义
│   │   ├── mock.ts               # Mock 翻译器（复制原文）
│   │   ├── aiTranslator.ts       # AI 翻译器（调用 API）
│   │   └── index.ts              # 工厂函数，根据配置返回翻译器实例
│   ├── engine/
│   │   ├── segmenter.ts          # 文本分段器
│   │   ├── analyzer.ts           # 文件分析器（领域、语境识别）
│   │   ├── promptBuilder.ts      # Prompt 构建器
│   │   └── queue.ts              # 翻译任务队列（并发控制）
│   ├── lang/
│   │   └── detector.ts           # 源语言检测（中文 vs 英文）
│   └── utils/
│       └── config.ts             # 读写 VS Code 配置
├── package.json
├── tsconfig.json
├── esbuild.mjs
├── SPEC.md                       # 本文档
└── .gitignore
```

---

## 4. 配置项（package.json contributes.configuration）

```jsonc
{
  "transLeaf.provider": {
    "type": "string",
    "default": "mock",
    "enum": ["mock", "claude", "openai", "deepseek"],
    "description": "翻译服务提供商"
  },
  "transLeaf.apiKey": {
    "type": "string",
    "default": "",
    "description": "AI API Key（在设置中输入，不要写入代码仓库）"
  },
  "transLeaf.model": {
    "type": "string",
    "default": "",
    "description": "AI 模型名称（留空则使用各服务商默认模型）"
  },
  "transLeaf.targetLanguage": {
    "type": "string",
    "default": "zh-CN",
    "enum": ["zh-CN", "en"],
    "enumDescriptions": ["翻译为中文", "翻译为英文"],
    "description": "目标翻译语言"
  },
  "transLeaf.concurrency": {
    "type": "number",
    "default": 3,
    "minimum": 1,
    "maximum": 10,
    "description": "并发翻译段数（分段翻译时同时处理的段数）"
  },
  "transLeaf.apiBaseUrl": {
    "type": "string",
    "default": "",
    "description": "自定义 API 地址（用于代理或兼容服务）"
  }
}
```

### 各服务商默认模型

| Provider | 默认模型 | API 端点 |
|----------|---------|---------|
| claude | `claude-sonnet-4-20250514` | `https://api.anthropic.com/v1/messages` |
| openai | `gpt-4o` | `https://api.openai.com/v1/chat/completions` |
| deepseek | `deepseek-chat` | `https://api.deepseek.com/v1/chat/completions` |

如果用户配置了 `apiBaseUrl`，则替换默认端点（仅替换 base，path 保持不变）。

---

## 5. 命令与快捷键

| 命令 ID | 标题 | 快捷键 | 触发条件 |
|---------|------|--------|----------|
| `transLeaf.translateSelection` | Trans-Leaf: 翻译选中文本 | `Ctrl+Alt+T` | 编辑器有选中文本 |
| `transLeaf.translateFile` | Trans-Leaf: 翻译全文 | `Ctrl+Alt+Shift+T` | 编辑器有焦点 |

右键菜单同时注册这两个命令，`translateSelection` 仅在 `editorHasSelection` 时显示。

---

## 6. 核心翻译流程

### 6.1 翻译选中文本

```
用户选中文本 → 触发命令
  → 检查 API Key 是否配置（mock 除外）
    → 未配置：弹出提示 "请先配置 API Key：设置 → Trans-Leaf"，并提供 "打开设置" 按钮
    → 点击按钮后执行 vscode.commands.executeCommand('workbench.action.openSettings', 'transLeaf')
  → 检测源语言（见 §7）
    → 源语言 === 目标语言：直接返回，不做任何操作，状态栏提示 "源语言与目标语言相同，跳过翻译"
  → 显示 Notification 进度条（cancellable: true）
  → 调用翻译器翻译文本
  → 用 editor.edit() 单次替换选中区域（一个 undo 步骤）
  → 状态栏提示 "翻译完成"
```

### 6.2 翻译全文

```
用户触发命令
  → 检查 API Key（同上）
  → 弹出确认框："确定要翻译整个文件吗？翻译后可用 Ctrl+Z 撤销。"
    → 用户取消：终止
  → 检测源语言（同上）
  → 显示 Notification 进度条（cancellable: true，显示百分比）
  → 第一步：文件分析（见 §8）
  → 第二步：文本分段（见 §9）
  → 第三步：按队列并发翻译各段（见 §10）
  → 第四步：合并所有段的译文
  → 第五步：用 editor.edit() 单次替换整个文档（一个 undo 步骤）
    → 所有 replace 调用放在一个 editor.edit() 回调内，确保 Ctrl+Z 一次撤销全部
  → 状态栏提示 "翻译完成"
```

### 6.3 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| API Key 未配置 | `vscode.window.showWarningMessage` + "打开设置" 按钮 |
| 网络错误 | `vscode.window.showErrorMessage("翻译失败：网络连接错误")` |
| API 返回 401 | `showErrorMessage("API Key 无效，请检查配置")` |
| API 返回 429 | `showErrorMessage("请求过于频繁，请稍后重试")` |
| API 返回 500+ | `showErrorMessage("翻译服务暂时不可用，请稍后重试")` |
| 分段翻译中某段失败 | 终止剩余翻译，已翻译的段不写入，`showErrorMessage("翻译第 N 段时失败：{错误信息}")` |
| 用户取消 | 立即停止所有待发请求，已翻译的段不写入，状态栏提示 "翻译已取消" |

**原则**：要么全部成功并写入，要么不写入任何内容。不允许半翻译状态。

---

## 7. 语言检测（`lang/detector.ts`）

### 策略

使用**字符统计法**检测文本是中文还是英文：

```typescript
export function detectLanguage(text: string): 'zh-CN' | 'en' | 'unknown'
```

### 算法

1. 统计文本中 CJK 字符数量（Unicode 范围 `\u4e00-\u9fff`）
2. 统计文本中 ASCII 字母数量（`a-zA-Z`）
3. 计算 CJK 占比 = CJK / (CJK + ASCII)
   - 占比 > 0.3 → `'zh-CN'`
   - 占比 < 0.1 → `'en'`
   - 其他 → `'unknown'`（按目标语言的反向语言处理：如果目标是中文则假定源是英文，反之亦然）

### 同语言处理

如果检测到的源语言与用户设置的 `targetLanguage` 相同：
- **不调用 API**
- 不修改文本
- 状态栏显示："源语言与目标语言相同，跳过翻译"

---

## 8. 文件分析器（`engine/analyzer.ts`）

大文件翻译的第一步，**先理解文件是什么**，然后在每段翻译的 prompt 中携带这个上下文。

```typescript
export interface FileAnalysis {
  fileType: string;      // 'markdown' | 'code' | 'plain' | 'html' | 'json' 等
  domain: string;        // 领域描述，如 "前端开发技术文档"、"学术论文"、"产品说明"
  context: string;       // 一句话语境描述，如 "这是一篇介绍 React Hooks 的技术博客"
  terminology: string[]; // 文中出现的需要统一翻译的关键术语
}

export async function analyzeFile(
  fullText: string,
  languageId: string,
  translator: Translator
): Promise<FileAnalysis>
```

### 实现方式

**用 AI 来分析**。发送文件的前 2000 字符 + 最后 500 字符给 AI，prompt 如下：

```
你是一个翻译预分析助手。请分析以下文本，返回 JSON 格式结果：

{
  "fileType": "文件类型（markdown/code/plain/html/其他）",
  "domain": "所属领域（如：前端开发、机器学习、产品文档、学术论文等）",
  "context": "一句话描述这个文件的内容和语境",
  "terminology": ["需要统一翻译的关键术语列表，最多10个"]
}

文件语言标识：{languageId}

=== 文本开头 ===
{前2000字符}
=== 文本结尾 ===
{后500字符}

请只返回 JSON，不要其他内容。
```

**解析**：`JSON.parse` 解析返回结果。如果解析失败，使用默认值：
```typescript
const defaultAnalysis: FileAnalysis = {
  fileType: languageId || 'plain',
  domain: '通用',
  context: '通用文本',
  terminology: []
};
```

**对于 mock 翻译器**：跳过分析步骤，直接使用默认值。

---

## 9. 文本分段器（`engine/segmenter.ts`）

```typescript
export interface Segment {
  index: number;        // 段序号，从 0 开始
  startLine: number;    // 起始行号（0-indexed）
  endLine: number;      // 结束行号（0-indexed，包含）
  text: string;         // 段文本内容
}

export function segmentText(text: string, languageId: string): Segment[]
```

### 分段规则

**目标**：每段约 200 行，但不能在语义中间断开。

**分段边界优先级**（从高到低）：

1. **Markdown**（`languageId === 'markdown'`）：
   - 一级标题 `# ` 处断开
   - 二级标题 `## ` 处断开
   - 空行连续 2 行以上处断开
   - 每段不超过 300 行

2. **代码文件**（`languageId` 为 ts/js/py/go/java/rust 等）：
   - 函数/类定义边界处断开（简化实现：空行处断开）
   - 每段不超过 200 行

3. **纯文本/其他**：
   - 段落边界（空行）处断开
   - 每段不超过 200 行

**小文件规则**：总行数 ≤ 50 行时，不分段，整体翻译。

**分段后每段必须包含完整行**，不可在行中间断开。

### 换行符保留

分段时记录每段的 `startLine` 和 `endLine`，合并时用原始换行符拼接，不引入额外换行。

---

## 10. 翻译任务队列（`engine/queue.ts`）

```typescript
export interface TranslateTask {
  segment: Segment;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
  error?: string;
}

export class TranslationQueue {
  constructor(
    private concurrency: number,
    private translator: Translator,
    private promptContext: PromptContext,  // 包含 FileAnalysis + 目标语言
    private onProgress: (completed: number, total: number) => void,
    private cancellationToken: vscode.CancellationToken
  ) {}

  async translateAll(segments: Segment[]): Promise<string[]>
  // 返回每段的译文数组，顺序与 segments 对应
  // 任何一段失败则 throw Error
  // 取消则 throw CancellationError
}
```

### 并发控制实现

使用简单的信号量模式：

```
维护一个 running 计数器
遍历所有 segment：
  - 如果 running < concurrency，启动翻译（running++）
  - 否则等待任一任务完成（running--）
  - 每个任务完成后调用 onProgress
  - 每次启动任务前检查 cancellationToken.isCancellationRequested
  - 任何任务失败：设置 abort 标志，等待已启动任务完成，然后 throw
```

### 取消处理

- 检测到 `cancellationToken.isCancellationRequested` 后：
  - 不再启动新任务
  - 等待已启动的请求自然完成（不中断 HTTP 连接）
  - 丢弃所有结果
  - throw `new vscode.CancellationError()`

---

## 11. Prompt 构建器（`engine/promptBuilder.ts`）

这是核心竞争力所在。Prompt 设计决定翻译质量。

```typescript
export interface PromptContext {
  targetLang: 'zh-CN' | 'en';
  analysis: FileAnalysis;
  segmentIndex: number;
  totalSegments: number;
}

export function buildSystemPrompt(ctx: PromptContext): string
export function buildUserPrompt(text: string, ctx: PromptContext): string
```

### System Prompt 模板

```
你是一位专业的{domain}领域翻译专家。你正在翻译一份{fileType}格式的文档。

文档语境：{context}

翻译要求：
1. 将{sourceLang}翻译为{targetLang}
2. **严格保留原文的所有格式**：
   - 保留所有换行符（\n）的位置和数量
   - 保留所有缩进（空格、Tab）
   - 保留 Markdown 标记（#、**、``、```、-、>、[] 等）原封不动
   - 保留 HTML 标签原封不动
   - 保留代码块内容不翻译
   - 保留 URL、文件路径不翻译
   - 保留数字、变量名、函数名不翻译
3. 术语统一：以下术语请按指定方式翻译：
   {terminology 列表，每行一个 "source → target" 格式}
4. 只输出译文，不要输出解释、注释或原文

当前翻译的是第 {segmentIndex+1}/{totalSegments} 段。请保持前后文风格一致。
```

### User Prompt 模板

```
请翻译以下文本：

{text}
```

### 选中文本翻译的简化 Prompt

翻译选中文本时不做文件分析（因为用户只选了一小段），使用简化 prompt：

```
System: 你是一位专业翻译。请将以下{sourceLang}文本翻译为{targetLang}。
严格保留原文的所有格式，包括换行、缩进、标记符号。只输出译文。

User: {selectedText}
```

---

## 12. AI 翻译器实现（`translator/aiTranslator.ts`）

```typescript
export class AITranslator implements Translator {
  constructor(
    private provider: 'claude' | 'openai' | 'deepseek',
    private apiKey: string,
    private model: string,
    private baseUrl?: string
  ) {}

  async translate(text: string, systemPrompt: string): Promise<TranslateResult>
}
```

### API 调用格式

**Claude（Anthropic）**：
```
POST {baseUrl}/v1/messages
Headers:
  x-api-key: {apiKey}
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
  {
    "model": "{model}",
    "max_tokens": 8192,
    "system": "{systemPrompt}",
    "messages": [{ "role": "user", "content": "{userPrompt}" }]
  }
Response: result.content[0].text
```

**OpenAI / DeepSeek**：
```
POST {baseUrl}/v1/chat/completions
Headers:
  Authorization: Bearer {apiKey}
  Content-type: application/json
Body:
  {
    "model": "{model}",
    "messages": [
      { "role": "system", "content": "{systemPrompt}" },
      { "role": "user", "content": "{userPrompt}" }
    ],
    "temperature": 0.3
  }
Response: result.choices[0].message.content
```

### temperature 设置

- 翻译任务使用 `temperature: 0.3`（低随机性，保证一致性）
- 文件分析任务使用 `temperature: 0`（需要结构化 JSON 输出）

### 超时

- 每次 API 请求超时：60 秒
- 超时后 throw Error，由队列处理

---

## 13. 翻译器接口定义（`translator/types.ts`）

```typescript
export interface TranslateResult {
  text: string;
  success: boolean;
  error?: string;
}

export interface TranslateOptions {
  systemPrompt: string;
  userPrompt: string;
}

export interface Translator {
  /** 简单翻译（选中文本用） */
  translate(text: string, targetLang: string): Promise<TranslateResult>;

  /** 带 prompt 上下文的翻译（分段翻译用） */
  translateWithPrompt(options: TranslateOptions): Promise<TranslateResult>;

  /** 文件分析（返回 JSON 字符串） */
  analyze(prompt: string): Promise<TranslateResult>;
}
```

---

## 14. 写入策略

### 原则：单次 editor.edit()，一次 Ctrl+Z 撤销

所有翻译完成后，**一次性**调用 `editor.edit()`：

```typescript
await editor.edit(editBuilder => {
  // 方式一：全文替换（translateFile）
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  editBuilder.replace(fullRange, mergedTranslation);

  // 方式二：选区替换（translateSelection）
  // editBuilder.replace(selection, translatedText);
});
```

**不要**用多次 `editor.edit()` + `undoStopBefore/After` 方式，该 API 在 VS Code 中有已知 bug。

---

## 15. 进度展示

使用 `vscode.window.withProgress`，`ProgressLocation.Notification`：

```typescript
vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Notification,
    title: 'Trans-Leaf',
    cancellable: true
  },
  async (progress, token) => {
    // 分析阶段
    progress.report({ message: '正在分析文件...' });

    // 翻译阶段
    // increment 是增量，不是绝对值
    const perSegment = 100 / totalSegments;
    queue.onProgress = (completed, total) => {
      progress.report({
        increment: perSegment,
        message: `正在翻译 ${completed}/${total} 段...`
      });
    };

    // 完成
    // withProgress 结束后进度条自动消失
  }
);
```

### 状态栏

注册一个常驻状态栏项：

```
空闲时：🍃 Trans-Leaf
翻译中：$(sync~spin) 翻译中...
完成后：🍃 翻译完成（3秒后恢复为空闲态）
```

---

## 16. 并发/重复操作保护

### 方案：全局锁

维护一个模块级变量 `isTranslating: boolean`：

```typescript
let isTranslating = false;

async function executeTranslation(...) {
  if (isTranslating) {
    vscode.window.showWarningMessage('翻译正在进行中，请等待完成或取消当前翻译');
    return;
  }
  isTranslating = true;
  try {
    // ... 翻译逻辑
  } finally {
    isTranslating = false;
  }
}
```

两个命令（translateSelection、translateFile）共用同一个锁。

---

## 17. 插件入口（`extension.ts`）

```typescript
export function activate(context: vscode.ExtensionContext) {
  // 1. 注册 translateSelection 命令
  // 2. 注册 translateFile 命令
  // 3. 创建状态栏项
  // 4. 监听配置变更（可选，用于实时更新翻译器实例）
}

export function deactivate() {
  // 清理资源（如果有）
}
```

---

## 18. 开发与调试

### 环境要求

- Node.js >= 18
- VS Code >= 1.85.0

### 命令

```bash
cd trans-leaf-vscode
npm install
npm run compile    # 单次构建
npm run watch      # 监听模式
# F5 启动 Extension Development Host 调试
```

### esbuild 配置

```javascript
// esbuild.mjs
{
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
}
```

---

## 19. 验证清单

实现者完成后，按以下步骤验证：

### Mock 模式验证
1. F5 启动 → 打开任意文件 → 选中文本 → 右键 → "Trans-Leaf: 翻译选中文本" → 文本不变（mock 复制）→ 通过
2. 命令面板 → "Trans-Leaf: 翻译全文" → 确认弹窗 → 全文不变 → 通过
3. 快捷键 Ctrl+Alt+T / Ctrl+Alt+Shift+T → 功能正常 → 通过
4. 翻译后 Ctrl+Z → 一次撤销所有翻译内容 → 通过
5. 翻译进行中再次触发翻译 → 弹出 "翻译正在进行中" 提示 → 通过
6. 翻译进行中点击取消 → 翻译停止，文档不变 → 通过

### API Key 检查验证
7. 设置 provider 为 claude，不填 API Key → 触发翻译 → 弹出配置提示 → 通过
8. 点击 "打开设置" 按钮 → 跳转到 Trans-Leaf 设置页 → 通过

### AI 模式验证（需要有效 API Key）
9. 配置 API Key → 选中英文文本 → 翻译为中文 → 格式保留 → 通过
10. 选中中文文本，目标语言设为 zh-CN → 提示 "源语言与目标语言相同" → 通过
11. 打开一个 200+ 行的 Markdown 文件 → 翻译全文 → 看到分段进度 → 通过
12. 翻译过程中取消 → 文档不变 → 通过

---

## 20. 文件依赖关系与实现顺序

实现者应按以下顺序开发：

```
第 1 层（无依赖）：
  ├── utils/config.ts
  ├── lang/detector.ts
  └── translator/types.ts

第 2 层（依赖第 1 层）：
  ├── translator/mock.ts
  └── translator/aiTranslator.ts

第 3 层（依赖第 2 层）：
  ├── translator/index.ts
  ├── engine/promptBuilder.ts
  └── engine/segmenter.ts

第 4 层（依赖第 3 层）：
  ├── engine/analyzer.ts
  └── engine/queue.ts

第 5 层（依赖第 4 层）：
  ├── commands/translateSelection.ts
  └── commands/translateFile.ts

第 6 层（依赖第 5 层）：
  └── extension.ts
```

---

## 附录 A：package.json 完整配置

见本文档 §4（配置项）和 §5（命令与快捷键）的内容合并编写。完整 package.json 需包含：

- `name`: `"trans-leaf"`
- `displayName`: `"Trans-Leaf"`
- `description`: `"AI 驱动的专业翻译工具，保留原文格式"`
- `version`: `"0.1.0"`
- `engines.vscode`: `"^1.85.0"`
- `main`: `"./out/extension.js"`
- `contributes`: commands + menus + keybindings + configuration（见 §4、§5）
- `scripts`: compile, watch, lint
- `devDependencies`: `@types/vscode`, `@types/node`, `typescript`, `esbuild`

## 附录 B：后续扩展点

本文档定义的架构预留了以下扩展点（当前不实现）：

1. **新增 AI 服务商**：在 `translator/` 下新增实现类，在 `index.ts` 工厂函数中注册
2. **术语库**：在 `promptBuilder.ts` 的 terminology 部分注入自定义术语
3. **侧边栏面板**：新增 `webview/` 目录，通过 ViewContainer 注册
4. **批量文件翻译**：复用 queue + segmenter，新增文件遍历逻辑
5. **翻译记忆**：可在本地存储翻译缓存，相同段落不重复翻译
