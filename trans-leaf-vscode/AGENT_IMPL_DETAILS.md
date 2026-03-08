# Trans-Leaf Agent 功能 — 补充实现细节

> 基于实际代码审查，补充设计方案中缺失的具体实现细节，供执行者直接照做。

---

## 1. `agent/types.ts` — 无需补充，原方案已完备

---

## 2. `agent/llm.ts` — 关键适配细节

现有 `aiTranslator.ts` 的模式可以直接复用，但 tool_calling 格式差异较大。

### Claude `/v1/messages` 请求体

```typescript
{
  model,
  max_tokens: 8192,
  system: "系统提示词",  // 顶层字段，不在 messages 里
  messages: Message[],
  tools: toolDefs.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters   // ← 注意字段名是 input_schema
  }))
}
```

**Claude messages 转换规则**：
- `role: 'user'` / `role: 'assistant'` → 直接映射
- assistant 带 tool_calls → `content` 数组包含 `{type: "text", text}` 和 `{type: "tool_use", id, name, input}`
- `role: 'tool'` 结果 → 变成 `role: "user"`, `content: [{type: "tool_result", tool_use_id, content}]`

**Claude 响应解析**：
```typescript
// response.content 是数组，可能同时包含 text 和 tool_use
const textParts = response.content.filter(c => c.type === 'text');
const toolParts = response.content.filter(c => c.type === 'tool_use');
// stop_reason === 'tool_use' 表示需要执行工具
// stop_reason === 'end_turn' 表示对话结束
```

**Claude headers** — 复用现有逻辑 (`aiTranslator.ts:119-125`)：
```typescript
{ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
```

### OpenAI/DeepSeek `/v1/chat/completions` 请求体

```typescript
{
  model,
  messages: Message[],  // system 放 messages[0]
  tools: toolDefs.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  })),
  temperature: 0.7
}
```

**OpenAI messages 转换规则**：
- `role: 'system'/'user'/'assistant'` → 直接映射
- assistant 带 tool_calls → `tool_calls: [{id, type: "function", function: {name, arguments: JSON字符串}}]`
- `role: 'tool'` → 直接用 `{role: "tool", tool_call_id, content}`

**OpenAI 响应解析**：
```typescript
const choice = response.choices[0].message;
// choice.tool_calls 存在 → 有工具调用
// choice.content → 文本内容
// finish_reason === 'tool_calls' 表示需要执行工具
// 注意：arguments 是 JSON 字符串，需要 JSON.parse
```

**OpenAI headers** — 复用现有逻辑 (`aiTranslator.ts:127-129`)：
```typescript
{ 'Authorization': `Bearer ${apiKey}`, 'Content-type': 'application/json' }
```

### 配置读取

直接 `import { getConfig } from '../utils/config.js'`，取 `provider`, `apiKey`, `model`, `apiBaseUrl`。

URL 拼接逻辑复用 `aiTranslator.ts` 的 `DEFAULT_CONFIGS`，建议直接把这个常量提取到 `llm.ts` 或共用。

### Mock provider 处理

当 `provider === 'mock'` 时，`llm.ts` 应直接返回一个纯文本消息（不调用任何 API），内容可以是 `"[Mock] 我是模拟 AI，无法执行真实对话。请配置 API Key。"`

---

## 3. `agent/agentLoop.ts` — 补充细节

### System Prompt 注入

```typescript
// 获取工作区根目录
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '未知';

// 在 messages 前面注入（不存入 this.messages，每次 chat 调用时拼接）
const systemMessage: Message = {
  role: 'system',
  content: `你是 Trans-Leaf，一个 VS Code 中的 AI 翻译助手。
你可以使用工具帮助用户完成翻译和代码相关任务。
当前工作区根目录: ${workspaceRoot}

规则：
- 对于翻译任务，优先使用 translateText 工具
- 修改文件前先用 readFile 了解内容
- 保持回答简洁，用中文交流（除非用户用英文）`
};
```

### 安全限制

```typescript
const MAX_ITERATIONS = 20;
let iterations = 0;

while (true) {
  if (++iterations > MAX_ITERATIONS) {
    this.callbacks.onError('Agent 循环次数超过限制（20次），已停止');
    this.callbacks.onDone();
    break;
  }
  // ...
}
```

### 用户确认机制

需要在 `AgentCallbacks` 中增加一个异步确认回调：

```typescript
export interface AgentCallbacks {
  // ... 方案中的其他回调
  onConfirmRequest(name: string, args: Record<string, any>): Promise<boolean>;
}
```

在 agentLoop 执行 tool 之前检查：

```typescript
const DANGEROUS_TOOLS = new Set(['writeFile', 'editFile', 'runCommand']);

for (const call of response.tool_calls) {
  if (DANGEROUS_TOOLS.has(call.name)) {
    const confirmed = await this.callbacks.onConfirmRequest(call.name, call.arguments);
    if (!confirmed) {
      toolResults.push({ tool_call_id: call.id, content: '用户拒绝了此操作', is_error: true });
      this.callbacks.onToolResult(call.name, '用户拒绝了此操作', true);
      continue;
    }
  }
  // 正常执行...
}
```

