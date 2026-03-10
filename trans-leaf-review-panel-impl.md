# Trans-Leaf 翻译审阅面板 — Implementation

> 基于 [设计文档](./trans-leaf-review-panel-design.md) 的完整实现规格

---

## 目录

- [Phase 1: O1 选区翻译审阅](#phase-1-o1-选区翻译审阅)
  - [1.1 新增文件](#11-新增文件)
  - [1.2 修改文件](#12-修改文件)
  - [1.3 删除文件](#13-删除文件)
- [Phase 2: O2 全文分句翻译审阅](#phase-2-o2-全文分句翻译审阅)
  - [2.1 新增文件](#21-新增文件)
  - [2.2 修改文件](#22-修改文件)

---

## Phase 1: O1 选区翻译审阅

### 1.1 新增文件

#### `src/webview/reviewPanel.ts`

O1 选区审阅 WebviewPanel。

```typescript
import * as vscode from 'vscode';

/**
 * 初始化参数
 */
interface ReviewPanelOptions {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  /** 用户点击 "Write to File" 的回调 */
  onWrite: (text: string, saveToTM: boolean) => Promise<void>;
}

/**
 * 选区翻译审阅面板
 */
export class TranslationReviewPanel {
  private static currentPanel: TranslationReviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly options: ReviewPanelOptions
  ) {
    this._panel = panel;

    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case 'write-to-file':
            await this.options.onWrite(msg.text, msg.saveToTM);
            this._panel.dispose();
            break;
          case 'copy':
            await vscode.env.clipboard.writeText(msg.text);
            vscode.window.setStatusBarMessage('🍃 译文已复制到剪贴板', 3000);
            break;
          case 'close':
            this._panel.dispose();
            break;
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  /**
   * 创建或聚焦审阅面板
   */
  public static show(options: ReviewPanelOptions): TranslationReviewPanel {
    // 如果已有面板，销毁后重建（保证内容最新）
    if (TranslationReviewPanel.currentPanel) {
      TranslationReviewPanel.currentPanel._panel.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      'transLeafReview',
      'Translation Review',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    TranslationReviewPanel.currentPanel = new TranslationReviewPanel(panel, options);
    return TranslationReviewPanel.currentPanel;
  }

  private dispose(): void {
    TranslationReviewPanel.currentPanel = undefined;
    this._disposables.forEach(d => d.dispose());
  }

  private _getHtml(): string {
    const nonce = getNonce();
    const sourceLangLabel = this.options.sourceLang === 'zh-CN' ? '中文' : 'English';
    const targetLangLabel = this.options.targetLang === 'zh-CN' ? '中文' : 'English';

    // 对文本进行 HTML 转义
    const escapedSource = escapeHtml(this.options.sourceText);
    const escapedTarget = escapeHtml(this.options.translatedText);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* 顶栏 */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .header h2 {
      font-size: 14px;
      font-weight: 600;
    }
    .lang-badge {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    /* 双栏 */
    .panels {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel + .panel {
      border-left: 1px solid var(--vscode-widget-border);
    }
    .panel-title {
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .source-content {
      flex: 1;
      padding: 12px 16px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
    }
    .target-textarea {
      flex: 1;
      padding: 12px 16px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.6;
      resize: none;
      outline: none;
      overflow-y: auto;
    }

    /* 底栏 */
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-top: 1px solid var(--vscode-widget-border);
    }
    .tm-check {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .tm-check input[type="checkbox"] {
      accent-color: var(--vscode-focusBorder);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      padding: 5px 14px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
    }
    .btn:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    .btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>Translation Review</h2>
    <span class="lang-badge">${sourceLangLabel} → ${targetLangLabel}</span>
  </div>

  <div class="panels">
    <div class="panel">
      <div class="panel-title">Source</div>
      <div class="source-content">${escapedSource}</div>
    </div>
    <div class="panel">
      <div class="panel-title">Translation (editable)</div>
      <textarea class="target-textarea" id="targetText">${escapedTarget}</textarea>
    </div>
  </div>

  <div class="footer">
    <label class="tm-check">
      <input type="checkbox" id="saveToTM" />
      Save to TM
    </label>
    <div class="actions">
      <button class="btn" id="btnCopy">Copy</button>
      <button class="btn" id="btnCancel">Cancel</button>
      <button class="btn primary" id="btnWrite">Write to File</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const targetText = document.getElementById('targetText');
    const saveToTM = document.getElementById('saveToTM');

    document.getElementById('btnWrite').addEventListener('click', () => {
      vscode.postMessage({
        type: 'write-to-file',
        text: targetText.value,
        saveToTM: saveToTM.checked
      });
    });

    document.getElementById('btnCopy').addEventListener('click', () => {
      vscode.postMessage({ type: 'copy', text: targetText.value });
    });

    document.getElementById('btnCancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });

    targetText.focus();
  </script>
</body>
</html>`;
  }
}

/** HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 生成 nonce */
function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
```

**要点**：
- `show()` 静态方法创建面板，接收 `onWrite` 回调
- `ViewColumn.Beside`：在编辑器旁边打开，不遮挡原文件
- `enableScripts: true`：允许 WebView 内的 JS 执行
- 面板销毁时自动清除 `currentPanel` 引用
- HTML 内容做转义防止 XSS

---

#### `src/commands/translateAndReview.ts`

O1 命令逻辑，替代 `translateSelection.ts`。

```typescript
import * as vscode from 'vscode';
import { createTranslator } from '../translator/index.js';
import { detectLanguage } from '../lang/detector.js';
import { getConfig, openSettings } from '../utils/config.js';
import { buildSimpleSelectionPrompt } from '../engine/promptBuilder.js';
import { acquireLock, releaseLock } from '../utils/lock.js';
import { TranslationReviewPanel } from '../webview/reviewPanel.js';

/**
 * 翻译选中文本并打开审阅面板
 */
export async function translateAndReview(targetLang?: 'zh-CN' | 'en'): Promise<void> {
  // 如果没有指定目标语言，让用户选择
  if (!targetLang) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: '翻译并审阅 → 中文', value: 'zh-CN' as const },
        { label: 'Translate & Review → English', value: 'en' as const }
      ],
      { placeHolder: '选择翻译目标语言' }
    );
    if (!choice) {
      return;
    }
    targetLang = choice.value;
  }

  // 并发保护
  if (!acquireLock()) {
    vscode.window.showWarningMessage('翻译正在进行中，请等待完成或取消当前翻译');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    releaseLock();
    vscode.window.showWarningMessage('请先打开一个文件');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    releaseLock();
    vscode.window.showWarningMessage('请先选中要翻译的文本');
    return;
  }

  const selectedText = editor.document.getText(selection);
  if (!selectedText.trim()) {
    releaseLock();
    vscode.window.showWarningMessage('选中的文本为空');
    return;
  }

  // 保存原始引用，供后续 onWrite 使用
  const originalEditor = editor;
  const originalSelection = selection;
  const originalUri = editor.document.uri;

  try {
    const config = getConfig();

    // 检查 API Key（mock 除外）
    if (config.provider !== 'mock' && !config.apiKey) {
      const action = await vscode.window.showWarningMessage(
        '请先配置 API Key：点击 Trans-Leaf 状态栏 → 设置',
        '打开设置'
      );
      if (action === '打开设置') {
        openSettings();
      }
      return;
    }

    // 检测源语言
    const sourceLang = detectLanguage(selectedText);
    if (sourceLang === targetLang) {
      vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 源语言与目标语言相同，跳过翻译', 3000);
      return;
    }

    const finalSourceLang: 'zh-CN' | 'en' =
      sourceLang === 'unknown'
        ? (targetLang === 'zh-CN' ? 'en' : 'zh-CN')
        : sourceLang;

    // 创建翻译器
    const translator = createTranslator();

    // 显示进度
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '🍃 Trans-Leaf',
        cancellable: true
      },
      async (progress, token) => {
        progress.report({ message: '正在翻译...' });

        const { systemPrompt, userPrompt } = buildSimpleSelectionPrompt(
          selectedText,
          finalSourceLang,
          targetLang
        );

        const result = await translator.translateWithPrompt({
          systemPrompt,
          userPrompt
        });

        if (token.isCancellationRequested) {
          vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译已取消', 3000);
          return;
        }

        if (!result.success) {
          throw new Error(result.error || '翻译失败');
        }

        // ★ 不直接替换选区，而是打开审阅面板
        TranslationReviewPanel.show({
          sourceText: selectedText,
          translatedText: result.text,
          sourceLang: finalSourceLang,
          targetLang,
          onWrite: async (text: string, _saveToTM: boolean) => {
            // 写入文件：检查 editor 是否仍然有效
            const targetEditor = vscode.window.visibleTextEditors.find(
              e => e.document.uri.toString() === originalUri.toString()
            );

            if (!targetEditor) {
              vscode.window.showWarningMessage('原始编辑器已关闭，无法写入');
              return;
            }

            // 检查文档是否被修改（选区可能已失效）
            const currentText = targetEditor.document.getText(originalSelection);
            if (currentText !== selectedText) {
              const confirm = await vscode.window.showWarningMessage(
                '选区内容已发生变化，仍要写入吗？',
                '写入', '取消'
              );
              if (confirm !== '写入') {
                return;
              }
            }

            await targetEditor.edit(editBuilder => {
              editBuilder.replace(originalSelection, text);
            });

            vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 译文已写入文件', 3000);

            // saveToTM 预留 — 后续接入 MemoryManager
            // if (_saveToTM) {
            //   memoryManager.saveTM({ source: selectedText, target: text, ... });
            // }
          }
        });
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`翻译失败：${message}`);
  } finally {
    releaseLock();
  }
}
```

**要点**：
- 前半段校验逻辑完全复用 `translateSelection.ts`
- 区别：翻译完成后调用 `TranslationReviewPanel.show()` 而非 `editor.edit()`
- `onWrite` 回调中保存了 `originalEditor`、`originalSelection`、`originalUri` 三个原始引用
- 写入前检查：编辑器是否还在、选区内容是否已变化
- `saveToTM` 参数预留，当前空操作，后续 TM 实现后接入

---

### 1.2 修改文件

#### `extension.ts` — 完整目标代码

替换后的 `extension.ts` 全文如下。变更点用 `// ★ CHANGED` 标注：

