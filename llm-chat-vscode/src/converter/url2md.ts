/**
 * url2md.ts
 * Specialized converter for transforming web content and HTML files to Markdown
 */

import { X2md, X2mdOptions } from './x2md';
import { parseHTML } from 'linkedom';
import fetch from 'node-fetch';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import * as fs from 'fs';
import * as path from 'path';

// URL detection regex - used only for canHandle method
const URL_REGEX = /^(https?:\/\/)(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/i;
// HTML file extension regex
const HTML_FILE_REGEX = /\.(html|htm)$/i;

// Extend base options interface
export interface Url2mdOptions extends X2mdOptions {
  timeout?: number;
  userAgent?: string;
  includeMetadata?: boolean;
}

/**
 * Converter class for URL and HTML files to Markdown
 */
export class Url2md extends X2md {
  private turndownService: TurndownService;
  
  /**
   * Constructor for URL/HTML converter
   * @param options - Configuration options
   */
  constructor(options: Url2mdOptions = {}) {
    super(options);
    
    // Default options specific to URL/HTML conversion
    this.options = {
      ...this.options,
      timeout: 10000, // 10 seconds
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      includeMetadata: true,
      ...options
    };
    
    // Initialize the HTML to Markdown converter
    this.turndownService = new TurndownService({
      headingStyle: this.options.headingStyle as 'atx' | 'setext',
      bulletListMarker: this.options.bulletListMarker as '*' | '-' | '+',
      codeBlockStyle: this.options.codeBlockStyle as 'fenced' | 'indented',
      emDelimiter: this.options.emDelimiter as '*' | '_',
      strongDelimiter: this.options.strongDelimiter as '**' | '__'
    });
  }

  /**
   * Check if this converter can handle the given source
   * @param source - Source to check
   * @returns True if this converter can handle the source
   */
  canHandle(source: string): boolean {
    // Handle URLs
    if (URL_REGEX.test(source)) {
      return true;
    }
    
    // Handle local HTML files
    try {
      if (fs.existsSync(source) && fs.statSync(source).isFile() && HTML_FILE_REGEX.test(source)) {
        return true;
      }
    } catch (e) {
      // Ignore file system errors
    }
    
    return false;
  }

  /**
   * Convert URL or HTML file content to Markdown
   * @param source - URL or file path to convert
   * @returns Promise resolving to Markdown content
   */
  async toMarkdown(source: string): Promise<string> {
    // Determine if we're dealing with a URL or a file
    const isUrl = URL_REGEX.test(source);
    const isHtmlFile = !isUrl && HTML_FILE_REGEX.test(source);
    
    let html: string;
    let sourceType: string;
    let sourceIdentifier: string;
    
    try {
      // Fetch content based on source type
      if (isUrl) {
        // Handle URL content
        sourceType = 'URL';
        sourceIdentifier = source;
        html = await this.fetchUrlContent(source);
      } else if (isHtmlFile) {
        // Handle HTML file content
        sourceType = 'File';
        sourceIdentifier = source;
        html = fs.readFileSync(source, 'utf8');
      } else {
        return this.handleError(new Error("Source is neither a valid URL nor an HTML file"), source);
      }
      
      // Process HTML content (common for both URL and HTML file)
      return this.processHtmlContent(html, sourceType, sourceIdentifier);
    } catch (error) {
      return this.handleError(error as Error, source);
    }
  }

  /**
   * Fetch content from a URL
   * @param url - URL to fetch
   * @returns Promise resolving to HTML content as string
   */
  private async fetchUrlContent(url: string): Promise<string> {
    // Fetch content with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 
      (this.options as Url2mdOptions).timeout || 10000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': (this.options as Url2mdOptions).userAgent || 
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    
    return await response.text();
  }

  /**
   * Process HTML content and convert to Markdown
   * @param html - HTML content to process
   * @param sourceType - Type of source (URL or File)
   * @param sourceIdentifier - Source identifier (URL or file path)
   * @returns Markdown content
   */
  private processHtmlContent(html: string, sourceType: string, sourceIdentifier: string): string {
    // Parse HTML with linkedom
    const { document } = parseHTML(html);

    // Apply readability extraction using @mozilla/readability
    const article = new Readability(document).parse();
    
    if (!article) {
      return this.createHeading(`Content from ${sourceIdentifier}`, 1) + 
              "Couldn't extract readable content from this source.";
    }
    
    // Get page title if available
    let pageTitle: string;
    
    if (sourceType === 'URL') {
      pageTitle = article.title || document.title || new URL(sourceIdentifier).hostname;
    } else {
      // For files, use the filename or article title
      const fileName = path.basename(sourceIdentifier);
      pageTitle = article.title || fileName;
    }
    
    // Create markdown from HTML content
    let markdown = this.createHeading(pageTitle, 1);
    
    // Add metadata if enabled
    if ((this.options as Url2mdOptions).includeMetadata) {
      // Add author if available (usually from web content)
      if (article.byline) {
        markdown += `*Author: ${article.byline}*\n\n`;
      }
      
      // Add site name if available (usually from web content)
      if (article.siteName) {
        markdown += `*Source: ${article.siteName}*\n\n`;
      }
      
      // Add source information
      markdown += `*Source: ${sourceType} - ${sourceIdentifier}*\n\n`;
      
      // Add excerpt if available
      if (article.excerpt) {
        markdown += this.createBlockquote(article.excerpt);
      }
    }
    
    // Convert HTML content to Markdown using Turndown
    const htmlContent = article?.content ?? '';
    const contentMarkdown = this.turndownService.turndown(htmlContent);
    markdown += contentMarkdown;
    
    return this.cleanMarkdown(markdown);
  }
}