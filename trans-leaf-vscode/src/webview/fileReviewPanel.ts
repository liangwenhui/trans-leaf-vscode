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

export class FileReviewPanel {
  private static currentPanel: FileReviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private sentences: Sentence[];
  private options: FileReviewOptions;
  private translator: import('../translator/types.js').Translator;
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
      const context = this.getContext(index, 2);
      const contextNote = context ? `\n\n参考上下文：\n${context}` : '';

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

  private getContext(index: number, n: number): string {
    const parts: string[] = [];
    let count = 0;
    for (let i = index - 1; i >= 0 && count < n; i--) {
      if (this.sentences[i].translatable) {
        parts.unshift(this.sentences[i].source);
        count++;
      }
    }
    count = 0;
    for (let i = index + 1; i < this.sentences.length && count < n; i++) {
      if (this.sentences[i].translatable) {
        parts.push(this.sentences[i].source);
        count++;
      }
    }
    return parts.join('\n');
  }

  private async translateAll(): Promise<void> {
    const concurrency = this.options.concurrency;
    const translator = this.translator;

    const pending = this.sentences.filter(
      s => s.translatable && s.status === 'untranslated'
    );

    if (pending.length === 0) {
      vscode.window.setStatusBarMessage('🍃 所有句子已翻译', 3000);
      return;
    }

    const batches: Sentence[][] = [];
    let currentBatch: Sentence[] = [];
    let currentBytes = 0;

    for (const s of pending) {
      const sentenceBytes = new TextEncoder().encode(s.source).length;
      if (currentBytes + sentenceBytes > this.MAX_BATCH_BYTES && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [s];
        currentBytes = sentenceBytes;
      } else {
        currentBatch.push(s);
        currentBytes += sentenceBytes;
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

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

    const translateBatch = async (batch: Sentence[]): Promise<void> => {
      if (batch.length === 1) {
        await translateSingle(batch[0]);
        return;
      }

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
          if (parts.length === batch.length) {
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
            }
          } else {
            for (const s of batch) {
              s.status = 'untranslated';
            }
            for (const s of batch) {
              await translateSingle(s);
            }
          }
        } else {
          for (const s of batch) {
            s.status = 'untranslated';
          }
          for (const s of batch) {
            await translateSingle(s);
          }
        }
      } catch {
        for (const s of batch) {
          s.status = 'untranslated';
        }
        for (const s of batch) {
          await translateSingle(s);
        }
      }
    };

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
        if (batches.length === 0) {
          resolveAll();
        }
      };
      tryNext();
    });

    vscode.window.setStatusBarMessage(`🍃 翻译完成：${completed}/${total} 句`, 3000);
  }

  private updateTarget(index: number, target: string): void {
    const sentence = this.sentences[index];
    if (sentence) {
      sentence.target = target;
      if (sentence.status === 'translated') {
        sentence.status = 'edited';
      }
    }
  }

  private async saveAsFile(_saveToTM: boolean): Promise<void> {
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

    const lineMap = new Map<number, Sentence[]>();
    for (const s of this.sentences) {
      if (!lineMap.has(s.lineIndex)) {
        lineMap.set(s.lineIndex, []);
      }
      lineMap.get(s.lineIndex)!.push(s);
    }

    const sortedLines = [...lineMap.entries()].sort((a, b) => a[0] - b[0]);
    const outputLines: string[] = [];

    for (const [, group] of sortedLines) {
      group.sort((a, b) => a.index - b.index);
      if (group[0].isWholeLine) {
        const s = group[0];
        if (s.translatable && s.target) {
          outputLines.push(s.target);
        } else {
          outputLines.push(s.source);
        }
      } else {
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

    const ext = this.options.fileName.includes('.')
      ? '.' + this.options.fileName.split('.').pop()
      : '';
    const baseName = this.options.fileName.replace(/\.[^.]+$/, '');
    const defaultName = `${baseName}.${this.options.targetLang}${ext}`;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultName),
      filters: { 'All Files': ['*'] }
    });

    if (!uri) {
      return;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(resultText, 'utf-8'));
    vscode.window.showInformationMessage(`🍃 译文已保存：${uri.fsPath}`);
  }

  private _getHtml(): string {
    const nonce = getNonce();
    const sourceLangLabel = this.options.sourceLang === 'zh-CN' ? '中文' : 'English';
    const targetLangLabel = this.options.targetLang === 'zh-CN' ? '中文' : 'English';

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
    .table-container { flex: 1; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; }
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
    td:first-child { text-align: center; color: var(--vscode-descriptionForeground); font-size: 11px; }
    td:last-child { text-align: center; }
    tr.untranslatable { background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.05)); color: var(--vscode-descriptionForeground); }
    tr.translated { background: rgba(40, 167, 69, 0.06); }
    tr.translating { background: rgba(0, 123, 255, 0.06); }
    tr.edited { background: rgba(255, 193, 7, 0.06); }
    .source-cell, .target-cell { white-space: pre-wrap; word-break: break-word; }
    .target-cell { cursor: text; min-height: 20px; }
    .target-cell:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-radius: 2px; }
    .btn-translate {
      padding: 2px 8px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 11px;
      cursor: pointer;
    }
    .btn-translate:hover { background: var(--vscode-list-hoverBackground); }
    .btn-translate:disabled { opacity: 0.3; cursor: default; }
    .loading { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-top: 1px solid var(--vscode-widget-border);
      flex-shrink: 0;
    }
    .progress-text { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .footer-right { display: flex; align-items: center; gap: 12px; }
    .tm-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .actions { display: flex; gap: 8px; }
    .btn { padding: 5px 14px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: transparent; color: var(--vscode-foreground); font-size: 12px; font-family: inherit; cursor: pointer; }
    .btn:hover { background: var(--vscode-list-hoverBackground); }
    .btn:disabled { opacity: 0.3; cursor: default; }
    .btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
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
        <tr><th>#</th><th>Source</th><th>Translation</th><th></th></tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>
  <div class="footer">
    <span class="progress-text" id="progressText">已翻译 0/0 句</span>
    <div class="footer-right">
      <button class="btn" id="btnTranslateAll">全部翻译</button>
      <label class="tm-check"><input type="checkbox" id="saveToTM" />Save all to TM</label>
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

    function render() {
      tbody.innerHTML = '';
      for (const s of sentences) {
        const tr = document.createElement('tr');
        tr.id = 'row-' + s.index;
        tr.className = s.translatable ? s.status : 'untranslatable';
        tr.innerHTML = \`
          <td>\${String(s.index + 1)}</td>
          <td class="source-cell">\${s.source || '(empty)'}</td>
          <td class="target-cell" contenteditable="\${s.translatable}">\${s.target || ''}</td>
          <td>\${s.translatable ? '<button class="btn-translate" id="btn-' + s.index + '">▶</button>' : '🔒'}</td>
        \`;
        tbody.appendChild(tr);
        
        if (s.translatable) {
          const tdTarget = tr.children[2];
          tdTarget.addEventListener('blur', () => {
            const newText = tdTarget.textContent || '';
            if (newText !== s.target) {
              s.target = newText;
              s.status = s.target ? 'edited' : 'untranslated';
              tr.className = s.translatable ? s.status : 'untranslatable';
              vscode.postMessage({ type: 'update-target', index: s.index, target: newText });
              updateProgress();
            }
          });
          
          const btn = tr.querySelector('.btn-translate');
          btn.addEventListener('click', () => {
            vscode.postMessage({ type: 'translate-sentence', index: s.index });
          });
        }
      }
      updateProgress();
    }

    function updateProgress() {
      const translatable = sentences.filter(s => s.translatable);
      const translated = translatable.filter(s => s.status === 'translated' || s.status === 'edited');
      document.getElementById('progressText').textContent = '已翻译 ' + translated.length + '/' + translatable.length + ' 句';
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'sentence-updated') {
        const s = sentences.find(x => x.index === msg.index);
        if (s) {
          s.target = msg.target;
          s.status = msg.status;
          const tr = document.getElementById('row-' + s.index);
          if (tr) {
            tr.className = s.translatable ? s.status : 'untranslatable';
            const tdTarget = tr.children[2];
            tdTarget.textContent = s.target || '';
            const btn = tr.querySelector('.btn-translate');
            if (btn) btn.disabled = msg.status === 'translating';
          }
          updateProgress();
        }
      }
    });

    document.getElementById('btnTranslateAll').addEventListener('click', () => {
      vscode.postMessage({ type: 'translate-all' });
    });
    document.getElementById('btnCancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });
    document.getElementById('btnSaveAs').addEventListener('click', () => {
      vscode.postMessage({ type: 'save-as-file', saveToTM: document.getElementById('saveToTM').checked });
    });

    render();
  </script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
