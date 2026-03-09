import * as vscode from 'vscode';
import { AgentLoop } from '../agent/agentLoop.js';
import { createToolRegistry } from '../agent/toolRegistry.js';
import { getConfig } from '../utils/config.js';

/**
 * Trans-Leaf 聊天视图 — 类似 Kiro/Copilot Chat 的对话式界面
 */
export class ChatView {
  private readonly _panel: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private agentLoop: AgentLoop | null = null;
  private _agentReady: Promise<void>;
  private _pendingConfirm?: (confirmed: boolean) => void;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    panel: vscode.WebviewView
  ) {
    this._panel = panel;

    // 设置 webview
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(_extensionUri, 'assets')]
    };

    // 初始化 HTML
    this._panel.webview.html = this._getHtmlForWebview();

    // 初始化 Agent Loop（保存 promise 用于等待）
    this._agentReady = this.initAgentLoop();

    // 监听来自 webview 的消息
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );
  }

  public dispose(): void {
    // 通知 webview 清理事件监听器
    try {
      this._panel.webview.postMessage({ type: 'dispose' });
    } catch (e) {
      // webview 可能已被销毁
    }
    this._disposables.forEach(d => d.dispose());
  }

  /**
   * 初始化 Agent Loop
   */
  private async initAgentLoop(): Promise<void> {
    try {
      const config = getConfig();
      const toolRegistry = await createToolRegistry();

      this.agentLoop = new AgentLoop(config, toolRegistry.getAll(), {
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
          const TIMEOUT = 30000; // 30秒超时
          let timeoutId: NodeJS.Timeout | undefined = undefined;
          return new Promise((resolve) => {
            timeoutId = setTimeout(() => {
              console.warn('Confirm timeout for:', name);
              resolve(false); // 默认拒绝
            }, TIMEOUT);
            this._pendingConfirm = (confirmed: boolean) => {
              if (timeoutId) clearTimeout(timeoutId);
              resolve(confirmed);
            };
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
      
      // 设置 alwaysWriteFile，跳过写文件确认
      this.agentLoop.alwaysWriteFile = config.alwaysWriteFile;
    } catch (error) {
      console.error('Agent 初始化失败:', error);
      // agentLoop 保持 null，_handleMessage 会发送错误消息
    }
  }

  private async _handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'chat':
        // 等待 Agent 初始化完成，然后发送消息
        await this._agentReady;
        if (this.agentLoop) {
          await this.agentLoop.handleUserMessage(message.text, message.attachedFile);
        } else {
          this._panel.webview.postMessage({ type: 'error', error: 'Agent 初始化失败，请检查配置后重试' });
          this._panel.webview.postMessage({ type: 'done' });
        }
        break;
      case 'reset':
        if (this.agentLoop) {
          this.agentLoop.reset();
        }
        break;
      case 'embedTranslation':
        // 将翻译结果嵌入当前文件
        vscode.postMessage({ type: 'translateSelection', targetLang: 'en' }); // 用英文翻译作为例子，实际应该用保存的结果
        break;
      case 'confirm-result':
        if (this._pendingConfirm) {
          this._pendingConfirm(message.confirmed);
          this._pendingConfirm = undefined;
        }
        break;
      case 'translateSelection':
        await vscode.commands.executeCommand(
          message.targetLang === 'zh-CN'
            ? 'transLeaf.translateSelectionToZh'
            : 'transLeaf.translateSelectionToEn'
        );
        break;
      case 'translateFile':
        await vscode.commands.executeCommand(
          message.targetLang === 'zh-CN'
            ? 'transLeaf.translateFileToZh'
            : 'transLeaf.translateFileToEn'
        );
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'transLeaf');
        break;
      case 'reloadConfig':
        this._agentReady = this.initAgentLoop();
        // 清理旧的 agentLoop
        if (this.agentLoop) {
          this.agentLoop.dispose();
          this.agentLoop = null;
        }
        await this._agentReady;
        this._panel.webview.postMessage({ type: 'config-reloaded' });
        break;
      case 'pickFile':
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri) {
          this._panel.webview.postMessage({
            type: 'activeFile',
            file: { path: activeUri.fsPath, name: activeUri.fsPath.split(/[\\/]/).pop() }
          });
        } else {
          const selected = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFolders: false,
            openLabel: '选择文件'
          });
          if (selected && selected[0]) {
            const uri = selected[0];
            this._panel.webview.postMessage({
              type: 'activeFile',
              file: { path: uri.fsPath, name: uri.fsPath.split(/[\\/]/).pop() }
            });
          }
        }
        break;
    }
  }

  public updateActiveFile(uri: vscode.Uri): void {
    this._panel.webview.postMessage({
      type: 'activeFile',
      file: { path: uri.fsPath, name: uri.fsPath.split(/[\\/]/).pop() }
    });
  }

  private _getHtmlForWebview(): string {
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
      display: flex;
      flex-direction: column;
    }

    /* ===== 整体布局 ===== */
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    /* ===== 消息列表区 ===== */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .messages::-webkit-scrollbar {
      width: 6px;
    }
    .messages::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 3px;
    }

    /* ===== 欢迎区 ===== */
    .welcome {
      text-align: center;
      padding: 24px 12px 8px;
      color: var(--vscode-descriptionForeground);
    }
    .welcome-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }
    .welcome h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 6px;
    }
    .welcome p {
      font-size: 12px;
      line-height: 1.5;
    }

    /* ===== 快捷操作 chips ===== */
    .quick-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
      padding: 8px 12px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      border-radius: 12px;
      border: 1px solid var(--vscode-widget-border);
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s;
      font-family: inherit;
    }
    .chip:hover {
      background: var(--vscode-list-hoverBackground);
    }

    /* ===== 消息气泡 ===== */
    .msg {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 100%;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .msg-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      padding: 0 2px;
    }
    .msg-bubble {
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.user .msg-bubble {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    }
    .msg.assistant .msg-bubble {
      background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
      border: 1px solid var(--vscode-widget-border, transparent);
    }
    .msg.error .msg-bubble {
      background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
      border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      color: var(--vscode-errorForeground);
    }

    /* 翻译中动画 */
    .typing-indicator {
      display: inline-flex;
      gap: 4px;
      padding: 4px 0;
    }
    .typing-indicator span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      animation: bounce 1.2s infinite;
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    /* ===== 输入栏 ===== */
    .input-bar {
      padding: 8px 12px 12px;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .input-card {
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      border-radius: 12px;
      background: var(--vscode-input-background);
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .input-card:focus-within {
      border-color: var(--vscode-focusBorder);
    }
    textarea#chatInput {
      width: 100%;
      min-height: 40px;
      max-height: 120px;
      padding: 12px 14px 0;
      border: none;
      background: transparent;
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      outline: none;
      line-height: 1.5;
      overflow-y: auto;
    }
    textarea#chatInput::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .input-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 6px 6px;
    }
    .input-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .lang-select {
      padding: 3px 4px 3px 8px;
      border: none;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      border-radius: 4px;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23888' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 4px center;
      padding-right: 16px;
    }
    .lang-select:hover {
      background-color: var(--vscode-list-hoverBackground);
      color: var(--vscode-foreground);
    }
    .lang-select:focus {
      border-color: var(--vscode-focusBorder);
    }
    .lang-select option {
      background: var(--vscode-dropdown-background, var(--vscode-editor-background));
      color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    }
    .icon-btn {
      padding: 3px 6px;
      border: none;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
    }
    .icon-btn:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-foreground);
    }
    .send-btn {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .send-btn:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-foreground);
    }
    .send-btn:disabled {
      opacity: 0.3;
      cursor: default;
      background: transparent;
    }
    .send-btn svg {
      width: 16px;
      height: 16px;
    }

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
    .tool-result-slot {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-widget-border);
    }

    /* 确认面板 */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .confirm-box {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 8px;
      padding: 16px;
      max-width: 90%;
      max-height: 60vh;
      overflow-y: auto;
    }
    .confirm-box p {
      margin-bottom: 8px;
      font-weight: 600;
    }
    .confirm-box pre {
      white-space: pre-wrap;
      word-break: break-all;
      font-size: 11px;
      margin-bottom: 12px;
      padding: 8px;
      background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
    }
    .confirm-buttons {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .confirm-buttons button {
      padding: 5px 14px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      background: transparent;
      color: var(--vscode-foreground);
    }
    .confirm-buttons button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }

    /* 文件选择器 */
    .file-bar {
      display: flex;
      align-items: center;
      padding: 6px 10px 0;
    }
    .file-tab {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      font-size: 12px;
      color: var(--vscode-foreground);
      cursor: pointer;
      max-width: 200px;
    }
    .file-tab:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .file-tab svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: var(--vscode-descriptionForeground);
    }
    .file-tab .file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 130px;
    }
    .file-tab .file-remove {
      display: none;
      margin-left: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
    }
    .file-tab .file-remove:hover {
      color: var(--vscode-errorForeground);
    }
    .file-tab.has-file .file-remove {
      display: inline;
    }
    
    .embed-btn {
      margin-top: 8px;
      padding: 4px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    }
    .embed-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <!-- 消息列表 -->
    <div class="messages" id="messages">
      <!-- 欢迎信息 -->
      <div class="welcome" id="welcome">
        <div class="welcome-icon">🍃</div>
        <h3>Trans-Leaf Agent</h3>
        <p>AI 助手可以帮你翻译文本、操作文件、搜索代码</p>
      </div>

      <!-- 快捷操作 -->
      <div class="quick-chips" id="quickChips">
        <button class="chip" id="chipSelZh">📋 翻译选中 → 中文</button>
        <button class="chip" id="chipSelEn">📋 Selection → English</button>
        <button class="chip" id="chipFileZh">📄 翻译文件 → 中文</button>
        <button class="chip" id="chipFileEn">📄 File → English</button>
      </div>
    </div>

    <!-- 底部输入栏 -->
    <div class="input-bar">
      <div class="input-card">
        <!-- 文件选择器 -->
        <div class="file-bar">
          <div class="file-tab" id="fileAttach" title="选择文件">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            <span class="file-name" id="fileName"></span>
            <span class="file-remove" id="fileRemove">×</span>
          </div>
        </div>
        <textarea id="chatInput" rows="1" placeholder="输入消息，如：帮我翻译这句话..."></textarea>
        <div class="input-bottom">
          <div class="input-actions">
            <select class="lang-select" id="langSelect" title="目标语言">
              <option value="auto">Auto</option>
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
            <button class="icon-btn" id="reloadConfig" title="刷新配置">↻</button>
            <button class="icon-btn" id="openSettings" title="设置">⚙</button>
          </div>
          <button class="send-btn" id="sendBtn" title="发送"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg></button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    console.log('[Trans-Leaf] Webview script loaded');
    const vscode = acquireVsCodeApi();

    // 事件监听器清理函数
    function cleanupEventListeners() {
      // 清理所有动态添加的事件监听器
      console.log('[Trans-Leaf] Cleaning up event listeners');
    }

    // DOM
    const messagesEl  = document.getElementById('messages');
    const chatInput   = document.getElementById('chatInput');
    const sendBtn     = document.getElementById('sendBtn');
    const welcomeEl   = document.getElementById('welcome');
    const quickChips  = document.getElementById('quickChips');

    let targetLang = 'auto';
    let attachedFile = null;
    let alwaysWriteFile = false;
    const MAX_HISTORY = 15;
    let inputHistory: string[] = [];
    let historyIndex = -1;
    let currentInput = '';  // 配置：是否自动写入文件

    // 文件选择器
    const fileAttach = document.getElementById('fileAttach');
    const fileNameEl = document.getElementById('fileName');

    function updateFileUI() {
      if (attachedFile) {
        fileAttach?.classList.add('has-file');
        if (fileNameEl) fileNameEl.textContent = attachedFile.name;
      } else {
        fileAttach?.classList.remove('has-file');
        if (fileNameEl) fileNameEl.textContent = '';
      }
    }

    fileAttach?.addEventListener('click', () => {
      vscode.postMessage({ type: 'pickFile' });
    });

    document.getElementById('fileRemove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      attachedFile = null;
      updateFileUI();
    });
    let isTranslating = false;
    let typingEl = null; // 当前的翻译中气泡

    // ===== 目标语言下拉 =====
    document.getElementById('langSelect').addEventListener('change', (e) => {
      targetLang = e.target.value;
    });

    // ===== 快捷操作 =====
    document.getElementById('chipSelZh').addEventListener('click', () => {
      vscode.postMessage({ type: 'translateSelection', targetLang: 'zh-CN' });
    });
    document.getElementById('chipSelEn').addEventListener('click', () => {
      vscode.postMessage({ type: 'translateSelection', targetLang: 'en' });
    });
    document.getElementById('chipFileZh').addEventListener('click', () => {
      vscode.postMessage({ type: 'translateFile', targetLang: 'zh-CN' });
    });
    document.getElementById('chipFileEn').addEventListener('click', () => {
      vscode.postMessage({ type: 'translateFile', targetLang: 'en' });
    });

    // ===== 设置 =====
    document.getElementById('openSettings').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    // ===== 刷新配置 =====
    document.getElementById('reloadConfig').addEventListener('click', () => {
      vscode.postMessage({ type: 'reloadConfig' });
      addMessage('assistant', '正在刷新配置...');
    });

    // ===== 发送消息 =====
    sendBtn.addEventListener('click', send);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (inputHistory.length > 0) {
          if (historyIndex === -1) {
            currentInput = chatInput.value;
            historyIndex = 0;
          } else if (historyIndex < inputHistory.length - 1) {
            historyIndex++;
          }
          chatInput.value = inputHistory[historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
          historyIndex--;
          chatInput.value = inputHistory[historyIndex];
        } else if (historyIndex === 0) {
          historyIndex = -1;
          chatInput.value = currentInput;
        }
      }
    });

    // 自动调整高度
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    const send = function() {
      const text = chatInput.value.trim();
      if (!text || isTranslating) return;

      // 保存到历史记录
      if (text && !inputHistory.includes(text)) {
        inputHistory.unshift(text);
        if (inputHistory.length > MAX_HISTORY) {
          inputHistory.pop();
        }
      }
      historyIndex = -1;
      currentInput = '';

      // 隐藏欢迎信息
      if (welcomeEl) welcomeEl.style.display = 'none';
      if (quickChips) quickChips.style.display = 'none';

      // 添加用户消息气泡
      addMessage('user', text);

      // 清空输入
      chatInput.value = '';
      chatInput.style.height = 'auto';

      // 发送聊天请求到 Agent
      isTranslating = true;
      sendBtn.disabled = true;
      console.log('[Trans-Leaf] Sending chat with file:', attachedFile);
      vscode.postMessage({ type: 'chat', text, attachedFile });
    }

    // ===== 消息气泡 =====
    function addMessage(role, content) {
      const msg = document.createElement('div');
      msg.className = 'msg ' + role;

      const label = document.createElement('div');
      label.className = 'msg-label';
      label.textContent = role === 'user' ? 'You' : 'Trans-Leaf';

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';

      if (typeof content === 'string') {
        bubble.textContent = content;
      } else {
        bubble.appendChild(content);
      }

      msg.appendChild(label);
      msg.appendChild(bubble);
      messagesEl.appendChild(msg);
      scrollToBottom();

      return msg;
    }

    function addTypingIndicator() {
      const dots = document.createElement('div');
      dots.className = 'typing-indicator';
      dots.innerHTML = '<span></span><span></span><span></span>';
      typingEl = addMessage('assistant', dots);
    }

    function removeTypingIndicator() {
      if (typingEl) {
        typingEl.remove();
        typingEl = null;
      }
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ===== 监听扩展消息 =====
    let lastToolSlotId = null;

    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'assistant-text':
          removeTypingIndicator();
          if (message.text) {
            addMessage('assistant', message.text);
          }
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
              
              // 如果是翻译结果且开启了 alwaysWriteFile，自动写入
              if (message.name === 'translateText' && !message.isError && alwaysWriteFile) {
                vscode.postMessage({ type: 'writeTranslation', text: message.result });
              }
            }
          }
          scrollToBottom();
          break;
        }

        case 'confirm': {
          const overlay = document.createElement('div');
          overlay.className = 'confirm-overlay';
          const box = document.createElement('div');
          box.className = 'confirm-box';
          const p = document.createElement('p');
          p.textContent = 'AI 想要执行: ' + message.name;
          const pre = document.createElement('pre');
          pre.textContent = JSON.stringify(message.args, null, 2);
          const btns = document.createElement('div');
          btns.className = 'confirm-buttons';
          const denyBtn = document.createElement('button');
          denyBtn.textContent = '拒绝';
          const allowBtn = document.createElement('button');
          allowBtn.className = 'primary';
          allowBtn.textContent = '允许';
          function respond(confirmed) {
            overlay.remove();
            vscode.postMessage({ type: 'confirm-result', confirmed: confirmed });
          }
          denyBtn.addEventListener('click', function() { respond(false); });
          allowBtn.addEventListener('click', function() { respond(true); });
          btns.appendChild(denyBtn);
          btns.appendChild(allowBtn);
          box.appendChild(p);
          box.appendChild(pre);
          box.appendChild(btns);
          overlay.appendChild(box);
          document.body.appendChild(overlay);
          break;
        }

        case 'done':
          isTranslating = false;
          sendBtn.disabled = false;
          chatInput.focus();
          break;

        case 'error':
          removeTypingIndicator();
          const errMsg = document.createElement('div');
          errMsg.className = 'msg error';
          const errLabel = document.createElement('div');
          errLabel.className = 'msg-label';
          errLabel.textContent = 'Trans-Leaf';
          const errBubble = document.createElement('div');
          errBubble.className = 'msg-bubble';
          errBubble.textContent = message.error;
          errMsg.appendChild(errLabel);
          errMsg.appendChild(errBubble);
          messagesEl.appendChild(errMsg);
          scrollToBottom();
          isTranslating = false;
          sendBtn.disabled = false;
          chatInput.focus();
          break;

        case 'config-reloaded':
          addMessage('assistant', '配置已刷新');
          break;

        case 'activeFile':
          console.log('[Trans-Leaf] Received activeFile:', message.file);
          if (message.file) {
            // 验证 file 对象结构
            if (!message.file.name || !message.file.path) {
              console.error('[Trans-Leaf] Invalid file object:', message.file);
              return;
            }
            attachedFile = message.file;
            updateFileUI();
          }
          break;

        case 'dispose':
          cleanupEventListeners();
          break;
      }
    });

    // 初始聚焦
    chatInput.focus();
  </script>
</body>
</html>`;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
