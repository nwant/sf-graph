/**
 * sf graph docs extract
 *
 * Extract standard object documentation from Salesforce Docs.
 * Scrapes the official Object Reference to build a local documentation cache.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, Global } from '@salesforce/core';
import confirm from '@inquirer/confirm';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'cheerio';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.docs.extract');

// === Configuration ===
const BASE_URL = 'https://developer.salesforce.com/docs/get_document_content';
const LANGUAGE = 'en-us';
// User-extracted docs go to SF CLI's data directory (persists across plugin updates)
// Uses @salesforce/core Global.SF_DIR for platform-appropriate paths
const USER_DOCUMENTATION_DIR = path.join(Global.SF_DIR, 'sf-graph', 'documentation');

// === Defaults ===
const DEFAULTS = {
  batchSize: 1,
  delayMin: 1000,
  delayMax: 3000,
  saveInterval: 10,
  retries: 3,
};

// === Types ===
interface ExtractResult {
  success: boolean;
  objectCount: number;
  outputPath: string;
  message: string;
}

interface ObjectDescription {
  description: string;
  usage?: string;
  accessRules?: string;
  supportedCalls?: string;
  fields: Record<string, { description: string; properties: string[] }>;
}

interface OutputJson {
  apiVersion: string;
  lastUpdated: string;
  source: string;
  objects: Record<string, ObjectDescription>;
}

// === Helpers ===
function getVersionCode(apiVersion: string): string {
  const num = parseFloat(apiVersion);
  if (isNaN(num)) {
    throw new Error(`Invalid API version: ${apiVersion}`);
  }
  return `${(num * 2) + 128}.0`;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function formatEta(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '~';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `~${hours}h${mins}m`;
}

async function fetchJson(url: string, retries = DEFAULTS.retries): Promise<any> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm',
      },
    });

    if (response.status === 403 || response.status === 429) {
      if (retries > 0) {
        const delay = (4 - retries) * 5000 + (Math.random() * 2000);
        await new Promise(r => setTimeout(r, delay));
        return fetchJson(url, retries - 1);
      }
      throw new Error(`Rate limited (${response.status}) after multiple retries.`);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (err: unknown) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return fetchJson(url, retries - 1);
    }
    throw err;
  }
}

async function fetchObjectDetails(
  slug: string,
  versionCode: string
): Promise<{
  apiName: string;
  description: string;
  usage?: string;
  accessRules?: string;
  supportedCalls?: string;
  fields: Record<string, { description: string; properties: string[] }>;
} | null> {
  const url = `${BASE_URL}/object_reference/${slug}.htm/${LANGUAGE}/${versionCode}`;

  try {
    const data = await fetchJson(url);
    const $ = load(data.content);

    // Extract API name from h1 title (most reliable) - e.g., "Account" from "Account Object"
    const h1Text = $('h1.helpHead1').first().text().trim();
    let apiName = h1Text.replace(/\s+Object$/i, '').trim();
    
    // Fallback: extract from slug if h1 doesn't give us a clean name
    if (!apiName || apiName.toLowerCase().includes('sforce')) {
      // Convert slug like "sforce_api_objects_account" to "Account"
      const slugPart = slug.replace(/^sforce_api_objects_/, '');
      apiName = slugPart
        .split('_')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
        .join('');
    }

    // Extract object description
    const description = $('div.shortdesc').text().trim() || $('h1.helpHead1').next('p').text().trim();

    // Extract sections
    const getSectionContent = (headerText: string): string | null => {
      let content = '';
      const header = $(`h2:contains("${headerText}")`).first();
      if (header.length) {
        let next = header.next();
        while (next.length && !next.is('h1, h2, h3')) {
          content += ' ' + next.text();
          next = next.next();
        }
      }
      return content.trim() || null;
    };

    const usage = getSectionContent('Usage');
    const accessRules = getSectionContent('Access Rules') || getSectionContent('Special Access Rules');
    const supportedCalls = getSectionContent('Supported Calls');

    // Extract fields
    const fields: Record<string, { description: string; properties: string[] }> = {};
    $('table.featureTable tbody tr').each((_, row) => {
      const fieldName = $(row).find('td:first-child .keyword.parmname').first().text().trim();
      if (fieldName) {
        const detailsCell = $(row).find('td:nth-child(2)');
        const rawDesc = detailsCell.find('dt:contains("Description")').next('dd').text().trim();
        const propsText = detailsCell.find('dt:contains("Properties")').next('dd').text().trim();

        // Clean description
        const cleanDesc = rawDesc
          .replace(/^Type\s+\w+\s+Properties\s+[^D]+Description\s*/i, '')
          .replace(/\s+/g, ' ')
          .trim();

        // Extract properties
        const properties = propsText
          .split(/,\s*/)
          .map(p => p.trim())
          .filter(p => ['Create', 'Filter', 'Group', 'Sort', 'Update', 'Nillable'].includes(p));

        if (cleanDesc || properties.length > 0) {
          fields[fieldName] = { description: cleanDesc, properties };
        }
      }
    });

    return { apiName, description: cleanText(description), usage: usage ? cleanText(usage) : undefined, accessRules: accessRules ? cleanText(accessRules) : undefined, supportedCalls: supportedCalls ? cleanText(supportedCalls) : undefined, fields };
  } catch {
    return null;
  }
}