---

## 4. `agent/toolRegistry.ts` — 工厂函数

```typescript
// toolRegistry.ts 底部导出
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new TranslateTextTool());
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new SearchFilesTool());
  registry.register(new GrepContentTool());
  registry.register(new ListDirectoryTool());
  registry.register(new RunCommandTool());
  return registry;
}
```

---

## 5. Tools 实现补充

### 5.1 `translateText.ts`

复用现有翻译器：

```typescript
import { createTranslator } from '../../translator/index.js';
import { buildSimpleSelectionPrompt } from '../../engine/promptBuilder.js';

// execute 内部：
const translator = createTranslator();
const { systemPrompt, userPrompt } = buildSimpleSelectionPrompt(args.text, 'auto', args.targetLang);
const result = await translator.translateWithPrompt({ systemPrompt, userPrompt });
if (!result.success) throw new Error(result.error);
return result.text;
```

### 5.2 `readFile.ts`

```typescript
import * as vscode from 'vscode';
import * as path from 'path';

// 路径处理：相对路径基于工作区根目录解析
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
const absPath = path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot!, args.path);

const uri = vscode.Uri.file(absPath);
const bytes = await vscode.workspace.fs.readFile(uri);
const content = Buffer.from(bytes).toString('utf-8');

// 行号过滤
const lines = content.split('\n');
const start = (args.startLine ?? 1) - 1;
const end = args.endLine ?? lines.length;
return lines.slice(start, end).map((l, i) => `${start + i + 1}| ${l}`).join('\n');
```

### 5.3 `writeFile.ts`

```typescript
const uri = vscode.Uri.file(absPath);
await vscode.workspace.fs.writeFile(uri, Buffer.from(args.content, 'utf-8'));
return `File written: ${args.path}`;
```

### 5.4 `editFile.ts`

```typescript
const bytes = await vscode.workspace.fs.readFile(uri);
const content = Buffer.from(bytes).toString('utf-8');
if (!content.includes(args.oldText)) return 'Error: oldText not found in file';
const newContent = content.replace(args.oldText, args.newText);
await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf-8'));
return 'Edit applied successfully';
```

### 5.5 `searchFiles.ts`

```typescript
const files = await vscode.workspace.findFiles(args.pattern, '**/node_modules/**', 100);
return files.map(f => vscode.workspace.asRelativePath(f)).join('\n') || 'No files found';
```

### 5.6 `grepContent.ts`

```typescript
// 用 vscode.workspace.findFiles + 逐文件 readFile + 正则匹配
// 或直接用 child_process.exec('grep -rn ...') 更简单
import { exec } from 'child_process';
const cmd = `grep -rn "${args.pattern}" ${args.glob || '.'} --include="${args.glob || '*'}"`;
// 限制结果行数：maxResults 默认 50
```

### 5.7 `listDirectory.ts`

```typescript
const uri = vscode.Uri.file(absPath);
const entries = await vscode.workspace.fs.readDirectory(uri);
return entries.map(([name, type]) => {
  const prefix = type === vscode.FileType.Directory ? '[DIR]  ' : '       ';
  return `${prefix}${name}`;
}).join('\n');
// recursive 时递归调用，加缩进
```

### 5.8 `runCommand.ts`

```typescript
import { exec } from 'child_process';

return new Promise((resolve, reject) => {
  const cwd = args.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  exec(args.command, { cwd, timeout: 30000 }, (err, stdout, stderr) => {
    if (err && !stdout && !stderr) reject(err);
    else resolve((stdout + stderr).slice(0, 10000)); // 截断过长输出
  });
});
```

---

## 6. ChatView 改造 — 具体修改点

### 后端 `chatView.ts` 变更

**新增 import**（文件顶部）：

```typescript
import { AgentLoop } from '../agent/agentLoop.js';
import { createToolRegistry } from '../agent/toolRegistry.js';
import { getConfig } from '../utils/config.js';
```

**新增成员变量**（class 内部）：

```typescript
private agentLoop: AgentLoop;
private _pendingConfirm?: (confirmed: boolean) => void;
```

**在构造函数中初始化 agentLoop**（`this._panel.webview.html = ...` 之后）：

```typescript
this.agentLoop = new AgentLoop(getConfig(), createToolRegistry(), {
  onAssistantText: (text) => {
    this._panel.webview.postMessage({ type: 'assistant-text', text });
  },
  onToolCall: (name, args) => {
    this._panel.webview.postMessage({ type: 'tool-call', name, args });
  },
  onToolResult: (name, result, isError) => {
    this._panel.webview.postMessage({ type: 'tool-result', name, result, isError });
  },
  onConfirmRequest: (name, args) => {
    return new Promise((resolve) => {
      this._pendingConfirm = resolve;
      this._panel.webview.postMessage({ type: 'confirm', name, args });
    });
  },
  onDone: () => {
    this._panel.webview.postMessage({ type: 'done' });
  },
  onError: (error) => {
    this._panel.webview.postMessage({ type: 'error', error });
  },
});
```

