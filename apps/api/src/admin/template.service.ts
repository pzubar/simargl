import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// Use require for handlebars to avoid type issues
const Handlebars = require('handlebars');

@Injectable()
export class TemplateService {
  private templatesCache: Map<string, any> = new Map();
  
  constructor() {
    // Configure Handlebars runtime options to allow prototype access
    Handlebars.logger.level = 0; // Disable warnings
    
    this.registerHelpers();
    this.registerPartials();
  }
  
  private registerHelpers() {
    // Helper for date formatting
    Handlebars.registerHelper('formatDate', (date: Date | string) => {
      if (!date) return '—';
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    });
    
    // Helper for number formatting
    Handlebars.registerHelper('formatNumber', (num: number) => {
      if (!num) return '—';
      return num.toLocaleString();
    });
    
    // Helper for equality check
    Handlebars.registerHelper('eq', (a: any, b: any) => {
      return a === b;
    });
    
    // Helper for conditional rendering
    Handlebars.registerHelper('unless', (conditional: any, options: any) => {
      if (!conditional) {
        return options.fn(this);
      }
      return options.inverse(this);
    });
    
    // Helper for greater than comparison
    Handlebars.registerHelper('gt', (a: any, b: any) => {
      return a > b;
    });
    
    // Helper for less than comparison
    Handlebars.registerHelper('lt', (a: any, b: any) => {
      return a < b;
    });
    
    // Helper for array slicing
    Handlebars.registerHelper('slice', (array: any[], start: number, end?: number) => {
      if (!Array.isArray(array)) return [];
      return array.slice(start, end);
    });
    
    // Helper for checking if value is in array
    Handlebars.registerHelper('includes', (array: any[], value: any) => {
      if (!Array.isArray(array)) return false;
      return array.includes(value);
    });
    
    // Helper for array length
    Handlebars.registerHelper('length', (array: any[]) => {
      if (!Array.isArray(array)) return 0;
      return array.length;
    });
  }
  
  private getTemplatePath(templateName: string): string {
    // In development/production, we need to go up from the compiled dist folder
    return path.join(__dirname, '..', '..', '..', 'apps', 'api', 'src', 'views', templateName);
  }
  
  private loadTemplate(templateName: string): any {
    const templatePath = this.getTemplatePath(templateName);
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }
    
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    return Handlebars.compile(templateSource, {
      allowProtoPropertiesByDefault: true,
      allowProtoMethodsByDefault: true
    });
  }
  
  private getTemplate(templateName: string): any {
    if (!this.templatesCache.has(templateName)) {
      const template = this.loadTemplate(templateName);
      this.templatesCache.set(templateName, template);
    }
    
    return this.templatesCache.get(templateName);
  }
  
  render(templateName: string, data: any = {}): string {
    const template = this.getTemplate(templateName);
    
    // Default data that's available to all templates
    const defaultData = {
      showNavigation: true,
      currentPage: data.currentPage || 'dashboard',
      contentCount: data.contentCount || 0,
      title: data.title || 'Admin Dashboard',
      description: data.description || 'Simargl Content Management System',
      ...data
    };
    
    return template(defaultData);
  }
  
  renderLayout(layoutName: string, templateName: string, data: any = {}): string {
    // First render the content template
    const contentHtml = this.render(templateName, data);
    
    // Then render the layout with the content
    const layoutTemplate = this.getTemplate(`layouts/${layoutName}.hbs`);
    
    const layoutData = {
      ...data,
      body: contentHtml,
    };
    
    return layoutTemplate(layoutData);
  }
  
  // Clear template cache (useful for development)
  clearCache(): void {
    this.templatesCache.clear();
  }

  private registerPartials() {
    const partialsDir = path.join(__dirname, '..', '..', '..', 'apps', 'api', 'src', 'views', 'partials');
    
    if (fs.existsSync(partialsDir)) {
      const partialFiles = fs.readdirSync(partialsDir).filter(file => file.endsWith('.hbs'));
      
      partialFiles.forEach(file => {
        const partialName = file.replace('.hbs', '');
        const partialPath = path.join(partialsDir, file);
        const partialSource = fs.readFileSync(partialPath, 'utf-8');
        
        Handlebars.registerPartial(partialName, partialSource);
        console.log(`✅ Registered partial: ${partialName}`);
      });
    }
  }
} 