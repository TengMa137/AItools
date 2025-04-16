"use strict";
// extension.ts - Main entry point for the extension
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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const SidebarProvider_1 = require("./SidebarProvider");
const LlmService_1 = require("./LlmService");
function activate(context) {
    // Initialize the LLM service
    const llmService = new LlmService_1.LlmService();
    // Register the sidebar webview provider
    const sidebarProvider = new SidebarProvider_1.SidebarProvider(context.extensionUri, llmService);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("llm-chat-sidebar", sidebarProvider, {
        webviewOptions: {
            retainContextWhenHidden: true
        }
    }));
    // Command to open the view
    context.subscriptions.push(vscode.commands.registerCommand('llm-chat.openView', () => __awaiter(this, void 0, void 0, function* () {
        // Focus on the view container first
        yield vscode.commands.executeCommand('workbench.view.extension.llm-chat');
        // Then focus on the specific view
        yield vscode.commands.executeCommand('llm-chat-sidebar.focus');
    })));
    console.log('LLM Chat extension is now active!');
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