**`_handleMessage` 修改**（替换现有的 `case 'translate'`）：

```typescript
case 'chat':
  // 新的 agent 对话模式
  await this.agentLoop.handleUserMessage(message.text);
  break;
case 'reset':
  this.agentLoop.reset();
  break;
case 'confirm-result':
  if (this._pendingConfirm) {
    this._pendingConfirm(message.confirmed);
    this._pendingConfirm = undefined;
  }
  break;
// 保留 translateSelection, translateFile, openSettings 不变
```

旧的 `case 'translate'` 和 `_handleTranslate` 方法可以删除，翻译功能由 agent 的 `translateText` tool 接管。

### 前端 JS 变更

**发送函数改为发 `chat` 消息**（替换 `send()` 中的 `vscode.postMessage`）：

```javascript
// 旧: vscode.postMessage({ type: 'translate', text, targetLang });
// 新:
vscode.postMessage({ type: 'chat', text });
```

可以移除语言切换 toggle（agent 自动识别意图），或保留作为偏好提示。

**新增 JS 辅助函数和变量**：

```javascript
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
let lastToolSlotId = null;
```

**新增消息类型处理**（在 `window.addEventListener('message', ...)` 中）：

```javascript
case 'assistant-text':
  removeTypingIndicator();
  if (message.text) addMessage('assistant', message.text);
  break;

case 'tool-call': {
  removeTypingIndicator();
  const toolEl = document.createElement('div');
  toolEl.className = 'tool-call';
  const toolId = 'tool-' + Date.now();

  const header = document.createElement('div');
  header.className = 'tool-header';
  header.textContent = '🔧 ' + message.name;
  const toggle = document.createElement('span');
  toggle.className = 'tool-toggle';
  toggle.textContent = '▶';
  header.appendChild(toggle);
  header.addEventListener('click', () => {
    toolEl.classList.toggle('expanded');
  });

  const body = document.createElement('div');
  body.className = 'tool-body';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(message.args, null, 2);
  body.appendChild(pre);
  const slot = document.createElement('div');
  slot.className = 'tool-result-slot';
  slot.id = toolId;
  body.appendChild(slot);

  toolEl.appendChild(header);
  toolEl.appendChild(body);
  messagesEl.appendChild(toolEl);
  lastToolSlotId = toolId;
  scrollToBottom();
  break;
}

case 'tool-result': {
  if (lastToolSlotId) {
    const slot = document.getElementById(lastToolSlotId);
    if (slot) {
      const pre = document.createElement('pre');
      pre.className = message.isError ? 'tool-error' : '';
      pre.textContent = message.result.slice(0, 2000);
      slot.appendChild(pre);
    }
  }
  scrollToBottom();
  break;
}

case 'confirm': {
  const yes = confirm(
    'AI 想要执行 ' + message.name + ':\n' +
    JSON.stringify(message.args, null, 2) + '\n\n是否允许？'
  );
  vscode.postMessage({ type: 'confirm-result', confirmed: yes });
  break;
}

case 'done':
  isTranslating = false;
  sendBtn.disabled = false;
  chatInput.focus();
  break;
```

### 新增 CSS 样式

```css
/* 工具调用面板 */
.tool-call {
  margin: 4px 0;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  overflow: hidden;
  font-size: 12px;
}
.tool-header {
  padding: 6px 10px;
  background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
}
.tool-body {
  display: none;
  padding: 8px 10px;
  max-height: 300px;
  overflow-y: auto;
}
.tool-call.expanded .tool-body { display: block; }
.tool-call.expanded .tool-toggle { transform: rotate(90deg); }
.tool-toggle { transition: transform 0.15s; font-size: 10px; }
.tool-body pre {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11px;
  margin: 0;
}
.tool-error { color: var(--vscode-errorForeground); }
```

---

## 7. 需注意的坑

1. **Claude tool_result 必须跟在对应 tool_use 之后**，且 role 是 `user` 而非 `tool`。多个 tool_call 的结果要合并到一条 user message 的 content 数组中。
2. **OpenAI tool_calls 的 arguments 是 JSON 字符串**，需要 `JSON.parse()`；Claude 的 input 已经是对象。
3. **CSP 策略**：现有 webview 有 `Content-Security-Policy`，内联 onclick 不允许。所有事件绑定必须用 `addEventListener`（现有代码已遵循此模式，上方前端代码也已按此方式编写）。
4. **发送消息后的 UI 状态管理**：
   - 用户点击发送 → `isTranslating = true`, `sendBtn.disabled = true`
   - 添加 typing indicator
   - 等待后端各种消息推送（`assistant-text`, `tool-call`, `tool-result` 交替出现）
   - 收到 `done` 时解锁输入框
