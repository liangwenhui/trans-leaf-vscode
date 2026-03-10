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