```typescript
import * as vscode from 'vscode';
import { translateAndReview } from './commands/translateAndReview.js'; // ★ CHANGED: was translateSelection
import { translateFile } from './commands/translateFile.js';
import { openSettings } from './utils/config.js';
import { ChatView } from './webview/chatView.js';

/**
 * Plugin activation function
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Trans-Leaf plugin activated');

  // Register chat sidebar view
  let chatView: ChatView | undefined;

  const chatViewProvider = vscode.window.registerWebviewViewProvider(
    'transLeaf.chatView',
    {
      resolveWebviewView: (webviewView) => {
        chatView = new ChatView(context.extensionUri, webviewView);
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri) {
          setTimeout(() => chatView?.updateActiveFile(activeUri), 500);
        }
      }
    },
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );

  // Listen for active editor changes
  const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && chatView) {
      chatView.updateActiveFile(editor.document.uri);
    }
  });

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(leaf) Trans-Leaf';
  statusBarItem.tooltip = 'Trans-Leaf Translation Plugin';
  statusBarItem.command = 'transLeaf.showMenu';
  statusBarItem.show();

  // Register status bar menu command
  const showMenuCommand = vscode.commands.registerCommand(
    'transLeaf.showMenu',
    async () => {
      const options = [
        { label: '$(file-text) Translate File to Chinese', value: 'translateFileToZh' },
        { label: '$(file-text) Translate File to English', value: 'translateFileToEn' },
        { label: '$(gear) Settings', value: 'settings' }
      ];

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'Trans-Leaf Menu'
      });

      if (choice?.value === 'translateFileToZh') {
        await vscode.commands.executeCommand('transLeaf.translateFileToZh');
      } else if (choice?.value === 'translateFileToEn') {
        await vscode.commands.executeCommand('transLeaf.translateFileToEn');
      } else if (choice?.value === 'settings') {
        openSettings();
      }
    }
  );

  // ★ CHANGED: Register translate & review to Chinese (O1, replaces translateSelectionToZh)
  const translateAndReviewToZhCommand = vscode.commands.registerCommand(
    'transLeaf.translateAndReviewToZh',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateAndReview('zh-CN');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // ★ CHANGED: Register translate & review to English (O1, replaces translateSelectionToEn)
  const translateAndReviewToEnCommand = vscode.commands.registerCommand(
    'transLeaf.translateAndReviewToEn',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateAndReview('en');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // Register translate full file to Chinese command
  const translateFileToZhCommand = vscode.commands.registerCommand(
    'transLeaf.translateFileToZh',
    async () => {
      statusBarItem.text = '$(sync~spin) 翻译中...';
      try {
        await translateFile('zh-CN');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // Register translate full file to English command
  const translateFileToEnCommand = vscode.commands.registerCommand(
    'transLeaf.translateFileToEn',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateFile('en');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // Register write translation result command
  const writeTranslationCommand = vscode.commands.registerCommand(
    'transLeaf.writeTranslation',
    async (translation: string) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await editor.edit((editBuilder) => {
          editBuilder.replace(editor.selection, translation);
        });
        vscode.window.showInformationMessage('Translation result written to file');
      }
    }
  );

  // ★ CHANGED: subscriptions updated
  context.subscriptions.push(
    statusBarItem,
    showMenuCommand,
    translateAndReviewToZhCommand,   // ★ was translateSelectionToZhCommand
    translateAndReviewToEnCommand,   // ★ was translateSelectionToEnCommand
    translateFileToZhCommand,
    translateFileToEnCommand,
    chatViewProvider,
    activeEditorDisposable,
    writeTranslationCommand
  );
}

/**
 * Plugin deactivation function
 */
export function deactivate() {
  console.log('Trans-Leaf plugin deactivated');
}
```

