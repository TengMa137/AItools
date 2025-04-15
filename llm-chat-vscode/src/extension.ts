// extension.ts - Main entry point for the extension

import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { LlmService } from './LlmService';

export function activate(context: vscode.ExtensionContext) {
  // Initialize the LLM service
  const llmService = new LlmService();
  
  // Register the sidebar webview provider
  const sidebarProvider = new SidebarProvider(context.extensionUri, llmService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "llm-chat-sidebar",
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('llm-chat.newChat', () => {
      sidebarProvider.newChat();
    })
  );

  // Command to open the view
  context.subscriptions.push(
    vscode.commands.registerCommand('llm-chat.openView', async () => {
      // Focus on the view container first
      await vscode.commands.executeCommand('workbench.view.extension.llm-chat');
      // Then focus on the specific view
      await vscode.commands.executeCommand('llm-chat-sidebar.focus');
    })
  );
  console.log('LLM Chat extension is now active!');
}

export function deactivate() {}