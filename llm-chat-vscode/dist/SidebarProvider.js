"use strict";
// SidebarProvider.ts - Manages the sidebar webview UI and functionality
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarProvider = void 0;
class SidebarProvider {
    constructor(_extensionUri, llmService) {
        this._extensionUri = _extensionUri;
        this._currentChatIndex = 0;
        this._isGenerating = false;
        this._llmService = llmService;
        this._chatHistory = { chats: [[]] };
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getWebviewContent();
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage((data) => __awaiter(this, void 0, void 0, function* () {
            switch (data.type) {
                case 'sendMessage':
                    yield this.handleUserMessage(data.value, context);
                    break;
                case 'stopGeneration':
                    this.stopGeneration();
                    break;
                case 'navigateChat':
                    this.navigateChat(data.direction);
                    break;
            }
        }));
    }
    handleUserMessage(message, context) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._view)
                return;
            // If currently generating, stop the generation
            if (this._isGenerating) {
                this.stopGeneration();
                // Give a moment for cancellation to complete
                yield new Promise(resolve => setTimeout(resolve, 100));
            }
            // Add user message to history
            const currentChat = this._chatHistory.chats[this._currentChatIndex];
            currentChat.push({ role: 'user', content: message });
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
                // Start the streaming response from LLM
                yield this._llmService.getStreamingResponse(currentChat.slice(0, -1), // Send all messages except the empty assistant one
                (partialResponse) => {
                    var _a;
                    // Update the assistant's message content as chunks arrive
                    const assistantMessage = currentChat[currentChat.length - 1];
                    assistantMessage.content = partialResponse;
                    // Update the UI with the streaming response
                    (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
                        type: 'updateChat',
                        history: this._chatHistory,
                        currentChatIndex: this._currentChatIndex,
                        isGenerating: true,
                        context: {
                            userData: context,
                            extensionUri: this._extensionUri,
                        }
                    });
                });
            }
            catch (error) {
                console.error('Error getting response from LLM:', error);
                // Update UI to show error
                const assistantMessage = currentChat[currentChat.length - 1];
                assistantMessage.content = 'Sorry, there was an error processing your request.';
            }
            finally {
                this._isGenerating = false;
                // Update UI to show generation is complete
                (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
                    type: 'updateChat',
                    history: this._chatHistory,
                    currentChatIndex: this._currentChatIndex,
                    isGenerating: false
                });
            }
        });
    }
    stopGeneration() {
        this._llmService.cancelRequest();
        this._isGenerating = false;
    }
    navigateChat(direction) {
        if (!this._view)
            return;
        if (direction === 'next') {
            // Create a new chat if we're at the end
            if (this._currentChatIndex === this._chatHistory.chats.length - 1) {
                this._chatHistory.chats.push([]);
            }
            this._currentChatIndex++;
        }
        else if (direction === 'prev' && this._currentChatIndex > 0) {
            this._currentChatIndex--;
        }
        // Update UI
        this._view.webview.postMessage({
            type: 'updateChat',
            history: this._chatHistory,
            currentChatIndex: this._currentChatIndex
        });
    }
    newChat() {
        if (!this._view)
            return;
        this._chatHistory.chats.push([]);
        this._currentChatIndex = this._chatHistory.chats.length - 1;
        // Update UI
        this._view.webview.postMessage({
            type: 'updateChat',
            history: this._chatHistory,
            currentChatIndex: this._currentChatIndex
        });
    }
    _getWebviewContent() {
        return `
    <!<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>LLM Chat</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          margin: 0;
          padding: 0;
          height: 100vh;
          overflow: hidden;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
        }
        
        .container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          padding: 10px;
          box-sizing: border-box;
        }
        
        .input-container {
          display: flex;
          margin-bottom: 10px;
          position: relative;
          width: 100%;
        }
        
        #messageInput {
          flex: 1;
          padding: 8px 40px 8px 10px;
          border-radius: 4px;
          border: 1px solid var(--vscode-input-border);
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          font-size: 14px;
        }
        
        .send-button {
          position: absolute;
          right: 5px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          color: var(--vscode-button-foreground);
          background-color: var(--vscode-button-background);
        }
        
        .send-button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        .send-button.generating {
          color: #ff5252;
        }
        
        .chat-container {
          flex: 1;
          overflow-y: auto;
          margin-bottom: 10px;
          padding: 10px;
          border-radius: 4px;
          border: 1px solid var(--vscode-panel-border);
          background-color: var(--vscode-editor-background);
        }
        
        .message {
          margin-bottom: 10px;
          padding: 8px 12px;
          border-radius: 4px;
          max-width: 90%;
          word-break: break-word;
        }
        
        .message.user {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          align-self: flex-end;
          margin-left: auto;
        }
        
        .message.assistant {
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          color: var(--vscode-editor-foreground);
          align-self: flex-start;
        }
        
        .content {
          white-space: pre-wrap;
        }
        
        .navigation {
          display: flex;
          justify-content: space-between;
          padding: 5px 0;
        }
        
        .nav-button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 4px;
          padding: 5px 15px;
          cursor: pointer;
          font-size: 16px;
        }
        
        .nav-button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        .nav-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .icon {
          font-size: 16px;
          line-height: 1;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Input area at the top -->
        <div class="input-container">
          <input type="text" id="messageInput" placeholder="Ask something..." />
          <button id="sendButton" class="send-button">
            <span class="icon">↵</span>
          </button>
        </div>
        
        <!-- Chat messages area -->
        <div class="chat-container" id="chatContainer"></div>
        
        <!-- Navigation arrows at the bottom, properly aligned left and right -->
        <div class="navigation">
          <button id="prevButton" class="nav-button" style="display: none;">←</button>
          <button id="nextButton" class="nav-button">→</button>
        </div>
      </div>

      <script>
        // JavaScript for handling UI interactions
        (function() {
          const vscode = acquireVsCodeApi();
          const messageInput = document.getElementById('messageInput');
          const sendButton = document.getElementById('sendButton');
          const chatContainer = document.getElementById('chatContainer');
          const prevButton = document.getElementById('prevButton');
          const nextButton = document.getElementById('nextButton');
          
          let chatHistory = { chats: [[]] };
          let currentChatIndex = 0;
          let isGenerating = false;
          
          // Function to render the current chat
          function renderChat() {
            chatContainer.innerHTML = '';
            
            const currentChat = chatHistory.chats[currentChatIndex];
            if (!currentChat) return;
            
            currentChat.forEach(message => {
              const messageElement = document.createElement('div');
              messageElement.className = \`message \${message.role}\`;
              
              const contentElement = document.createElement('div');
              contentElement.className = 'content';
              contentElement.textContent = message.content;
              
              messageElement.appendChild(contentElement);
              chatContainer.appendChild(messageElement);
            });
            
            // Scroll to bottom
            chatContainer.scrollTop = chatContainer.scrollHeight;
            
            // Update navigation buttons
            prevButton.style.display = currentChatIndex > 0 ? 'block' : 'none';
          }
          
          // Send message function
          function sendMessage() {
            const message = messageInput.value.trim();
            if (message === '') return;
            
            // Change button to stop symbol when sending
            if (!isGenerating) {
              sendButton.classList.add('generating');
              sendButton.querySelector('.icon').textContent = '■';
            }
            
            vscode.postMessage({
              type: 'sendMessage',
              value: message
            });
            
            // Clear input
            messageInput.value = '';
          }
          
          // Event listeners
          sendButton.addEventListener('click', function() {
            if (isGenerating) {
              // If generating, send stop message
              vscode.postMessage({
                type: 'stopGeneration'
              });
              // Reset button immediately on click
              sendButton.classList.remove('generating');
              sendButton.querySelector('.icon').textContent = '↵';
            } else {
              sendMessage();
            }
          });
          
          messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              sendMessage();
            }
          });
          
          prevButton.addEventListener('click', () => {
            vscode.postMessage({
              type: 'navigateChat',
              direction: 'prev'
            });
          });
          
          nextButton.addEventListener('click', () => {
            vscode.postMessage({
              type: 'navigateChat',
              direction: 'next'
            });
          });
          
          // Handle messages from extension
          window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
              case 'updateChat':
                chatHistory = message.history;
                currentChatIndex = message.currentChatIndex;
                isGenerating = message.isGenerating || false;
                renderChat();
                
                // Handle generating state - ensure icon resets when generation complete
                if (isGenerating) {
                  sendButton.classList.add('generating');
                  sendButton.querySelector('.icon').textContent = '■';
                } else {
                  sendButton.classList.remove('generating');
                  sendButton.querySelector('.icon').textContent = '↵';
                }
                break;
            }
          });
          
          // Focus input on load
          messageInput.focus();
          
          // Initial render
          renderChat();
        }());
      </script>
    </body>
    </html>
    `;
    }
}
exports.SidebarProvider = SidebarProvider;