> **变更汇总**：共 4 处变更，全部用 `★ CHANGED` 标注。`translateFile` 命令的 setTimeout 冗余赋值也一并清理。

---

#### `package.json` — contributes 完整替换

将 `package.json` 中 `"contributes"` 下的 `commands`、`menus`、`keybindings` 替换为以下内容（其余字段不变）：

```jsonc
"commands": [
  {
    "command": "transLeaf.translateAndReviewToZh",
    "title": "Trans-Leaf: 翻译并审阅 → 中文"
  },
  {
    "command": "transLeaf.translateAndReviewToEn",
    "title": "Trans-Leaf: Translate & Review → English"
  },
  {
    "command": "transLeaf.translateFileToZh",
    "title": "Trans-Leaf: 翻译全文为中文"
  },
  {
    "command": "transLeaf.translateFileToEn",
    "title": "Trans-Leaf: Translate File to English"
  },
  {
    "command": "transLeaf.showMenu",
    "title": "Trans-Leaf: 显示菜单"
  },
  {
    "command": "transLeaf.writeTranslation",
    "title": "Trans-Leaf: 写入翻译结果"
  }
],
"menus": {
  "editor/context": [
    {
      "submenu": "transLeaf.translateSubMenu",
      "when": "editorHasSelection",
      "group": "1_modification@1"
    }
  ],
  "transLeaf.translateSubMenu": [
    {
      "command": "transLeaf.translateAndReviewToZh",
      "group": "1_review@1"
    },
    {
      "command": "transLeaf.translateAndReviewToEn",
      "group": "1_review@2"
    }
  ]
},
"keybindings": [
  {
    "command": "transLeaf.translateAndReviewToZh",
    "key": "ctrl+alt+t",
    "when": "editorHasSelection"
  },
  {
    "command": "transLeaf.translateFileToZh",
    "key": "ctrl+alt+shift+t",
    "when": "editorTextFocus"
  }
]
```

**变更说明**：
- `translateSelectionToZh/En` → `translateAndReviewToZh/En`（命令 ID + title 都改）
- 子菜单 group 从 `1_lang` 改为 `1_review`（语义更准确）
- `keybindings` 中 `ctrl+alt+t` 绑定到 O1

---

#### `chatView.ts` 修改

`chatView.ts:131-136` 中引用了旧命令 ID，需替换：

```typescript
// chatView.ts 第 130-136 行，_handleMessage 中的 'translateSelection' case
case 'translateSelection':
  await vscode.commands.executeCommand(
    message.targetLang === 'zh-CN'
      ? 'transLeaf.translateAndReviewToZh'    // ★ was translateSelectionToZh
      : 'transLeaf.translateAndReviewToEn'    // ★ was translateSelectionToEn
  );
  break;
```

---

### 1.3 删除文件

| 文件 | 操作 |
|------|------|
| `src/commands/translateSelection.ts` | **删除** |

---

### Phase 1 编译验证 Checklist

```bash
npm run compile   # esbuild 编译通过
npm run lint      # tsc --noEmit 类型检查通过
```

手动验证：
1. F5 启动扩展，打开任意文件
2. 选中一段文本，右键 → "Trans-Leaf 翻译" → "翻译并审阅 → 中文"
3. 确认弹出 WebviewPanel，左侧原文，右侧可编辑译文
4. 编辑译文 → 点击 "Write to File" → 确认选区已替换
5. 测试 "Copy" → 确认译文复制到剪贴板
6. 测试 "Cancel" → 确认面板关闭、选区未变
7. 快捷键 `Ctrl+Alt+T` 验证
8. Chat 侧栏 chip "翻译选中 → 中文" 验证

---

## Phase 2: O2 全文分句翻译审阅

### 2.1 新增文件

#### `src/commands/translateFileReview.ts`

O2 命令入口 + 分句算法。

