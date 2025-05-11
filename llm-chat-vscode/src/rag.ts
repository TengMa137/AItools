// rag.ts - simple rag pipeline

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { KnowledgeGraph, KnowledgeGraphBuilder, GraphNode } from './Graph/knowledgeGraph'
import { GraphVisualizer } from './Graph/graphVisualizer'

/**
 * TextChunk interface for representing a chunk of text with metadata
 * useful for RAG applications
 */
export interface TextChunk {
  // Core content
  content: string;
  
  // Positioning information
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  
  // Metadata for better retrieval
  separatorUsed?: string;

  // Context information for better RAG results
  title?: string;                  // Section/document title if available
  precedingText?: string;          // Short context from preceding chunk
  followingText?: string;          // Short context from following chunk
  
  // Source tracking
  sourceFile?: string;             // Source file name
  sourcePage?: number;             // Page number for PDFs
  
  // Technical metadata
  hash?: string;                   // Hash for deduplication
  chunkCreatedAt: Date;            // When this chunk was created
}

export interface SelectionMetadata {
  filePath: string;
  startLine: number;
  endLine: number;
}

export class RagService {
  private vectorStore: Map<string, {
    vector: number[],
    chunk: TextChunk,
    filePath: string
  }> = new Map();
  
  private embeddingEndpoint: string;
  private apiKey: string;
  private cachePath: string;
  private _graph: KnowledgeGraph = {
    nodes: new Map<string, GraphNode>(),
    edges: []
  };

  constructor(apiKey: string, embeddingEndpoint: string = 'http://192.168.1.117:8081/v1/embeddings') {
    this.apiKey = apiKey;
    this.embeddingEndpoint = embeddingEndpoint;
    
    // Setup storage for vector cache
    this.cachePath = path.join(
      vscode.workspace.workspaceFolders?.[0].uri.fsPath || "",
      ".vscode",
      "rag-cache"
    );
    
    if (!fs.existsSync(this.cachePath)) {
      fs.mkdirSync(this.cachePath, { recursive: true });
    }
    
    // Try to load cached vectors
    this.loadVectorCache();
  }
  
