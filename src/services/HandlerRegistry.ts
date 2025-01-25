import fs from 'fs';
import path from 'path';
import { BaseHandler } from './handlers/BaseHandler.js';
import { CustomObjectHandler } from './handlers/CustomObjectHandler.js';
import { CustomFieldHandler } from './handlers/CustomFieldHandler.js';
import { ValidationRuleHandler } from './handlers/ValidationRuleHandler.js';

// Map of handler names to classes
const HANDLER_CLASSES: Record<string, new () => BaseHandler> = {
  CustomObjectHandler: CustomObjectHandler,
  CustomFieldHandler: CustomFieldHandler,
  ValidationRuleHandler: ValidationRuleHandler,
};

export class HandlerRegistry {
  private handlers: Map<string, BaseHandler>;

  constructor() {
    this.handlers = new Map();
    this.loadConfig();
  }

  loadConfig(): void {
    try {
      const configPath = path.resolve(process.cwd(), 'sf-graph.config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        for (const typeConfig of config.metadataTypes) {
          const HandlerClass = HANDLER_CLASSES[typeConfig.handler];
          if (HandlerClass) {
            this.handlers.set(typeConfig.name, new HandlerClass());
          } else {
            console.warn(
              `Handler class '${typeConfig.handler}' not found for type '${typeConfig.name}'. usage will be skipped.`
            );
          }
        }
      } else {
        console.warn('Configuration file sf-graph.config.json not found.');
      }
    } catch (error) {
      console.error('Error loading handler configuration:', error);
    }
  }

  getHandler(metadataType: string): BaseHandler | undefined {
    return this.handlers.get(metadataType);
  }
}

// Export a singleton instance
export const handlerRegistry = new HandlerRegistry();