```typescript
import * as vscode from 'vscode';
import { detectLanguage } from '../lang/detector.js';
import { getConfig, openSettings } from '../utils/config.js';
import { acquireLock, releaseLock } from '../utils/lock.js';
import { FileReviewPanel } from '../webview/fileReviewPanel.js';

/**
 * 分句数据结构
 */
export interface Sentence {
  index: number;
  source: string;
  target: string;
  translatable: boolean;
  status: 'untranslated' | 'translating' | 'translated' | 'edited';
  /**
   * 行位置信息，用于 saveAsFile 时还原原始格式
   * - lineIndex: 该句来自原文第几行（0-based）
   * - isWholeLine: 该句是否独占整行（标题/列表/空行/代码块等）
   *   为 true 时重组直接按行输出；
   *   为 false 时同一行内的多个句子用空格拼接还原为一行
   */
  lineIndex: number;
  isWholeLine: boolean;
}

/**
 * 全文分句翻译审阅命令
 */
export async function translateFileReview(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('请先打开一个文件');
    return;
  }

  // 选择目标语言
  const choice = await vscode.window.showQuickPick(
    [
      { label: '翻译为中文', value: 'zh-CN' as const },
      { label: 'Translate to English', value: 'en' as const }
    ],
    { placeHolder: '选择翻译目标语言' }
  );
  if (!choice) {
    return;
  }
  const targetLang = choice.value;

  const config = getConfig();

  // 检查 API Key
  if (config.provider !== 'mock' && !config.apiKey) {
    const action = await vscode.window.showWarningMessage(
      '请先配置 API Key',
      '打开设置'
    );
    if (action === '打开设置') {
      openSettings();
    }
    return;
  }

  const fullText = editor.document.getText();
  const fileName = editor.document.fileName.split(/[\\/]/).pop() || 'untitled';
  const languageId = editor.document.languageId;

  // 检测源语言
  const sourceLang = detectLanguage(fullText);
  const finalSourceLang: 'zh-CN' | 'en' =
    sourceLang === 'unknown'
      ? (targetLang === 'zh-CN' ? 'en' : 'zh-CN')
      : sourceLang === targetLang
        ? (targetLang === 'zh-CN' ? 'en' : 'zh-CN')
        : sourceLang;

  // 分句
  const sentences = splitIntoSentences(fullText, languageId);

  // 打开审阅面板
  FileReviewPanel.show({
    sentences,
    sourceLang: finalSourceLang,
    targetLang,
    fileName,
    concurrency: config.concurrency,
  });
}

/**
 * 将全文分割为句子列表
 *
 * 规则：
 * - 代码块（```...```）：整块为一个不可翻译行
 * - 空行：独立行，不可翻译
 * - Markdown 标题（# ...）：独立行，可翻译
 * - 列表项（- ... / 1. ...）：每项独立行，可翻译
 * - 表格行（| ... |）：每行独立行，可翻译
 * - 其余文本：按标点断句
 */
export function splitIntoSentences(text: string, languageId: string): Sentence[] {
  const lines = text.split('\n');
  const sentences: Sentence[] = [];
  let index = 0;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- 代码块处理 ---
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLines = [line];
        codeBlockStartLine = i;
      } else {
        codeBlockLines.push(line);
        sentences.push({
          index: index++,
          source: codeBlockLines.join('\n'),
          target: '',
          translatable: false,
          status: 'untranslated',
          lineIndex: codeBlockStartLine,
          isWholeLine: true,
        });
        codeBlockLines = [];
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // --- 空行 ---
    if (line.trim() === '') {
      sentences.push({
        index: index++,
        source: '',
        target: '',
        translatable: false,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // --- Markdown 标题 ---
    if (/^#{1,6}\s/.test(line)) {
      sentences.push({
        index: index++,
        source: line,
        target: '',
        translatable: true,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // --- 列表项 ---
    if (/^(\s*[-*+]\s|\s*\d+\.\s)/.test(line)) {
      sentences.push({
        index: index++,
        source: line,
        target: '',
        translatable: true,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // --- 表格行 ---
    if (/^\|.*\|$/.test(line.trim())) {
      const isSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());
      sentences.push({
        index: index++,
        source: line,
        target: '',
        translatable: !isSeparator,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // --- 普通文本：按标点断句 ---
    const subSentences = splitByPunctuation(line);
    // 单句 → 独占整行；多句 → 同属一行，isWholeLine = false
    const wholeLine = subSentences.length === 1;
    for (const s of subSentences) {
      sentences.push({
        index: index++,
        source: s,
        target: '',
        translatable: true,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: wholeLine,
      });
    }
  }

  // 处理未闭合代码块
  if (inCodeBlock && codeBlockLines.length > 0) {
    sentences.push({
      index: index++,
      source: codeBlockLines.join('\n'),
      target: '',
      translatable: false,
      status: 'untranslated',
      lineIndex: codeBlockStartLine,
      isWholeLine: true,
    });
  }

  return sentences;
}

/**
 * 按标点符号断句
 *
 * 中文断句：。！？；（句末）
 * 英文断句：. ! ?（后跟空格或行尾，排除缩写词）
 */
function splitByPunctuation(text: string): string[] {
  // 英文缩写词集合（不作为断句依据）
  const abbreviations = new Set([
    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.',
    'etc.', 'vs.', 'i.e.', 'e.g.', 'U.S.', 'UK.',
    'No.', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Jun.',
    'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.',
    'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.', 'Sun.',
  ]);

  /**
   * 判断英文句号是否为缩写词的一部分
   */
  function isAbbreviation(text: string, dotIndex: number): boolean {
    // 向前获取可能的缩写词（最多 10 个字符）
    const start = Math.max(0, dotIndex - 10);
    const word = text.slice(start, dotIndex + 1); // 包含句号

    // 检查是否在缩写词集合中
    if (abbreviations.has(word)) {
      return true;
    }

    // 检查是否为单个字母后跟句号（如 A. B. C.）
    const singleLetter = text.slice(dotIndex - 1, dotIndex + 1);
    if (/^[A-Za-z]\.$/.test(singleLetter)) {
      return true;
    }

    return false;
  }

  const results: string[] = [];
  let lastIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1] || '';

    // 中文句末标点：直接断句
    if (/[。！？；]/.test(char)) {
      const sentence = text.slice(lastIndex, i + 1).trim();
      if (sentence) {
        results.push(sentence);
      }
      lastIndex = i + 1;
      continue;
    }

    // 英文句末标点：需检查是否为缩写词
    if (/[.!?]/.test(char) && (nextChar === ' ' || nextChar === '\n' || !nextChar)) {
      // 检查是否为缩写词
      if (!isAbbreviation(text, i)) {
        const sentence = text.slice(lastIndex, i + 1).trim();
        if (sentence) {
          results.push(sentence);
        }
        lastIndex = i + 1;
      }
    }
  }

  // 剩余文本
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    results.push(remaining);
  }

  return results.length > 0 ? results : [text];
}
```

