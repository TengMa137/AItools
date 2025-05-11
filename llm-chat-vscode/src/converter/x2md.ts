/**
 * x2md.ts
 * Base class for converters that transform various formats to Markdown
 */

export interface X2mdOptions {
  headingStyle?: 'atx' | 'setext';
  hr?: string;
  bulletListMarker?: '*' | '+' | '-';
  codeBlockStyle?: 'fenced' | 'indented';
  emDelimiter?: '*' | '_';
  strongDelimiter?: '**' | '__';
  linkStyle?: 'inlined' | 'referenced';
  [key: string]: any; // Allow additional custom options
}

/**
 * Abstract base class for converting content to Markdown
 */
export abstract class X2md {
  protected options: X2mdOptions;

  /**
   * Constructor for base converter class
   * @param options - Configuration options for the converter
   */
  constructor(options: X2mdOptions = {}) {
    this.options = {
      headingStyle: 'atx', // # Heading (atx) or Heading\n======= (setext)
      hr: '---',
      bulletListMarker: '*',
      codeBlockStyle: 'fenced', // ```code``` (fenced) or 4-space indentation
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined', // [text](url) or [text][id]
      ...options
    };
  }

  /**
   * Convert content to Markdown (to be implemented by subclasses)
   * @param source - Source content or identifier (e.g., URL, file path)
   * @returns Promise resolving to Markdown content
   */
  abstract toMarkdown(source: string): Promise<string>;

  /**
   * Check if this converter can handle the given source
   * @param source - Source to check
   * @returns True if this converter can handle the source
   */
  abstract canHandle(source: string): boolean;

  /**
   * Clean and normalize the Markdown
   * @param markdown - Raw markdown to clean
   * @returns Cleaned markdown
   */
  protected cleanMarkdown(markdown: string): string {
    if (!markdown) return '';
    
    // Remove excessive blank lines (more than 2 consecutive)
    let cleaned = markdown.replace(/\n{3,}/g, '\n\n');
    
    // Ensure document ends with a newline
    if (!cleaned.endsWith('\n')) {
      cleaned += '\n';
    }
    
    return cleaned;
  }

  /**
   * Create a Markdown heading
   * @param text - Heading text
   * @param level - Heading level (1-6)
   * @returns Markdown heading
   */
  protected createHeading(text: string, level: number = 1): string {
    if (!text) return '';
    
    level = Math.min(Math.max(level, 1), 6); // Ensure level is between 1-6
    
    if (this.options.headingStyle === 'setext' && level <= 2) {
      // Setext-style headers (level 1-2 only)
      const underline = level === 1 ? '='.repeat(text.length) : '-'.repeat(text.length);
      return `${text}\n${underline}\n\n`;
    } else {
      // ATX-style headers
      return `${'#'.repeat(level)} ${text}\n\n`;
    }
  }

  /**
   * Create a Markdown code block
   * @param code - Code content
   * @param language - Programming language for syntax highlighting
   * @returns Markdown code block
   */
  protected createCodeBlock(code: string, language: string = ''): string {
    if (this.options.codeBlockStyle === 'fenced') {
      return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    } else {
      // Indented style (4 spaces)
      return code.split('\n').map(line => `    ${line}`).join('\n') + '\n\n';
    }
  }

  /**
   * Create a Markdown blockquote
   * @param text - Text to quote
   * @returns Markdown blockquote
   */
  protected createBlockquote(text: string): string {
    if (!text) return '';
    return text.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
  }

  /**
   * Handle conversion errors
   * @param error - The error that occurred
   * @param source - Source that was being processed
   * @returns Markdown error message
   */
  protected handleError(error: Error, source: string): string {
    return `# Error Converting ${source}\n\n` +
           `There was an error converting the content to Markdown:\n\n` +
           this.createCodeBlock(error.message);
  }
}