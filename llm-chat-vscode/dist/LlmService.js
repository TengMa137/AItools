"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmService = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const util_1 = require("util"); // Node.js TextDecoder
class LlmService {
    constructor() {
        this._abortController = null;
    }
    getStreamingResponse(messages, onChunk, onComplete) {
        return __awaiter(this, void 0, void 0, function* () {
            // Create a new abort controller for this request
            this._abortController = new AbortController();
            // this._abortController.signal.onabort = (event: any) => {
            //   // Handle abort event here
            //   console.log("Request aborted", event);
            //   // Optionally, you could notify the user that the request was canceled.
            // };
            try {
                // Get API key from configuration
                // const config = vscode.workspace.getConfiguration('llmChat');
                // const apiKey = config.get<string>('apiKey');
                // if (!apiKey) {
                //   throw new Error('API key not configured. Please set llmChat.apiKey in your settings.');
                // }
                // Build the request to OpenAI API
                const response = yield (0, node_fetch_1.default)('http://localhost:8080/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer no key`, //${apiKey}
                    },
                    body: JSON.stringify({
                        model: 'gpt-4',
                        messages: messages,
                        stream: true
                    }),
                    signal: this._abortController.signal
                });
                if (!response.ok || !response.body) {
                    throw new Error(`API request failed: ${response.statusText}`);
                }
                // Process the stream using Node.js streams
                const reader = response.body;
                const decoder = new util_1.TextDecoder();
                let fullText = '';
                // Handling stream data with Node.js events
                reader.on('data', (chunk) => {
                    const decodedText = decoder.decode(chunk, { stream: true });
                    const lines = decodedText.split('\n').filter(line => line.trim() !== '');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]')
                                continue;
                            try {
                                const parsedData = JSON.parse(data);
                                if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
                                    fullText += parsedData.choices[0].delta.content;
                                    onChunk(fullText);
                                }
                            }
                            catch (e) {
                                console.error('Error parsing streaming data:', e);
                            }
                        }
                    }
                });
                reader.on('end', () => {
                    console.log('Stream ended');
                    // Call the completion handler when stream is finished
                    if (onComplete)
                        onComplete(fullText);
                });
                reader.on('error', (err) => {
                    console.error('Error while reading the stream:', err);
                });
            }
            catch (error) {
                if (error.name === 'AbortError') {
                    console.log('Request was aborted');
                }
                else {
                    throw error;
                }
            }
            finally {
                this._abortController = null;
            }
        });
    }
    cancelRequest() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }
}
exports.LlmService = LlmService;