**要点**：
- `splitIntoSentences` 先处理结构元素（代码块、空行、标题、列表、表格），再对普通文本调用 `splitByPunctuation`
- 代码块用状态机跟踪 `` ``` `` 开合
- `splitByPunctuation` 使用正则区分中文句末（。！？；）和英文句末（.!? + 空格/行尾）
- 表格分隔行（`|---|---|`）标记为 `translatable: false`

---

#### `src/webview/fileReviewPanel.ts`

O2 全文分句审阅面板。

```typescript
import * as vscode from 'vscode';
import { createTranslator } from '../translator/index.js';
import { buildSimpleSelectionPrompt } from '../engine/promptBuilder.js';
import { getConfig } from '../utils/config.js';
import type { Sentence } from '../commands/translateFileReview.js';

interface FileReviewOptions {
  sentences: Sentence[];
  sourceLang: 'zh-CN' | 'en';
  targetLang: 'zh-CN' | 'en';
  fileName: string;
  concurrency: number;
}

/**
 * 全文分句审阅面板
 */
export class FileReviewPanel {
  private static currentPanel: FileReviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private sentences: Sentence[];
  private options: FileReviewOptions;
  private translator: import('../translator/types.js').Translator;
  /** 批次字节上限（约 1000-1500 tokens），确保不截断完整句子 */
  private readonly MAX_BATCH_BYTES = 4000;

