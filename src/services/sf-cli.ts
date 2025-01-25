/**
 * Salesforce CLI Integration Service
 *
 * Wraps @salesforce/core for secure org authentication and connection management.
 */
import { AuthInfo, Connection, OrgAuthorization } from '@salesforce/core';
import { createLogger } from '../core/index.js';
import { loadConfig } from '../agent/config.js';

const log = createLogger('sf-cli');

export interface OrgConnection {
  accessToken: string;
  instanceUrl: string;
  username: string;
  alias: string;
  orgId: string;
}

export interface AuthenticatedOrg {
  alias: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  isScratchOrg: boolean;
  isDefault: boolean;
  connectedStatus?: string;
  expirationDate?: string;
}

export interface SoqlResult<T = unknown> {
  totalSize: number;
  done: boolean;
  records: T[];
}

/**
 * Check if Salesforce CLI is installed and accessible
 * @returns {Promise<boolean>}
 */
export async function isSfCliInstalled(): Promise<boolean> {
  // Since we are using @salesforce/core, we are effectively part of the CLI ecosystem.
  // If this code is running, the necessary libraries are present.
  // For backward compatibility/verification, we can just return true or check a basic auth.
  return true;
}

/**
 * List all authenticated Salesforce orgs
 * @returns {Promise<Array<AuthenticatedOrg>>}
 */
export async function listAuthenticatedOrgs(): Promise<AuthenticatedOrg[]> {
  try {
    const auths: OrgAuthorization[] = await AuthInfo.listAllAuthorizations();
    const defaults = await filterDefaults();
    
    // DEBUG: Log aliases for debug purposes
    // console.log('DEBUG: Auths found:', JSON.stringify(auths.map(a => ({ u: a.username, aliases: a.aliases })), null, 2));

    return auths.map((auth) => {
        // ...
        const isDefault = defaults.username === auth.username || 
                          (auth.aliases && defaults.alias && auth.aliases.includes(defaults.alias));
        
        return {
            alias: auth.aliases ? auth.aliases[0] : auth.username,
            username: auth.username,
            orgId: auth.orgId || '',
            instanceUrl: auth.instanceUrl || '',
            isScratchOrg: (auth as unknown as { isScratchOrg: boolean; isScratch: boolean }).isScratchOrg || 
                         (auth as unknown as { isScratchOrg: boolean; isScratch: boolean }).isScratch || false,
            isDefault: isDefault || false,
            connectedStatus: auth.error ? 'Not Connected' : 'Connected',
        };
    });
  } catch (error) {
    throw new Error(`Failed to list orgs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function filterDefaults(): Promise<{ username?: string; alias?: string }> {
  try {
    const { ConfigAggregator } = await import('@salesforce/core');
    const aggregator = await ConfigAggregator.create();
    const targetOrg = aggregator.getPropertyValue('target-org') as string | undefined;
    
    if (!targetOrg) return {};

    // target-org can be an alias or a username
    return { alias: targetOrg, username: targetOrg };
  } catch (error) {
    // If config fails, just return empty defaults
    return {};
  }
}

/**
 * Get connection details for a specific org
 * @param {string} orgAliasOrUsername - Org alias or username
 * @returns {Promise<OrgConnection>}
 */
export async function getOrgConnection(orgAliasOrUsername: string): Promise<OrgConnection> {
  const username = await resolveUsername(orgAliasOrUsername);

  try {
    const authInfo = await AuthInfo.create({ username });
    const connection = await Connection.create({ authInfo });
    const orgId = connection.getAuthInfo().getFields().orgId as string;

    return {
      accessToken: connection.accessToken as string,
      instanceUrl: connection.instanceUrl,
      username: connection.getUsername() as string,
      alias: orgAliasOrUsername,
      orgId: orgId,
    };
  } catch (error) {
     throw new Error(
      `Failed to create connection for "${orgAliasOrUsername}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Resolves an alias or username to a valid username using AuthInfo.
 * Retries with full list lookup if direct resolution fails.
 */
async function resolveUsername(aliasOrUsername: string): Promise<string> {
  try {
    // Try direct resolution first (cheap)
    const authInfo = await AuthInfo.create({ username: aliasOrUsername });
    return authInfo.getUsername();
  } catch (initialError) {
    try {
      // Fallback: search all authorizations
      const auths = await AuthInfo.listAllAuthorizations();
      const match = auths.find(a => a.aliases && a.aliases.includes(aliasOrUsername));
      
      if (match && match.username) {
        console.log(`Resolved alias "${aliasOrUsername}" to username "${match.username}"`);
        return match.username;
      }
      throw initialError;
    } catch (fallbackError) {
       throw new Error(
        `Failed to resolve org "${aliasOrUsername}": ${initialError instanceof Error ? initialError.message : String(initialError)}`
      );
    }
  }
}

/**
 * Get the default org alias from environment or configuration
 * @returns {Promise<string|null>}
 */
export async function getDefaultOrgAlias(): Promise<string | null> {
  // Check agent config first
  const config = loadConfig();
  if (config.defaultOrg) {
    return config.defaultOrg;
  }
  
  // Use ConfigAggregator to find target-org
  try {
      // Dynamic import to avoid top-level await issues if any, or just standard import
      const { ConfigAggregator } = await import('@salesforce/core');
      const aggregator = await ConfigAggregator.create();
      const targetOrg = aggregator.getPropertyValue('target-org');
      return targetOrg as string | null;
  } catch (err) {
      log.debug({ err }, 'Could not get default org alias from config');
      return null;
  }
}

/**
 * Execute a SOQL query against a specific org
 * @param {string} query - SOQL query to execute
 * @param {string} orgAliasOrUsername - Org alias or username
 * @returns {Promise<SoqlResult>}
 */
export async function executeSoqlViaCli<T extends Record<string, unknown> = Record<string, unknown>>(
  query: string,
  orgAliasOrUsername: string
): Promise<SoqlResult<T>> {
  try {
    const authInfo = await AuthInfo.create({ username: orgAliasOrUsername });
    const connection = await Connection.create({ authInfo });
    
    const result = await connection.query<T>(query);
    
    return {
      totalSize: result.totalSize,
      done: result.done,
      records: result.records,
    };
  } catch (error) {
    throw new Error(`SOQL query failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
