/**
 * converterFactory.ts
 * Factory for creating the appropriate converter based on input
 */

import * as path from 'path';
import * as fs from 'fs';
import { X2md, X2mdOptions } from './x2md';
import { Url2md } from './url2md';
import { Pdf2md } from './pdf2md';

// Conversion result interface
export interface ConversionResult {
  success: boolean;
  markdown: string;
  error: string | null;
}

// Extension map type
type ExtensionMap = {
  [key: string]: string;
}

/**
 * Factory class for managing and using converters
 */
export class ConverterFactory {
  private converters: X2md[];
  private extensionMap: ExtensionMap;

  /**
   * Constructor for the converter factory
   */
  constructor() {
    // Register all available converters
    this.converters = [
      new Url2md(),
      new Pdf2md(),
      // Add more converters here as they're implemented
      //
      // new Txt2md(),
      // new Html2md(),
      // etc.
    ];
    
    // Store path extension to converter mapping for quick lookups
    this.extensionMap = {
      // Examples for future extensions:
      '.pdf': 'Pdf2md',
      // '.txt': 'Txt2md',
      '.html': 'Url2md',
      '.htm': 'Url2md',
      // '.doc': 'Doc2md',
      // '.docx': 'Doc2md',
    };
  }

  /**
   * Extract URLs or file paths from a general string input
   * @param input - String that might contain URLs or file paths
   * @returns Array of extracted URLs or file paths
   */
  private extractSourcesFromString(input: string): string[] {
    const sources: string[] = [];
    
    // URL regex pattern - matches common URL formats
    const urlPattern = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    
    // Extract URLs
    const urlMatches = input.match(urlPattern);
    if (urlMatches) {
      sources.push(...urlMatches);
    }
    
    // File path patterns
    const patterns = [
      // Absolute paths for Unix/Linux/macOS (supports all Unicode letters and symbols)
      /\/(?:[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\/)*[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\.[\p{L}\p{N}]+/gu,
    
      // Windows absolute paths (supports all Unicode letters and symbols)
      /[a-zA-Z]:\\(?:[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\\)*[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\.[\p{L}\p{N}]+/gu,
    
      // Relative paths (supports all Unicode letters and symbols)
      /\.\/(?:[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\/)*[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\.[\p{L}\p{N}]+/gu,
      /\.\.\/(?:[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\/)*[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\.[\p{L}\p{N}]+/gu,
    
      // Simple filename with extension (supports all Unicode letters and symbols)
      /\b[\p{L}\p{N}_-]+(?:[.\s][\p{L}\p{N}_-]+)*\.[\p{L}\p{N}]+\b/gu
    ];    
    
    
    // Extract file paths
    for (const pattern of patterns) {
      const matches = input.match(pattern);
      if (matches) {
        // Filter to only include matches that actually exist as files
        const existingFiles = matches.filter(match => {
          try {
            return fs.existsSync(match) && fs.statSync(match).isFile();
          } catch {
            return false;
          }
        });
        sources.push(...existingFiles);
      }
    }
    
    // Remove duplicates
    return [...new Set(sources)];
  }

  /**
   * Determine if source is a local file
   * @param source - Path or URL to check
   * @returns True if source appears to be a local file
   */
  private isLocalFile(source: string): boolean {
    // Check for absolute paths
    if (path.isAbsolute(source)) {
      return true;
    }
    
    // Check for relative paths with ./ or ../
    if (source.startsWith('./') || source.startsWith('../')) {
      return true;
    }
    
    // Check for Windows drive letters
    if (/^[a-zA-Z]:[\\\/]/.test(source)) {
      return true;
    }
    
    // Check if file exists in current directory
    try {
      return fs.existsSync(source) && fs.statSync(source).isFile();
    } catch (e) {
      return false;
    }
  }

  /**
   * Get file extension from path
   * @param filePath - Path to extract extension from
   * @returns File extension including the dot (e.g., '.pdf')
   */
  private getFileExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase();
  }

  /**
   * Get the appropriate converter for the given source
   * @param source - Source to convert (URL or file path)
   * @returns Appropriate converter instance or null if none found
   */
  public getConverter(source: string): X2md | null {
    // First try direct converter detection (based on canHandle method)
    for (const converter of this.converters) {
      if (converter.canHandle(source)) {
        return converter;
      }
    }
    
    // If no direct match, try to determine based on file extension
    if (this.isLocalFile(source)) {
      const extension = this.getFileExtension(source);
      const converterName = this.extensionMap[extension];
      
      if (converterName) {
        // Find converter with matching class name
        return this.converters.find(c => c.constructor.name === converterName) || null;
      }
    }
    
    // No suitable converter found
    return null;
  }

  /**
   * Convert source to Markdown
   * @param input - Source to convert (URL, file path, or text containing them)
   * @param options - Options to pass to the converter
   * @returns Promise resolving to conversion result
   */
  public async convert(input: string, options: X2mdOptions = {}): Promise<ConversionResult> {
    // Store original input for reporting
    const originalInput = input;
    
    // Extract URLs or file paths if input is a general string
    const sources = this.extractSourcesFromString(input);
    
    // If we found sources in the string, use the first one
    const source = sources.length > 0 ? sources[0] : input;
    
    // Get appropriate converter
    const converter = this.getConverter(source);
    
    let parseInput = '###User input:\n' + originalInput;
    if (!converter) {
      return {
        success: false,
        markdown: parseInput,
        error: `No suitable converter found for: ${source}`
      };
    }
    
    try {
      // Apply any override options
      Object.assign(converter, { options: { ...converter['options'], ...options } });
      
      // Perform conversion
      const markdown = parseInput + '\n###Context:\n' + await converter.toMarkdown(source);
      
      return {
        success: true,
        markdown,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        markdown: parseInput,
        error: `Conversion error: ${(error as Error).message}`
      };
    }
  }

  /**
   * Convert multiple sources found in input text
   * @param input - Text that may contain multiple URLs or file paths
   * @param options - Options to pass to the converters
   * @returns Promise resolving to array of conversion results
   */
  public async convertAll(input: string, options: X2mdOptions = {}): Promise<ConversionResult[]> {
    // Extract all URLs or file paths from the input
    const sources = this.extractSourcesFromString(input);
    
    // If no sources found, try to convert the entire input
    if (sources.length === 0) {
      const result = await this.convert(input, options);
      return [result];
    }
    
    // Convert each source
    const results: ConversionResult[] = [];
    for (const source of sources) {
      results.push(await this.convert(source, options));
    }
    
    return results;
  }

  /**
   * Register a new converter
   * @param converter - Converter instance to register
   * @param fileExtensions - File extensions this converter can handle
   */
  public registerConverter(converter: X2md, fileExtensions: string[] = []): void {
    this.converters.push(converter);
    
    // Register file extensions
    for (const ext of fileExtensions) {
      const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      this.extensionMap[normalizedExt] = converter.constructor.name;
    }
  }
}