  private constructor(
    panel: vscode.WebviewPanel,
    options: FileReviewOptions
  ) {
    this._panel = panel;
    this.options = options;
    this.sentences = options.sentences;
    this.translator = createTranslator();

    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case 'translate-sentence':
            await this.translateSentence(msg.index);
            break;
          case 'translate-all':
            await this.translateAll();
            break;
          case 'update-target':
            this.updateTarget(msg.index, msg.target);
            break;
          case 'save-as-file':
            await this.saveAsFile(msg.saveToTM);
            break;
          case 'close':
            this._panel.dispose();
            break;
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static show(options: FileReviewOptions): FileReviewPanel {
    if (FileReviewPanel.currentPanel) {
      FileReviewPanel.currentPanel._panel.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      'transLeafFileReview',
      `Review: ${options.fileName}`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    FileReviewPanel.currentPanel = new FileReviewPanel(panel, options);
    return FileReviewPanel.currentPanel;
  }

  private dispose(): void {
    FileReviewPanel.currentPanel = undefined;
    this._disposables.forEach(d => d.dispose());
  }

  /**
   * 翻译单句
   */
  private async translateSentence(index: number): Promise<void> {
    const sentence = this.sentences[index];
    if (!sentence || !sentence.translatable || sentence.status === 'translating') {
      return;
    }

    sentence.status = 'translating';
    this._panel.webview.postMessage({
      type: 'sentence-updated',
      index,
      target: '',
      status: 'translating',
    });

    try {
      const translator = this.translator;

      // 取上下文：前后各 2 句可翻译句作为参考
      const context = this.getContext(index, 2);
      const contextNote = context
        ? `\n\n参考上下文：\n${context}`
        : '';

      const { systemPrompt, userPrompt } = buildSimpleSelectionPrompt(
        sentence.source,
        this.options.sourceLang,
        this.options.targetLang
      );

      const result = await translator.translateWithPrompt({
        systemPrompt: systemPrompt + contextNote,
        userPrompt,
      });

      if (result.success) {
        sentence.target = result.text;
        sentence.status = 'translated';
      } else {
        sentence.status = 'untranslated';
        vscode.window.showErrorMessage(`第 ${index + 1} 句翻译失败：${result.error}`);
      }
    } catch (error) {
      sentence.status = 'untranslated';
      const msg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`第 ${index + 1} 句翻译失败：${msg}`);
    }

    this._panel.webview.postMessage({
      type: 'sentence-updated',
      index,
      target: sentence.target,
      status: sentence.status,
    });
  }

  /**
   * 获取上下文（前后各 n 句可翻译句的原文）
   */
  private getContext(index: number, n: number): string {
    const parts: string[] = [];

    // 前 n 句
    let count = 0;
    for (let i = index - 1; i >= 0 && count < n; i--) {
      if (this.sentences[i].translatable) {
        parts.unshift(this.sentences[i].source);
        count++;
      }
    }

    // 后 n 句
    count = 0;
    for (let i = index + 1; i < this.sentences.length && count < n; i++) {
      if (this.sentences[i].translatable) {
        parts.push(this.sentences[i].source);
        count++;
      }
    }

    return parts.join('\n');
  }

  /**
   * 翻译所有未翻译的句子
   *
   * 策略：
   * 1. 将未翻译句按字节数量分成批次（每批最多 MAX_BATCH_BYTES 字节）
   * 2. 用 concurrency pool 控制并发（标准 semaphore 模式）
   * 3. 批次翻译失败时 fallback 到逐句翻译
   * 4. 复用同一个 translator 实例
   */
  private async translateAll(): Promise<void> {
    const concurrency = this.options.concurrency;

    // ★ 复用类级别的 translator 实例
    const translator = this.translator;

    // 筛选未翻译且可翻译的句子
    const pending = this.sentences.filter(
      s => s.translatable && s.status === 'untranslated'
    );

    if (pending.length === 0) {
      vscode.window.setStatusBarMessage('🍃 所有句子已翻译', 3000);
      return;
    }

    /**
     * 按字节数量分批（确保不截断完整句子）
     */
    const batches: Sentence[][] = [];
    let currentBatch: Sentence[] = [];
    let currentBytes = 0;

    for (const s of pending) {
      const sentenceBytes = new TextEncoder().encode(s.source).length;

      // 检查加入当前句子后是否超限
      if (currentBytes + sentenceBytes > this.MAX_BATCH_BYTES && currentBatch.length > 0) {
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

    // 标记所有待翻译句为 translating
    for (const s of pending) {
      s.status = 'translating';
      this._panel.webview.postMessage({
        type: 'sentence-updated',
        index: s.index,
        target: '',
        status: 'translating',
      });
    }

    let completed = 0;
    const total = pending.length;

    /** 翻译单句（供单句翻译和 fallback 共用） */
    const translateSingle = async (s: Sentence): Promise<void> => {
      try {
        const { systemPrompt, userPrompt } = buildSimpleSelectionPrompt(
          s.source, this.options.sourceLang, this.options.targetLang
        );
        const result = await translator.translateWithPrompt({ systemPrompt, userPrompt });
        if (result.success) {
          s.target = result.text;
          s.status = 'translated';
        } else {
          s.status = 'untranslated';
        }
      } catch {
        s.status = 'untranslated';
      }
      completed++;
      this._panel.webview.postMessage({
        type: 'sentence-updated',
        index: s.index,
        target: s.target,
        status: s.status,
      });
      this._panel.webview.postMessage({
        type: 'batch-progress',
        completed,
        total,
      });
    };

    /** 翻译一个批次 */
    const translateBatch = async (batch: Sentence[]): Promise<void> => {
      if (batch.length === 1) {
        await translateSingle(batch[0]);
        return;
      }

      // 多句合并翻译
      const combined = batch.map(s => s.source).join('\n---\n');
      const sourceLangName = this.options.sourceLang === 'zh-CN' ? '中文' : '英文';
      const targetLangName = this.options.targetLang === 'zh-CN' ? '中文' : '英文';

      const systemPrompt = `你是一位专业翻译。请将以下${sourceLangName}文本逐句翻译为${targetLangName}。
输入共 ${batch.length} 句，用 "---" 分隔。
请严格输出 ${batch.length} 句译文，同样用 "---" 分隔。严格保留原文格式。只输出译文。`;

      try {
        const result = await translator.translateWithPrompt({
          systemPrompt,
          userPrompt: combined,
        });

        if (result.success) {
          const parts = result.text.split(/\n?---\n?/);

          // ★ 验证：AI 返回的句数是否匹配
          if (parts.length === batch.length) {
            // 匹配成功，直接赋值
            for (let i = 0; i < batch.length; i++) {
              const s = batch[i];
              const translated = parts[i].trim();
              if (translated) {
                s.target = translated;
                s.status = 'translated';
              } else {
                s.status = 'untranslated';
              }
              completed++;
              this._panel.webview.postMessage({
                type: 'sentence-updated',
                index: s.index,
                target: s.target,
                status: s.status,
              });
              this._panel.webview.postMessage({
                type: 'batch-progress',
                completed,
                total,
              });
            }
          } else {
            // ★ Fallback：句数不匹配，回退到逐句翻译
            console.warn(
              `Batch translation returned ${parts.length} parts, expected ${batch.length}. Falling back to single.`
            );
            for (const s of batch) {
              s.status = 'untranslated'; // 重置状态
            }
            for (const s of batch) {
              await translateSingle(s);
            }
          }
        } else {
          // ★ Fallback：API 调用失败，回退到逐句翻译
          for (const s of batch) {
            s.status = 'untranslated';
          }
          for (const s of batch) {
            await translateSingle(s);
          }
        }
      } catch {
        // ★ Fallback：异常，回退到逐句翻译
        for (const s of batch) {
          s.status = 'untranslated';
        }
        for (const s of batch) {
          await translateSingle(s);
        }
      }
    };

    // ★ 标准并发池（Semaphore 模式）
    let running = 0;
    let batchIndex = 0;
    await new Promise<void>((resolveAll) => {
      const tryNext = (): void => {
        while (running < concurrency && batchIndex < batches.length) {
          const batch = batches[batchIndex++];
          running++;
          translateBatch(batch).finally(() => {
            running--;
            if (batchIndex >= batches.length && running === 0) {
              resolveAll();
            } else {
              tryNext();
            }
          });
        }
        // 边界：如果没有任何批次需要处理
        if (batches.length === 0) {
          resolveAll();
        }
      };
      tryNext();
    });

    vscode.window.setStatusBarMessage(`🍃 翻译完成：${completed}/${total} 句`, 3000);
  }

  /**
   * 用户编辑了译文
   */
  private updateTarget(index: number, target: string): void {
    const sentence = this.sentences[index];
    if (sentence) {
      sentence.target = target;
      if (sentence.status === 'translated') {
        sentence.status = 'edited';
      }
    }
  }

  /**
   * 另存为文件
   *
   * 重组逻辑：按 lineIndex 分组，同一行内的多个句子用空格拼接还原。
   * isWholeLine=true 的句子独占一行输出。
   */
  private async saveAsFile(_saveToTM: boolean): Promise<void> {
    // ★ 检查未翻译句数，提示用户
    const untranslated = this.sentences.filter(s => s.translatable && !s.target);
    if (untranslated.length > 0) {
      const translatable = this.sentences.filter(s => s.translatable);
      const choice = await vscode.window.showWarningMessage(
        `还有 ${untranslated.length}/${translatable.length} 句未翻译，未翻译的句子将保留原文。`,
        '继续导出', '取消'
      );
      if (choice !== '继续导出') {
        return;
      }
    }

    // 按 lineIndex 分组
    const lineMap = new Map<number, Sentence[]>();
    for (const s of this.sentences) {
      if (!lineMap.has(s.lineIndex)) {
        lineMap.set(s.lineIndex, []);
      }
      lineMap.get(s.lineIndex)!.push(s);
    }

    // 按 lineIndex 排序，逐行重组
    const sortedLines = [...lineMap.entries()].sort((a, b) => a[0] - b[0]);
    const outputLines: string[] = [];

    for (const [, group] of sortedLines) {
      // group 中的 sentences 按 index 排序（保证同一行内顺序）
      group.sort((a, b) => a.index - b.index);

      if (group[0].isWholeLine) {
        // 独占整行：直接输出（代码块可能含多行 \n，直接输出 source/target）
        const s = group[0];
        if (s.translatable && s.target) {
          outputLines.push(s.target);
        } else {
          outputLines.push(s.source);
        }
      } else {
        // 同一行内多个断句：用空格拼接还原
        const parts = group.map(s => {
          if (s.translatable && s.target) {
            return s.target;
          }
          return s.source;
        });
        outputLines.push(parts.join(' '));
      }
    }

    const resultText = outputLines.join('\n');

    // 推断默认文件名
    const ext = this.options.fileName.includes('.')
      ? '.' + this.options.fileName.split('.').pop()
      : '';
    const baseName = this.options.fileName.replace(/\.[^.]+$/, '');
    const defaultName = `${baseName}.${this.options.targetLang}${ext}`;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultName),
      filters: {
        'All Files': ['*']
      }
    });

    if (!uri) {
      return;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(resultText, 'utf-8'));
    vscode.window.showInformationMessage(`🍃 译文已保存：${uri.fsPath}`);

    // saveToTM 预留
    // if (_saveToTM) { ... }
  }