// === Command ===
export default class Extract extends SfCommand<ExtractResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = true;

  public static readonly args = {
    apiVersion: Args.string({
      description: messages.getMessage('args.apiVersion.description'),
      required: true,
    }),
  };

  public static readonly flags = {
    force: Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.force.summary'),
      default: false,
    }),
    'batch-size': Flags.integer({
      char: 'b',
      summary: messages.getMessage('flags.batch-size.summary'),
      default: DEFAULTS.batchSize,
      min: 1,
      max: 20,
    }),
    'delay-min': Flags.integer({
      char: 'd',
      summary: messages.getMessage('flags.delay-min.summary'),
      default: DEFAULTS.delayMin,
      min: 0,
      max: 10000,
    }),
    'delay-max': Flags.integer({
      char: 'D',
      summary: messages.getMessage('flags.delay-max.summary'),
      default: DEFAULTS.delayMax,
      min: 100,
      max: 30000,
    }),
    'save-interval': Flags.integer({
      char: 's',
      summary: messages.getMessage('flags.save-interval.summary'),
      default: DEFAULTS.saveInterval,
      min: 1,
      max: 100,
    }),
  };

  public async run(): Promise<ExtractResult> {
    const { args, flags } = await this.parse(Extract);
    let apiVersion = args.apiVersion;
    const { batchSize, delayMin, delayMax, saveInterval } = {
      batchSize: flags['batch-size'],
      delayMin: flags['delay-min'],
      delayMax: flags['delay-max'],
      saveInterval: flags['save-interval'],
    };

    // Validate and normalize version format (accept "63" or "63.0")
    if (/^\d+$/.test(apiVersion)) {
      apiVersion = `${apiVersion}.0`;  // Normalize: "63" -> "63.0"
    } else if (!/^\d+\\.0$/.test(apiVersion)) {
      this.error(messages.getMessage('errors.invalidVersion'));
    }

    const versionCode = getVersionCode(apiVersion);
    const outputPath = path.join(USER_DOCUMENTATION_DIR, `standard-documentation-v${apiVersion}.json`);

    // Ensure output directory exists
    if (!fs.existsSync(USER_DOCUMENTATION_DIR)) {
      fs.mkdirSync(USER_DOCUMENTATION_DIR, { recursive: true });
    }

    // Check for existing file
    let result: OutputJson = {
      apiVersion,
      lastUpdated: new Date().toISOString(),
      source: 'https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm',
      objects: {},
    };

    if (fs.existsSync(outputPath)) {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as OutputJson;

      if (!flags.force) {
        const confirmed = await confirm({
          message: messages.getMessage('confirm.overwrite', [apiVersion, Object.keys(existing.objects).length]),
        });
        if (!confirmed) {
          this.log(messages.getMessage('info.cancelled'));
          return { success: false, objectCount: 0, outputPath, message: 'Cancelled by user' };
        }
      }

      // Preserve existing data for resume capability
      result = existing;
    }

    this.log(messages.getMessage('info.starting', [apiVersion]));
    this.log(messages.getMessage('info.settings', [batchSize, delayMin, delayMax, saveInterval]));
    this.log(messages.getMessage('info.outputPath', [outputPath]));

    // Fetch object list
    this.spinner.start(messages.getMessage('info.fetchingIndex'));
    const objectListUrl = `${BASE_URL}/object_reference/sforce_api_objects_list.htm/${LANGUAGE}/${versionCode}`;
    const objectListData = await fetchJson(objectListUrl);
    const $ = load(objectListData.content);

    const allObjects: { label: string; slug: string }[] = [];
    $('a[href*="sforce_api_objects_"]').each((_, element) => {
      const href = $(element).attr('href');
      const label = $(element).text().trim();
      if (href && label) {
        const match = href.match(/(sforce_api_objects_[^.]+)/);
        if (match) {
          allObjects.push({ label, slug: match[1] });
        }
      }
    });

    this.spinner.stop();
    this.log(messages.getMessage('info.foundObjects', [allObjects.length]));

    // Determine objects to process
    const getApiNameFromList = (label: string): string => label.replace(/\s+/g, '');
    const objectsToProcess = allObjects.filter(obj => {
      const apiName = getApiNameFromList(obj.label);
      const existing = result.objects[apiName];
      return !existing || !existing.usage;
    });

    if (objectsToProcess.length === 0 && !flags.force) {
      this.log(messages.getMessage('info.alreadyComplete'));
      return { success: true, objectCount: Object.keys(result.objects).length, outputPath, message: 'Already complete' };
    }

    this.log(messages.getMessage('info.processing', [objectsToProcess.length]));

    // Process objects with spinner progress
    const startTime = Date.now();
    this.spinner.start(`Starting extraction...`);
    let processed = 0;
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < objectsToProcess.length; i += batchSize) {
      const batch = objectsToProcess.slice(i, i + batchSize);
      const details = await Promise.all(batch.map(obj => fetchObjectDetails(obj.slug, versionCode)));

      let lastObjectName = '';
      for (const detail of details) {
        if (detail?.apiName) {
          result.objects[detail.apiName] = {
            description: detail.description,
            usage: detail.usage,
            accessRules: detail.accessRules,
            supportedCalls: detail.supportedCalls,
            fields: detail.fields,
          };
          lastObjectName = detail.apiName;
          successCount++;
        } else {
          failCount++;
        }
      }

      processed += batch.length;
      
      // Calculate ETA
      const elapsedMs = Date.now() - startTime;
      const objPerMs = processed / elapsedMs;
      const remaining = objectsToProcess.length - processed;
      const etaMs = remaining / objPerMs;
      const etaStr = formatEta(etaMs);
      
      // Format: stats first (fixed-width), object name last (variable)
      const pct = Math.round((processed / objectsToProcess.length) * 100);
      const pctStr = pct.toString().padStart(3, ' ');  // Right-align percentage
      const objectDisplay = lastObjectName || batch[0]?.label || 'objects';
      this.spinner.status = `${pctStr}% (${processed}/${objectsToProcess.length}) ${etaStr} left • ${objectDisplay}`;

      // Incremental save
      if (processed % saveInterval === 0) {
        result.lastUpdated = new Date().toISOString();
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      }

      // Delay
      const delay = delayMin + Math.random() * (delayMax - delayMin);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Final save
    result.lastUpdated = new Date().toISOString();
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    this.spinner.stop();

    const finalCount = Object.keys(result.objects).length;
    this.log(messages.getMessage('info.complete', [finalCount]));

    return { success: true, objectCount: finalCount, outputPath, message: `Extracted ${finalCount} objects` };
  }
}
