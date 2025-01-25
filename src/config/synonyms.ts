/**
 * Configuration for Semantic Search Synonyms
 *
 * This map provides static synonyms and abbreviations for standard Salesforce objects.
 * It serves as the first layer of resolution (Short Circuit) before fuzzy or vector search.
 *
 * Scope: Includes technical abbreviations AND business domain language.
 */
export const STANDARD_OBJECT_SYNONYMS: Record<string, string[]> = {
  // === Core CRM ===
  'Account': ['acct', 'acc', 'company', 'organization', 'org', 'client', 'customer', 'business', 'vendor', 'partner'],
  'Contact': ['con', 'person', 'people', 'individual'],
  'Opportunity': ['opp', 'oppty', 'deal', 'deals', 'potential sale', 'revenue', 'negotiation', 'pipeline'],
  'Lead': ['ld', 'prospect', 'potential customer', 'suspect', 'inquiry'],
  'Case': ['cs', 'ticket', 'issue', 'problem', 'request', 'incident', 'support request', 'complaint'],
  'Task': ['todo', 'action item', 'activity', 'reminder'],
  'Event': ['meeting', 'appointment', 'calendar entry', 'scheduled item'],
  'User': ['agent', 'rep', 'employee', 'owner', 'staff_member'],

  // === Sales & Marketing ===
  'Campaign': ['camp', 'cmpgn', 'promo', 'marketing initiative', 'promotion'],
  'Product2': ['product', 'item', 'merchandise', 'sku', 'good'],
  'Pricebook2': ['pricebook', 'catalog', 'pricing', 'price list'],
  'Contract': ['agreement', 'legal binding', 'covenant'],
  'Order': ['purchase', 'purchase order', 'po', 'requisition'],
  'Asset': ['purchased item', 'equipment', 'possession', 'holding'],
  'Quote': ['proposal', 'estimate', 'bid'],
  'OpportunityLineItem': ['opportunity product', 'line item', 'deal product'],
  'OrderItem': ['order product', 'line item'],

  // === Service ===
  'Solution': ['answer', 'knowledge', 'kb', 'resolution'],
  'KnowledgeArticle': ['article', 'guide', 'help doc', 'faq'],
  'Entitlement': ['sla', 'support level', 'right'],
  'ServiceContract': ['support agreement', 'maintenance contract'],

  // === System/Platform ===
  'ContentVersion': ['file', 'document', 'attachment', 'upload'],
  'ContentDocument': ['file', 'document', 'doc'],
  'Note': ['memo', 'comment', 'annotation'],
  'Attachment': ['file', 'upload'],
  'UserRole': ['role', 'job function', 'title'],
  'Profile': ['permission set', 'security profile', 'access level'],
  'Group': ['queue', 'public group', 'team'],
  'RecordType': ['record type', 'layout type'],
  'Organization': ['company settings', 'org settings'],
  'Partner': ['partnership', 'ally'],
};