  /**
   * 生成 HTML
   */
  private _getHtml(): string {
    const nonce = getNonce();
    const sourceLangLabel = this.options.sourceLang === 'zh-CN' ? '中文' : 'English';
    const targetLangLabel = this.options.targetLang === 'zh-CN' ? '中文' : 'English';

    // 序列化句子数据给前端（lineIndex/isWholeLine 仅 Extension 侧使用，不传前端）
    const sentencesJson = JSON.stringify(this.sentences.map(s => ({
      index: s.index,
      source: s.source,
      translatable: s.translatable,
      target: s.target,
      status: s.status,
    })));

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--vscode-widget-border);
      flex-shrink: 0;
    }
    .header h2 { font-size: 14px; font-weight: 600; }
    .header-info { font-size: 12px; color: var(--vscode-descriptionForeground); }

    .table-container {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }
    .table-container::-webkit-scrollbar { width: 6px; }
    .table-container::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 3px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      z-index: 1;
      padding: 8px 12px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid var(--vscode-widget-border);
    }
    th:first-child { width: 40px; text-align: center; }
    th:last-child { width: 50px; text-align: center; }
    td {
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
      vertical-align: top;
      font-size: 13px;
      line-height: 1.5;
    }
    td:first-child {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    td:last-child { text-align: center; }

    tr.untranslatable {
      background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.05));
      color: var(--vscode-descriptionForeground);
    }
    tr.translated {
      background: rgba(40, 167, 69, 0.06);
    }
    tr.translating {
      background: rgba(0, 123, 255, 0.06);
    }
    tr.edited {
      background: rgba(255, 193, 7, 0.06);
    }

    .source-cell {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .target-cell {
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 20px;
      cursor: text;
    }
    .target-cell:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
      border-radius: 2px;
    }

    .btn-translate {
      padding: 2px 8px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 11px;
      cursor: pointer;
    }
    .btn-translate:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .btn-translate:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .loading {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-top: 1px solid var(--vscode-widget-border);
      flex-shrink: 0;
    }
    .progress-text {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .footer-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .tm-check {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      padding: 5px 14px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
    }
    .btn:hover { background: var(--vscode-list-hoverBackground); }
    .btn:disabled { opacity: 0.3; cursor: default; }
    .btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="header">
    <h2>File Translation Review</h2>
    <span class="header-info">${escapeHtml(this.options.fileName)} &nbsp; ${sourceLangLabel} → ${targetLangLabel}</span>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Source</th>
          <th>Translation</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <div class="footer">
    <span class="progress-text" id="progressText">已翻译 0/0 句</span>
    <div class="footer-right">
      <button class="btn" id="btnTranslateAll">全部翻译</button>
      <label class="tm-check">
        <input type="checkbox" id="saveToTM" />
        Save all to TM
      </label>
      <div class="actions">
        <button class="btn" id="btnCancel">Cancel</button>
        <button class="btn primary" id="btnSaveAs">Save As File</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const sentences = ${sentencesJson};
    const tbody = document.getElementById('tableBody');

    // 渲染表格
    function render() {
      tbody.innerHTML = '';
      for (const s of sentences) {
        const tr = document.createElement('tr');
        tr.id = 'row-' + s.index;
        tr.className = s.translatable ? s.status : 'untranslatable';

        // 行号
        const tdNum = document.createElement('td');
        tdNum.textContent = String(s.index + 1);
        tr.appendChild(tdNum);

        // 原文
        const tdSource = document.createElement('td');
        tdSource.className = 'source-cell';
        tdSource.textContent = s.source || '(empty)';
        tr.appendChild(tdSource);

        // 译文
        const tdTarget = document.createElement('td');
        tdTarget.className = 'target-cell';
        if (s.translatable) {
          tdTarget.contentEditable = 'true';
          tdTarget.textContent = s.target || '';
          tdTarget.addEventListener('blur', () => {
            const newText = tdTarget.textContent || '';
            if (newText !== s.target) {
              s.target = newText;
              s.status = s.target ? 'edited' : 'untranslated';
              vscode.postMessage({ type: 'update-target', index: s.index, target: newText });
              updateRowClass(s);
              updateProgress();
            }
          });
        } else {
          tdTarget.textContent = s.source || '';
          tdTarget.style.color = 'var(--vscode-descriptionForeground)';
        }
        tr.appendChild(tdTarget);

        // 操作
        const tdAction = document.createElement('td');
        if (s.translatable) {
          const btn = document.createElement('button');
          btn.className = 'btn-translate';
          btn.id = 'btn-' + s.index;
          btn.textContent = '▶';
          btn.title = '翻译此句';
          btn.addEventListener('click', () => {
            vscode.postMessage({ type: 'translate-sentence', index: s.index });
          });
          tdAction.appendChild(btn);
        } else {
          tdAction.textContent = '🔒';
        }
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
      }
      updateProgress();
    }

    function updateRowClass(s) {
      const tr = document.getElementById('row-' + s.index);
      if (tr) {
        tr.className = s.translatable ? s.status : 'untranslatable';
      }
    }

    function updateProgress() {
      const translatable = sentences.filter(s => s.translatable);
      const translated = translatable.filter(s => s.status === 'translated' || s.status === 'edited');
      document.getElementById('progressText').textContent =
        '已翻译 ' + translated.length + '/' + translatable.length + ' 句';
    }

    // 监听 Extension 消息
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'sentence-updated': {
          const s = sentences.find(x => x.index === msg.index);
          if (s) {
            s.target = msg.target;
            s.status = msg.status;
            updateRowClass(s);

            // 更新 UI
            const tr = document.getElementById('row-' + s.index);
            if (tr) {
              const tdTarget = tr.children[2];
              if (msg.status === 'translating') {
                tdTarget.innerHTML = '<span class="loading"></span>';
              } else {
                tdTarget.textContent = s.target || '';
              }

              const btn = document.getElementById('btn-' + s.index);
              if (btn) {
                btn.disabled = msg.status === 'translating';
              }
            }
            updateProgress();
          }
          break;
        }
        case 'batch-progress': {
          // 进度已由 sentence-updated 逐句更新，此处可用于额外 UI
          break;
        }
      }
    });

    // 按钮事件
    document.getElementById('btnTranslateAll').addEventListener('click', () => {
      vscode.postMessage({ type: 'translate-all' });
    });
    document.getElementById('btnCancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });
    document.getElementById('btnSaveAs').addEventListener('click', () => {
      vscode.postMessage({
        type: 'save-as-file',
        saveToTM: document.getElementById('saveToTM').checked
      });
    });

    // 初始渲染
    render();
  </script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
```

**要点**：
- 翻译逻辑在 Extension 侧（不在 WebView 内），WebView 只负责 UI 展示和事件转发
- 单句翻译：获取前后各 2 句上下文辅助
- 全部翻译：分批（每批 8 句），合并为一次 API 调用，用 `---` 分隔
- 并发控制：复用 `config.concurrency`
- 译文编辑：`contentEditable` + `blur` 事件同步回 Extension
- 另存为文件：遍历 sentences，有译文用译文，无译文用原文

---

### 2.2 修改文件

#### `extension.ts` — Phase 2 追加

在 Phase 1 的 `extension.ts` 基础上追加 3 处变更：

**1. 顶部新增 import（第 3 行后追加）：**

```typescript
import { translateFileReview } from './commands/translateFileReview.js';
```

**2. showMenu 追加 O2 入口（`showMenuCommand` 的 options 数组中，Settings 前插入）：**

```typescript
const options = [
  { label: '$(file-text) Translate File to Chinese', value: 'translateFileToZh' },
  { label: '$(file-text) Translate File to English', value: 'translateFileToEn' },
  { label: '$(table) 分句翻译审阅', value: 'translateFileReview' },  // ★ NEW
  { label: '$(gear) Settings', value: 'settings' }
];

// choice 处理中追加（在 settings 分支前）：
} else if (choice?.value === 'translateFileReview') {
  await vscode.commands.executeCommand('transLeaf.translateFileReview');
}
```

**3. 新增命令注册 + subscriptions（在 `writeTranslationCommand` 之后，`context.subscriptions.push` 之前）：**

```typescript
// Register file review command (O2)
const translateFileReviewCommand = vscode.commands.registerCommand(
  'transLeaf.translateFileReview',
  async () => {
    statusBarItem.text = '$(sync~spin) 分句审阅...';
    try {
      await translateFileReview();
    } finally {
      statusBarItem.text = '$(leaf) Trans-Leaf';
    }
  }
);

