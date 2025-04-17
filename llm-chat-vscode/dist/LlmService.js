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
const util_1 = require("util");
class LlmService {
    constructor() {
        this._abortController = null;
        this._activeRequest = null;
    }
    getStreamingResponse(messages, onChunk, onComplete) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Starting getStreamingResponse');
            onComplete(false);
            // If there's already a running request, cancel it first
            if (this._abortController) {
                console.log('Cancelling existing request');
                this.cancelRequest();
            }
            // Create a new abort controller for this request
            this._abortController = new AbortController();
            const controller = this._abortController;
            let fullText = '';
            // Create a promise that we can wait for
            this._activeRequest = new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                try {
                    console.log('Starting fetch request');
                    const response = yield (0, node_fetch_1.default)('http://localhost:8080/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer no key`,
                        },
                        body: JSON.stringify({
                            model: 'gpt-4',
                            messages: messages,
                            stream: true
                        }),
                        signal: controller.signal
                    });
                    console.log('Fetch request completed, status:', response.status);
                    if (!response.ok || !response.body) {
                        throw new Error(`API request failed: ${response.statusText}`);
                    }
                    const reader = response.body;
                    const decoder = new util_1.TextDecoder();
                    reader.on('data', (chunk) => {
                        if (controller.signal.aborted) {
                            console.log('Request was aborted during data processing');
                            return;
                        }
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
                        console.log('Stream ended normally');
                        onComplete(true);
                        resolve();
                    });
                    reader.on('error', (err) => {
                        console.error('Error while reading the stream:', err);
                        if (err.name === 'AbortError') {
                            console.log('Stream aborted');
                            onChunk('Aborted');
                            onComplete(true);
                            resolve();
                        }
                        else {
                            reject(err);
                        }
                    });
                }
                catch (error) {
                    console.log('Caught error in fetch:', error.name, error.message);
                    if (error.name === 'AbortError') {
                        console.log('Request was aborted successfully');
                        onComplete(true);
                        resolve();
                    }
                    else {
                        reject(error);
                    }
                }
            }));
            try {
                // Wait for the request to complete
                yield this._activeRequest;
            }
            finally {
                // Only clear the controller if it's still the same one
                if (this._abortController === controller) {
                    console.log('Clearing abort controller in finally block');
                    this._abortController = null;
                }
                this._activeRequest = null;
            }
        });
    }
    cancelRequest() {
        console.log('cancelRequest called, controller exists:', !!this._abortController);
        if (this._abortController) {
            this._abortController.abort();
            console.log('Called abort() on controller');
        }
    }
}
exports.LlmService = LlmService;
