"use strict";
// SidebarProvider.ts - Manages the sidebar webview UI and functionality
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
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
        webviewView.webview.html = this._getWebviewContent(webviewView.webview);
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
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage("No active editor detected.");
                return;
            }
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
            // Add user message to history
            const currentChat = this._chatHistory.chats[this._currentChatIndex];
            currentChat.push({ role: 'user', content: selectedText ? message + "\n\nSelected text:\n" + selectedText : message });
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
                yield this._llmService.getStreamingResponse(currentChat.slice(0, -1), // Send all messages except the empty assistant one
                (partialResponse) => {
                    var _a;
                    // Update the assistant's message content as chunks arrive
                    currentChat[currentChat.length - 1].content = partialResponse;
                    // console.log(`Re: ${currentChat[currentChat.length - 1].content}`);  // Debug log
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
                }, () => __awaiter(this, void 0, void 0, function* () {
                    var _b;
                    // Save the chat after the streaming is fully complete
                    yield this.saveChatToMarkdown();
                    // Optional: Update UI to show generation is complete
                    (_b = this._view) === null || _b === void 0 ? void 0 : _b.webview.postMessage({
                        type: 'updateChat',
                        history: this._chatHistory,
                        currentChatIndex: this._currentChatIndex,
                        isGenerating: false,
                        context: {
                            userData: context,
                            extensionUri: this._extensionUri,
                        }
                    });
                }));
            }
            catch (error) {
                console.error('Error getting response from LLM:', error);
                // Update UI to show error
                currentChat[currentChat.length - 1].content = 'Sorry, there was an error processing your request.';
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
    /**
     * Saves the current chat to a markdown file or appends to existing file
     */
    saveChatToMarkdown() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const chat = this._chatHistory.chats[this._currentChatIndex];
                // Use current chat index and first question for filename, saved in md-notes/${date}/      
                const now = new Date();
                const date = now.toISOString().slice(0, 10); // "2025-04-14"
                const fileName = `chat-${this._currentChatIndex}-${chat[0].content}.md`;
                const mdFolder = path.join(`md-notes`, date);
                // Get workspace folders
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showErrorMessage("No workspace folder open to save chat history.");
                    return;
                }
                // Create a URI for the file in the workspace root
                const fileUri = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, mdFolder, fileName));
                // Check if file exists
                let existingContent = '';
                try {
                    const fileData = yield vscode.workspace.fs.readFile(fileUri);
                    existingContent = Buffer.from(fileData).toString('utf8');
                }
                catch (err) {
                    // File doesn't exist yet, will create new
                    existingContent = '# Chat History for Session ' + this._currentChatIndex + '\n\n';
                }
                // Format the most recent message exchange (last user and assistant messages)
                let newContent = '';
                if (chat.length >= 2) {
                    const lastUserMsgIndex = chat.length - 2; // Assuming the pattern is always user then assistant
                    const lastAssistantMsgIndex = chat.length - 1;
                    // Add user message
                    if (chat[lastUserMsgIndex].role === 'user') {
                        newContent += `### User\n\n${chat[lastUserMsgIndex].content}\n\n`;
                    }
                    // Add assistant message
                    if (chat[lastAssistantMsgIndex].role === 'assistant') {
                        newContent += `### Assistant\n\n${chat[lastAssistantMsgIndex].content}\n\n`;
                    }
                }
                // Combine existing content with new content
                const updatedContent = existingContent + newContent;
                // Write to file
                yield vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));
                vscode.window.showInformationMessage(`Chat appended to ${fileUri.fsPath}`);
            }
            catch (error) {
                console.error('Error saving chat to markdown:', error);
                vscode.window.showErrorMessage('Failed to save chat to markdown file.');
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
    _getWebviewContent(webview) {
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
        // Set Content Security Policy source
        const nonce = this._getNonce();
        const cspSource = webview.cspSource;
        // Replace placeholders in the HTML with actual URIs
        htmlContent = htmlContent
            .replace(/{{scriptUri}}/g, scriptUri.toString())
            .replace(/{{styleUri}}/g, styleUri.toString())
            .replace(/{{nonce}}/g, nonce)
            .replace(/{{cspSource}}/g, cspSource);
        console.log(htmlContent);
        return htmlContent;
    }
    _getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
exports.SidebarProvider = SidebarProvider;
