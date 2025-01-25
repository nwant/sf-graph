/**
 * Configuration for well-known polymorphic fields in Salesforce.
 * Used to provide specific guidance to the LLM for handling these complex relationships.
 */
export const KNOWN_POLYMORPHIC_FIELDS: Record<string, {
  relationshipName: string; // CRITICAL: Used in TYPEOF clause (e.g., 'Who', 'What')
  description: string;
  commonTargets: string[];
}> = {
  'WhoId': {
    relationshipName: 'Who',
    description: 'References a person (Contact or Lead)',
    commonTargets: ['Contact', 'Lead']
  },
  'WhatId': {
    relationshipName: 'What',
    description: 'References a business object (Account, Opportunity, Case, etc.)',
    commonTargets: ['Account', 'Opportunity', 'Case', 'Campaign', 'Contract']
  },
  'OwnerId': {
    relationshipName: 'Owner',
    description: 'References User or Queue',
    commonTargets: ['User', 'Group']
  }
};
