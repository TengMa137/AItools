// SidebarProvider.ts - Manages the sidebar webview UI and functionality

import * as vscode from 'vscode';
import { LlmService } from './LlmService';
import * as path from 'path';
import * as fs from 'fs';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _llmService: LlmService;
  private _chatHistory: { chats: Array<Array<{role: string, content: string}>> };
  private _currentChatIndex: number = 0;
  private _isGenerating: boolean = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    llmService: LlmService
  ) {
    this._llmService = llmService;
    this._chatHistory = { chats: [[]] };
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getWebviewContent(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this.handleUserMessage(data.value, context);
          break;
        case 'stopGeneration':
          this.stopGeneration();
          break;
        case 'navigateChat':
          this.navigateChat(data.direction);
          break;
      }
    });
  }

  public async handleUserMessage(message: string, context: vscode.WebviewViewResolveContext) {
    if (!this._view) return;
    
    // If currently generating, stop the generation
    if (this._isGenerating) {
      this.stopGeneration();
      // Give a moment for cancellation to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showErrorMessage("No active editor detected.");
        return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    // Add user message to history
    const currentChat = this._chatHistory.chats[this._currentChatIndex];
    currentChat.push({ role: 'user', content: selectedText ? message + "\n\nSelected text:\n" + selectedText : message});
    
    // Update the UI with the new message
    this._view.webview.postMessage({ 
      type: 'updateChat', 
      history: this._chatHistory,
      currentChatIndex: this._currentChatIndex
    });

    // Start assistant response (with streaming)
    this._isGenerating = true;
    currentChat.push({ role: 'assistant', content: '' });
      
    try {
      console.log("Starting LLM streaming response");
      
      // Start the streaming response from LLM
      await this._llmService.getStreamingResponse(
        currentChat.slice(0, -1), // Send all messages except the empty assistant one
        (partialResponse) => {
          // Update the assistant's message content as chunks arrive
          currentChat[currentChat.length - 1].content = partialResponse;
          console.log(`Re: ${currentChat[currentChat.length - 1].content}`);  // Debug log
          // Update the UI with the streaming response
          this._view?.webview.postMessage({
            type: 'updateChat',
            history: this._chatHistory,
            currentChatIndex: this._currentChatIndex,
            isGenerating: true,
            context: {
              userData: context,
              extensionUri: this._extensionUri,}
          });
        }
      );      
    } catch (error) {
      console.error('Error getting response from LLM:', error);
      // Update UI to show error
      currentChat[currentChat.length - 1].content = 'Sorry, there was an error processing your request.';
    } finally {
      this._isGenerating = false;
      // Update UI to show generation is complete
      this._view?.webview.postMessage({
        type: 'updateChat',
        history: this._chatHistory,
        currentChatIndex: this._currentChatIndex,
        isGenerating: false
      });
    }
  }

  public stopGeneration() {
    this._llmService.cancelRequest();
    this._isGenerating = false;
  }

  public navigateChat(direction: 'next' | 'prev') {
    if (!this._view) return;
    
    if (direction === 'next') {
      // Create a new chat if we're at the end
      if (this._currentChatIndex === this._chatHistory.chats.length - 1) {
        this._chatHistory.chats.push([]);
      }
      this._currentChatIndex++;
    } else if (direction === 'prev' && this._currentChatIndex > 0) {
      this._currentChatIndex--;
    }

    // Update UI
    this._view.webview.postMessage({ 
      type: 'updateChat', 
      history: this._chatHistory,
      currentChatIndex: this._currentChatIndex
    });
  }

  public newChat() {
    if (!this._view) return;
    
    this._chatHistory.chats.push([]);
    this._currentChatIndex = this._chatHistory.chats.length - 1;
    
    // Update UI
    this._view.webview.postMessage({ 
      type: 'updateChat', 
      history: this._chatHistory,
      currentChatIndex: this._currentChatIndex
    });
  }

  private _getWebviewContent(webview: vscode.Webview): string {
    // Get path to HTML/css/js template
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'sidebar.html');
    const jsPath = path.join(this._extensionUri.fsPath, 'media', 'sidebar.js');
    const cssPath = path.join(this._extensionUri.fsPath, 'media', 'sidebar.css');
    
    // Read the HTML file
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');    
    // Get the path to the script file and convert to webview URI
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(jsPath));
    // Get the path to the stylesheet and convert to webview URI
    const styleUri = webview.asWebviewUri(vscode.Uri.file(cssPath));
    
    // Replace placeholders in the HTML with actual URIs
    htmlContent = htmlContent
      .replace('{{scriptUri}}', scriptUri.toString())
      .replace('{{styleUri}}', styleUri.toString());
      
    return htmlContent;
  }
}