  /**
   * Get embedding for text using OpenAI API
   */
  private async getEmbedding(inputText: string): Promise<number[]> {
    const response = await fetch(this.embeddingEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`, // dummy key, often ignored in local llamacpp
      },
      body: JSON.stringify({
        input: inputText,
        model: 'GPT-4', // model name is just a placeholder; llamacpp may ignore it
        encoding_format: 'float'
      })
    });
  
    if (!response.ok) {
      throw new Error(`Failed to get embedding: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Get embd ${data}`);
    return data.data[0].embedding; // assuming OpenAI-style embedding format
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Index a workspace directory
   */
  public async indexWorkspace(useDB: boolean = false, progressCallback?: (message: string) => void): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error("No workspace folder is open");
    }
    
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    progressCallback?.("Finding workspace files...");
    
    // Get all files to index
    const filePaths = this.getFilesToIndex(workspacePath);
    
    let processed = 0;
    progressCallback?.(`Found ${filePaths.length} files to process`);
    console.log(`Found ${filePaths.length} files to process`);

    const knowledgeGraphBuilder = new KnowledgeGraphBuilder(workspacePath);

    if(useDB){
      // Process files in batches to avoid rate limiting
      for (const filePath of filePaths) {
        try {
          console.log(`Indexing ${filePath}`);
          await this.indexFile(filePath);
          processed++;

          progressCallback?.(`Processed ${processed}/${filePaths.length} files`);
          // Save progress occasionally
          this.saveVectorCache();
          
        } catch (error) {
          console.error(`Error indexing ${filePath}:`, error);
        }
      }
      this.saveVectorCache();
      progressCallback?.(`Indexing complete. Processed ${processed} files.`);
    }
    
    // Build file knowledge graph
    await knowledgeGraphBuilder.buildGraph(filePaths, useDB, progressCallback);
    progressCallback?.("Generating file knowledge graph...");
    // Generate visualizations
    const visualizer = new GraphVisualizer(
      knowledgeGraphBuilder.getGraph(), 
      path.join(workspacePath, 'visualizations')
    );
    progressCallback?.("Generating visualizatoins of Graph");
    await visualizer.generateD3Visualization();
    await visualizer.exportGraphJson();

    this._graph = knowledgeGraphBuilder.getGraph()
  }
  
  /**
   * Determine which files to index
   */
  private getFilesToIndex(dirPath: string): string[] {
    const ignorePatterns = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'out',
      '.vscode',
      '.github',
      'md-notes'
    ];
    
    const fileExtensions = [
      '.ts', '.js', '.tsx', '.jsx', '.json', '.md', 
      '.py', '.html', '.css', '.scss', '.c', '.cpp',
      '.hpp','.java', '.go', '.rs', '.swift'
    ];
    
    const result: string[] = [];
    
    const walkDir = (currentPath: string) => {
      const files = fs.readdirSync(currentPath);
      
      for (const file of files) {
        const filePath = path.join(currentPath, file);
        const stat = fs.statSync(filePath);
        
        // Skip ignored directories
        if (stat.isDirectory()) {
          if (!ignorePatterns.some(pattern => file === pattern || file.startsWith(pattern + '/'))) {
            walkDir(filePath);
          }
          continue;
        }
        
        // Only include files with supported extensions
        const ext = path.extname(file);
        if (fileExtensions.includes(ext)) {
          result.push(filePath);
        }
      }
    };
    
    walkDir(dirPath);
    return result;
  }
  
  /**
   * Index a single file
   */
  public async indexFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const chunk_separators: string[] = [];

      switch (path.extname(filePath)) {
        case '.py':
          chunk_separators.push('\nclass', '\ndef', '\n\n');
          break;
        case '.cpp':
        case '.cc':
          chunk_separators.push('\nclass', '\nvoid', '\nint', '\n\n');
          break;
        case '.ts':
        case '.js':
          chunk_separators.push('\nclass', '\nfunction', '\nconst', '\nlet', '\n\n');
          break;
        default:
          chunk_separators.push('\n\n');
      }
      // Split the file into chunks of reasonable size
      const chunks = this.chunkText(chunk_separators, content, 1000, 100, { sourceFile: filePath });
      console.log(`Get ${chunks.length} chunks`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = `${filePath}:${i}`;
        console.log(`Get id ${chunkId}`);
        // Skip if already indexed
        if (this.vectorStore.has(chunkId)) {
          console.log("skip");
          continue;
        }
        
        const vector = await this.getEmbedding(chunk.content);
        console.log(`embeding`);
        // Store the vector, content, and metadata
        this.vectorStore.set(chunkId, {
          vector,
          chunk: chunk,
          filePath
        });
      }
      console.log(`Get ${chunks.length} chunks embedded.`);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Get relevant content for a query
   */
  public async queryRelevantContent(query: string, references: string[] = [], topK: number = 3): Promise<string> {
    if (this.vectorStore.size === 0) {
      throw new Error("No content has been indexed yet.");
    }
    
    // Get embedding for the query
    const queryVector = await this.getEmbedding(query);
    
    // Find most similar chunks
    const similarities: Array<{
      id: string,
      similarity: number,
      chunk: TextChunk,
      filePath: string
    }> = [];
    
    for (const [id, data] of this.vectorStore.entries()) {
      if (!references.includes(data.filePath)) {
        continue;
      }
      const similarity = this.cosineSimilarity(queryVector, data.vector);
      similarities.push({
        id,
        similarity,
        chunk: data.chunk,
        filePath: data.filePath
      });
    }
    
    // Sort by similarity (highest first)
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    // Take top K results
    const topResults = similarities.slice(0, topK);
    
    // Format the context
    let context = "Relevant code context:\n\n";
    for (const result of topResults) {
      const relativePath = path.relative(
        vscode.workspace.workspaceFolders?.[0].uri.fsPath || "",
        result.filePath
      );
      context += `--- From ${relativePath} (similarity: ${result.similarity.toFixed(2)}) ---\n`;
      context += result.chunk.content + "\n\n";
    }
    
    return context;
  }
  
  /**
   * Get relevant files for a specific selection
   */
  private async getRelevantFilesFromGraph(filePath: string): Promise<string[]> {
    const relatedFiles = new Set<string>();
    // Find the node ID for the given file path
    let fileNodeId: string | null = null;
    // First, identify the node ID for the given file
    for (const [id, node] of this._graph.nodes.entries()) {
      if (node.type === 'file' && node.location.filePath === filePath) {
        fileNodeId = id;
        break;
      }
    }
    // If file node not found, return empty array
    if (!fileNodeId) {
      return [];
    }
    // Find all files that the given file imports
    for (const edge of this._graph.edges) {    
      if (edge.type === 'imports' && edge.source === fileNodeId) {
        const targetNode = this._graph.nodes.get(edge.target);
        if (targetNode && targetNode.type === 'file' && targetNode.location.filePath !== filePath) {
          relatedFiles.add(targetNode.location.filePath);
        }
      }
    }
    
    // Convert Set to Array and return
    return Array.from(relatedFiles);
  }

  /**
   * Get relevant nodes for a specific selection
   */
  private async getRelevantNodesFromGraph(metadata: SelectionMetadata): 
    Promise<{primaryNodes: GraphNode[], referedNodes: GraphNode[]}> { // calledFromNodes: GraphNode[]
    // Convert the Map to array for iteration
    const nodes = Array.from(this._graph.nodes.values());
    
    // Find nodes that are in the same file
    const candidateNodes = nodes.filter(node => 
      node.location.filePath === metadata.filePath
    );
    
    // No nodes in this file
    if (candidateNodes.length === 0) {
      console.log('File not included in Graph.')
      return {
        primaryNodes: [],
        referedNodes: [],
        // calledFromNodes: []
      };
    }
    
    // Find all nodes that completely contain the selection
    const containingNodes = candidateNodes.filter(node => 
      node.location.startLine <= metadata.startLine + 1 && 
      node.location.endLine >= metadata.endLine
    );
    
    let primaryNodes: GraphNode[] = [];
    
    if (containingNodes.length > 0) {
      // Return all containing nodes, sorted from most specific to least specific
      primaryNodes = containingNodes.sort((a, b) => {
        const scopeA = a.location.endLine - a.location.startLine;
        const scopeB = b.location.endLine - b.location.startLine;
        return scopeA - scopeB; // Sort by ascending scope size (most specific first)
      });
    } 
    
    // Find nodes that are referenced by the primary nodes
    const referedNodes: GraphNode[] = [];
    
    // Find nodes that call the primary nodes
    // const calledFromNodes: GraphNode[] = [];
    
    // Get primary node IDs
    //const primaryNodeIds = primaryNodes.map(node => node.id);
    const primaryNodeIds = new Set(primaryNodes.map(node => node.id));
    // Find all nodes that have a relationship with the primary nodes
    if (primaryNodes.length > 0) {
      // Get all edges connected to the primary nodes
      const relatedEdges = this._graph.edges.filter(edge => 
        primaryNodeIds.has(edge.source) //|| primaryNodeIds.has(edge.target)
      );
      
      // Get all node IDs from related edges
      const relatedNodeIds = new Set<string>();
      relatedEdges.forEach(edge => {
        if (!primaryNodeIds.has(edge.source)) relatedNodeIds.add(edge.source);
        //if (!primaryNodeIds.has(edge.target)) calledFromNodes.add(edge.target);
      });
      
      // Get the actual node objects
      relatedNodeIds.forEach(id => {
        const node = this._graph.nodes.get(id);
        if (node) referedNodes.push(node);
      });
    } 
    
    return {
      primaryNodes,
      referedNodes,
      //calledFromNodes
    };
  }

  /**
   * Extract context from nodes and return a string to feed LLM.
   */
  private async extractContextFromNodes(primaryNodes: GraphNode[], referedNodes: GraphNode[]): Promise<Array<[number, number]>>{
  // ): Promise<{
  //   currentFileRanges: Array<[number, number]>;  // Line ranges in current file
  //   externalFileRanges: Record<string, Array<[number, number]>>;  // Line ranges in other files
  //   callerFileRanges: Record<string, Array<[number, number]>>;  // Line ranges of callers
  // }> {
    if (primaryNodes.length === 0) {
      return [];
      // {
      //   currentFileRanges: [],
      //   externalFileRanges: {},
      //   callerFileRanges: {}
      // };
    }
    if (primaryNodes[0].type === 'file') {
      return [[primaryNodes[0].location.startLine, primaryNodes[0].location.endLine]]
    }
    
    // Get the main file path from primary nodes
    const mainFilePath = primaryNodes[0].location.filePath;
    // const mainSelectedNode = primaryNodes[0].id;//: Array<[number, number]> = [[primaryNodes[0].location.startLine, primaryNodes[0].location.endLine]];
    console.log(`prime node id ${primaryNodes[0].id}, start: ${primaryNodes[0].location.startLine}, end: ${primaryNodes[0].location.endLine}.`)

    // Part 1: Current file ranges
    // Group nodes by file
    const currentFileNodes = [...primaryNodes, ...referedNodes].filter(
      node => node.location.filePath === mainFilePath
    );
    // // Return all containing nodes, sorted from most specific to least specific
    // primaryNodes = containingNodes.sort((a, b) => {
    //   const scopeA = a.location.endLine - a.location.startLine;
    //   const scopeB = b.location.endLine - b.location.startLine;
    //   return scopeA - scopeB; // Sort by ascending scope size (most specific first)
    // });
    
    // Sort by startLine to preserve file order
    // currentFileNodes.sort((a, b) => a.location.startLine - b.location.startLine);
    
    // Extract line ranges, merging overlapping ranges
    const currentFileRanges: Array<[number, number]> = [];
    currentFileNodes.forEach(node => {
      if (node.id === primaryNodes[0].id) {
        currentFileRanges.push([node.location.startLine - 1, node.location.endLine - 1])
        console.log(`start: ${node.location.startLine}, end: ${node.location.endLine}.`)
      } else {
        if (node.type === 'file') {
          return [];
        }
        currentFileRanges.push([node.location.startLine, node.location.startLine])
        console.log(`start: ${node.location.startLine}, end: ${node.location.startLine}.`)
      }
      
      // // Try to merge with existing ranges if they overlap
      // let merged = false;
      // for (let i = 0; i < currentFileRanges.length; i++) {
      //   const range = currentFileRanges[i];
        
      //   // Check if ranges overlap or are adjacent
      //   if (newRange[0] <= range[1] + 1 && range[0] <= newRange[1] + 1) {
      //     // Merge ranges
      //     range[0] = Math.min(range[0], newRange[0]);
      //     range[1] = Math.max(range[1], newRange[1]);
      //     merged = true;
      //     break;
      //   }
      // }
      
      // // Add as new range if not merged
      // if (!merged) {
      //   currentFileRanges.push([...newRange]);
      // }
    });
    
    // // Part 2: Referenced nodes in other files
    // const externalFileRanges: Record<string, Array<[number, number]>> = {};
    
    // const externalReferedNodes = referedNodes.filter(
    //   node => node.location.filePath !== mainFilePath
    // );
    
    // externalReferedNodes.forEach(node => {
    //   const filePath = node.location.filePath;
    //   if (!externalFileRanges[filePath]) {
    //     externalFileRanges[filePath] = [];
    //   }
      
    //   const newRange: [number, number] = [node.location.startLine, node.location.endLine];
      
    //   // Try to merge with existing ranges
    //   let merged = false;
    //   for (let i = 0; i < externalFileRanges[filePath].length; i++) {
    //     const range = externalFileRanges[filePath][i];
        
    //     // Check if ranges overlap or are adjacent
    //     if (newRange[0] <= range[1] + 1 && range[0] <= newRange[1] + 1) {
    //       // Merge ranges
    //       range[0] = Math.min(range[0], newRange[0]);
    //       range[1] = Math.max(range[1], newRange[1]);
    //       merged = true;
    //       break;
    //     }
    //   }
      
    //   // Add as new range if not merged
    //   if (!merged) {
    //     externalFileRanges[filePath].push([...newRange]);
    //   }
    // });
    // Sort all ranges by start line
    currentFileRanges.sort((a, b) => a[0] - b[0]);
    
    // Object.keys(externalFileRanges).forEach(filePath => {
    //   externalFileRanges[filePath].sort((a, b) => a[0] - b[0]);
    // });
    
    // Object.keys(callerFileRanges).forEach(filePath => {
    //   callerFileRanges[filePath].sort((a, b) => a[0] - b[0]);
    // });
    
    return currentFileRanges;
    // {
    //   currentFileRanges
    //   externalFileRanges,
    //   callerFileRanges
    // };
  }

  /**
   * Get relevant context for a specific selection
   */
  public async getContextForSelection(selectedText: string, metadata: SelectionMetadata): Promise<string> {
    if (this._graph.nodes.size != 0) {
      const references = await this.getRelevantFilesFromGraph(metadata.filePath);
      return this.queryRelevantContent(selectedText, references);
    }
    return selectedText;
  }

  /**
   * Get simplified file with selected lines
   */
  public async getSelectedLines(metadata: SelectionMetadata): Promise<Array<[number, number]>> {
    // Get the relevant nodes both in the same file as selectedText and other files in the workspace. 
    const { primaryNodes, referedNodes } = await this.getRelevantNodesFromGraph(metadata);
    return this.extractContextFromNodes(primaryNodes, referedNodes);
  }


  /**
   * Split text into chunks with some overlap.
   * Uses hierarchical splitting: e.g. ['\nclass', '\ndef', '\n\n'].
   * Falls back to line-based chunking if no separators are left.
   */
  private chunkText(
    chunk_separators: string[],
    text: string,
    chunkSize: number,
    overlap: number = 200,
    metadata: {
      sourceFile?: string;
    } = {}
  ): TextChunk[] {
    // Helper function to create a TextChunk
    const createChunk = (
      content: string,
      index: number,
      startOffset: number,
      separatorUsed?: string,
    ): TextChunk => {
      
      return {
        content,
        chunkIndex: index,
        startOffset,
        endOffset: startOffset + content.length,
        separatorUsed,
        sourceFile: metadata.sourceFile,
        chunkCreatedAt: new Date()
      };
    };
    
    // If text is smaller than chunk size, return it as a single chunk
    if (text.length <= chunkSize) {
      return [createChunk(text, 0, 0, undefined)];
    }

    const chunks: TextChunk[] = [];
    let chunkIndex = 0;

    // Recursively split text using the separators hierarchy
    const splitByHierarchy = (
      text: string,
      startOffset: number,
      separatorIndex: number,
    ): void => {
      // If we've run out of separators, fall back to line-based chunking
      if (separatorIndex >= chunk_separators.length) {
        const lines = text.split('\n');
        let currentChunk = '';
        let currentOffset = startOffset;
        let chunkStartOffset = startOffset;
        
        for (const line of lines) {
          const lineWithNewline = currentChunk.length > 0 ? '\n' + line : line;
          
          // If adding this line would exceed chunk size and we already have content
          if (currentChunk.length + lineWithNewline.length > chunkSize && currentChunk.length > 0) {
            // Add current chunk to results
            chunks.push(createChunk(
              currentChunk, 
              chunkIndex++, 
              chunkStartOffset, 
              'line-based',
            ));
            
            // Start new chunk with overlap from previous chunk if possible
            const overlapText = currentChunk.length > overlap ? 
              currentChunk.slice(-overlap) : currentChunk;            
            chunkStartOffset = currentOffset - overlapText.length;
            currentChunk = overlapText;            
            // Add current line to the new chunk with proper offset accounting
            if (currentChunk.length > 0) {
              currentChunk += '\n';
            }
            currentChunk += line;
          } else {
            // Just add the line to the current chunk
            if (currentChunk.length > 0) {
              currentChunk += '\n';
            }
            currentChunk += line;
          }          
          currentOffset += line.length + (currentChunk.length > line.length ? 1 : 0); // +1 for newline
        }
        
        // Add the final chunk if there's anything left
        if (currentChunk.length > 0) {
          chunks.push(createChunk(
            currentChunk, 
            chunkIndex++, 
            chunkStartOffset, 
            'line-based',
          ));
        }        
        return;
      }
      
      const currentSeparator = chunk_separators[separatorIndex];
      const segments = text.split(currentSeparator);
      
      // If the separator doesn't effectively split the text (only one segment)
      // or if all segments are still too large, move to next separator
      // if (segments.length === 1) {
      //   splitByHierarchy(text, startOffset, separatorIndex + 1);
      //   return;
      // }
      
      let currentChunk = '';
      let currentOffset = startOffset;
      let chunkStartOffset = startOffset;

      // Process each segment
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentWithSeparator = i > 0 ? currentSeparator + segment : segment;

        // If adding this segment would make the chunk too large
        if (currentChunk.length + segmentWithSeparator.length > chunkSize) {
          // If we have content in the current chunk, add it to results
          if (currentChunk.length > 0) {
            chunks.push(createChunk(
              currentChunk, 
              chunkIndex++, 
              chunkStartOffset, 
              currentSeparator,
            ));
            
            chunkStartOffset = currentOffset;
            currentChunk = '';
          }
          
          // If the segment itself is too large, recursively process it with the next separator
          if (segmentWithSeparator.length > chunkSize) {
            splitByHierarchy(
              segmentWithSeparator, 
              currentOffset, 
              separatorIndex + 1,
            );
            currentOffset += segmentWithSeparator.length;
          } else {
            // Otherwise add it as its own chunk
            currentChunk = segmentWithSeparator;
            currentOffset += segmentWithSeparator.length;
          }
        } else {
          // Add segment to the current chunk
          currentChunk += segmentWithSeparator;
          currentOffset += segmentWithSeparator.length;
        }
      }
      
      // Add the final chunk if there's anything left
      if (currentChunk.length > 0) {
        chunks.push(createChunk(
          currentChunk, 
          chunkIndex++, 
          chunkStartOffset, 
          currentSeparator,
        ));
      }
    };
    
    // Start the recursive splitting
    splitByHierarchy(text, 0, 0);
    
    // Add preceding and following text context to each chunk
    const addContextToChunks = (chunks: TextChunk[]): TextChunk[] => {
      const contextSize = Math.min(150, overlap / 2); // Use smaller context for context fields
      
      return chunks.map((chunk, index) => {
        // Add preceding context if not the first chunk
        if (index > 0) {
          const prevChunk = chunks[index - 1];
          chunk.precedingText = prevChunk.content.slice(-contextSize);
        }
        
        // Add following context if not the last chunk
        if (index < chunks.length - 1) {
          const nextChunk = chunks[index + 1];
          chunk.followingText = nextChunk.content.slice(0, contextSize);
        }
        
        return chunk;
      });
    };
    
    // Add context information and return the result
    return addContextToChunks(chunks);
  }
  
  /**
   * Save vector cache to disk
   */
  private saveVectorCache(): void {
    try {
      const cacheData: Record<string, any> = {};
      
      // Convert Map to Object for serialization
      for (const [id, data] of this.vectorStore.entries()) {
        cacheData[id] = data;
      }
      
      fs.writeFileSync(
        path.join(this.cachePath, 'vector-cache.json'),
        JSON.stringify(cacheData),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save vector cache:', error);
    }
  }
  
  /**
   * Load vector cache from disk
   */
  private loadVectorCache(): void {
    try {
      const cachePath = path.join(this.cachePath, 'vector-cache.json');
      
      if (fs.existsSync(cachePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        
        // Convert Object back to Map
        for (const [id, data] of Object.entries(cacheData)) {
          this.vectorStore.set(id, data as any);
        }
        
        console.log(`Loaded ${this.vectorStore.size} vectors from cache.`);
      }
    } catch (error) {
      console.error('Failed to load vector cache:', error);
    }
  }
  
  /**
   * Check if the workspace is indexed
   */
  public isIndexed(): boolean {
    const filePath = path.join(this.cachePath, 'vector-cache.json');
    return fs.existsSync(filePath);
  }

  /**
   * Clear the vector store
   */
  public resetIndex(): void {
    this.vectorStore.clear();
    
    // Clean cache directory
    if (fs.existsSync(this.cachePath)) {
      fs.unlinkSync(path.join(this.cachePath, 'vector-cache.json'));
    }
  }
}