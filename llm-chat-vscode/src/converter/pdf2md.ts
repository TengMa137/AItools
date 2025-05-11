/**
 * PDF to Markdown converter using lightweight pdf-parse
 * with optional pdfjs functionality for TOC extraction
 */
import { X2md } from './x2md';
import * as fs from 'fs';
import * as path from 'path';
import pdfParse from 'pdf-parse';

const PDF_REGEX = /(?:\/|\\|\.\/|\.\.\/|~\/|[A-Za-z]:\\)(?:[\w\s\.-]+\/)*[\w\s\.-]+\.pdf\b/gi;

export class Pdf2md extends X2md {
  private maxTextLength: number = 20000;
  
  constructor() {
    super();
  }
  
  canHandle(input: string): boolean {
    return PDF_REGEX.test(input) || input.trim().endsWith('.pdf');
  }
  
  async toMarkdown(pdfPath: string): Promise<string> {
    try {
      // Normalize path
      const normalizedPath = pdfPath.startsWith('~') 
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', pdfPath.slice(1))
        : path.resolve(pdfPath);
      
      // Read the PDF file
      const pdfBuffer = fs.readFileSync(normalizedPath);
      const filename = path.basename(normalizedPath);
      
      // Start with lightweight pdf-parse for basic content and metadata
      const data = await pdfParse(pdfBuffer);
      
      // Generate basic markdown content
      let markdown = this.createBasicMarkdown(data, filename);
      
      if (data.text.length > this.maxTextLength) {
        console.log("exceed max pdf length.")
        //call external tool to extract large pdf and indexing the file...
      }

      return markdown;
    } catch (error) {
      console.error(`Error processing PDF ${pdfPath}:`, error);
      return `# Error Processing PDF ${path.basename(pdfPath)}\n\n${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
  
  private createBasicMarkdown(data: any, filename: string): string {
    let markdown = '';
    
    // Use title from metadata or fallback to filename
    const title = data.info?.Title || filename;
    markdown = `# ${title}\n\n`;
    
    // Add author if available
    if (data.info?.Author) {
      markdown += `*Author: ${data.info.Author}*\n\n`;
    }
    
    // Add creation date if available
    if (data.info?.CreationDate) {
      try {
        const dateStr = data.info.CreationDate.replace(/^D:/,'').substring(0, 8);
        const formattedDate = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
        markdown += `*Date: ${formattedDate}*\n\n`;
      } catch (e) {
        markdown += `*Date: ${data.info.CreationDate}*\n\n`;
      }
    }
    
    // Add page count info
    markdown += `*Pages: ${data.numpages}*\n\n`;
    
    // Process the text content into more readable chunks
    if (data.text) {
      markdown += this.formatTextContent(data.text);
    }
    
    return markdown;
  }
  
  private formatTextContent(text: string): string {
    // Remove excessive whitespace
    let content = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
    
    // Try to detect paragraphs based on periods followed by double spaces or newlines
    content = content.replace(/\.\s{2,}/g, '.\n\n').replace(/\.\n/g, '.\n\n');
    
    // Break very long content into chunks to make it more readable
    const paragraphs = content.split('\n\n');
    return paragraphs
      .filter(p => p.trim().length > 0)
      .join('\n\n');
  }
}