// subscriptions 中追加 translateFileReviewCommand
context.subscriptions.push(
  // ... 原有项 ...,
  translateFileReviewCommand,  // ★ NEW
);
```

---

#### `package.json` 追加

```diff
  "commands": [
    // ... O1 commands
+   {
+     "command": "transLeaf.translateFileReview",
+     "title": "Trans-Leaf: 分句翻译审阅"
+   }
  ]

  "keybindings": [
    // ... O1 keybinding
+   {
+     "command": "transLeaf.translateFileReview",
+     "key": "ctrl+alt+shift+r",
+     "when": "editorTextFocus"
+   }
  ]
```

---

### Phase 2 编译验证 Checklist

```bash
npm run compile
npm run lint
```

手动验证：
1. F5 启动扩展，打开一个 .md 文件
2. 命令面板 → "Trans-Leaf: 分句翻译审阅" → 选择目标语言
3. 确认打开 WebviewPanel，显示分句 table
4. 点击单行 [▶] → 确认该句翻译并显示
5. 点击 "全部翻译" → 确认批量翻译，进度更新
6. 点击译文单元格编辑 → 确认状态变为 "edited"
7. 点击 "Save As File" → 确认文件保存对话框，默认文件名正确
8. 验证代码块行显示 🔒，不可翻译
9. 快捷键 `Ctrl+Alt+Shift+R` 验证
10. 状态栏菜单 → "分句翻译审阅" 验证

---

## 文件变更总览

| 操作 | 文件 | Phase |
|------|------|-------|
| **新增** | `src/webview/reviewPanel.ts` | 1 |
| **新增** | `src/commands/translateAndReview.ts` | 1 |
| **修改** | `src/extension.ts` | 1 + 2 |
| **修改** | `package.json` | 1 + 2 |
| **修改** | `src/webview/chatView.ts` | 1 |
| **删除** | `src/commands/translateSelection.ts` | 1 |
| **新增** | `src/commands/translateFileReview.ts` | 2 |
| **新增** | `src/webview/fileReviewPanel.ts` | 2 |
