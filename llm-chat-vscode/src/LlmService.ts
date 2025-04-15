import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { TextDecoder } from 'util';  // Node.js TextDecoder

interface Message {
  role: string;
  content: string;
}

export class LlmService {
  private _abortController: AbortController | null = null;
  
  constructor() {}
  
  public async getStreamingResponse(
    messages: Message[], 
    onChunk: (text: string) => void,
  ): Promise<void> {
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
      const response = await fetch('http://localhost:8080/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer no key`, //${apiKey}
        },
        body: JSON.stringify({
          model: 'gpt-4',  // You can change this to 'gpt-3.5-turbo' or 'gpt-4' depending on your use case
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
      const decoder = new TextDecoder();
      let fullText = '';

      // Handling stream data with Node.js events
      reader.on('data', (chunk: Buffer) => {
        const decodedText = decoder.decode(chunk, { stream: true });
        const lines = decodedText.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsedData = JSON.parse(data);
              if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
                fullText += parsedData.choices[0].delta.content;
                onChunk(fullText);
              }
            } catch (e) {
              console.error('Error parsing streaming data:', e);
            }
          }
        }
      });

      reader.on('end', () => {
        console.log('Stream ended');
      });

      reader.on('error', (err: Error) => {
        console.error('Error while reading the stream:', err);
      });

    } catch (error:any) {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
      } else {
        throw error;
      }
    } finally {
      this._abortController = null;
    }
  }
  
  public cancelRequest() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }
}
