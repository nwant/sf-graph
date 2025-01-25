/**
 * Unit tests for heuristic-tagger.ts
 * Tests heuristic rules for schema categorization.
 * 
 * Note: The implementation uses OBJECT_CATEGORY rules that rely on pre-classified
 * object.category from object-classifier.ts, not API name suffix patterns.
 */

import { describe, it, expect } from '@jest/globals';

// Import the DEFAULT_HEURISTIC_RULES from the built JS file
const { DEFAULT_HEURISTIC_RULES } = await import('../../../dist/services/categorization/heuristic-tagger.js');

describe('Heuristic Tagger', () => {
  describe('DEFAULT_HEURISTIC_RULES', () => {
    it('should have rules defined', () => {
      expect(DEFAULT_HEURISTIC_RULES).toBeDefined();
      expect(DEFAULT_HEURISTIC_RULES.length).toBeGreaterThan(0);
    });

    it('should have unique rule IDs', () => {
      const ids = DEFAULT_HEURISTIC_RULES.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('Core Business Object Detection', () => {
    it('should match Account as business_core', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'core_business_objects');
      expect(rule).toBeDefined();
      
      const regex = new RegExp(rule.target, 'i');
      
      expect(regex.test('Account')).toBe(true);
      expect(regex.test('Contact')).toBe(true);
      expect(regex.test('Lead')).toBe(true);
      expect(regex.test('Opportunity')).toBe(true);
      expect(regex.test('Case')).toBe(true);
    });

    it('should not match custom objects', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'core_business_objects');
      const regex = new RegExp(rule.target, 'i');
      
      expect(regex.test('Custom__c')).toBe(false);
      expect(regex.test('Invoice__c')).toBe(false);
    });
  });

  describe('Custom Metadata Type Detection', () => {
    it('should have custom_metadata_from_category rule', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'custom_metadata_from_category');
      expect(rule).toBeDefined();
      expect(rule.type).toBe('OBJECT_CATEGORY');
      expect(rule.target).toBe('metadata_type');
      expect(rule.assignCategory).toBe('custom_metadata');
    });
  });

  describe('Platform Event Detection', () => {
    it('should have platform_event_from_category rule', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'platform_event_from_category');
      expect(rule).toBeDefined();
      expect(rule.type).toBe('OBJECT_CATEGORY');
      expect(rule.target).toBe('platform_event');
      expect(rule.assignCategory).toBe('platform_event');
    });
  });

  describe('External Object Detection', () => {
    it('should have external_object_from_category rule', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'external_object_from_category');
      expect(rule).toBeDefined();
      expect(rule.type).toBe('OBJECT_CATEGORY');
      expect(rule.target).toBe('external');
      expect(rule.assignCategory).toBe('external_object');
    });
  });

  describe('System-Derived Object Detection', () => {
    it('should have system_derived_from_category rule for Feed/History/Share/ChangeEvent', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'system_derived_from_category');
      expect(rule).toBeDefined();
      expect(rule.type).toBe('OBJECT_CATEGORY');
      expect(rule.target).toBe('system');
      expect(rule.assignCategory).toBe('system_derived');
    });
  });

  describe('Setup/Admin Object Detection', () => {
    it('should have setup_admin_objects rule', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'setup_admin_objects');
      expect(rule).toBeDefined();
      expect(rule.type).toBe('APINAME_PATTERN');
      expect(rule.assignCategory).toBe('system');
      
      // Should match setup/admin objects
      const regex = new RegExp(rule.target, 'i');
      expect(regex.test('AuthProvider')).toBe(true);
      expect(regex.test('PermissionSet')).toBe(true);
      expect(regex.test('Profile')).toBe(true);
    });

    it('should not match business objects', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'setup_admin_objects');
      const regex = new RegExp(rule.target, 'i');
      
      expect(regex.test('Account')).toBe(false);
      expect(regex.test('Contact')).toBe(false);
      expect(regex.test('Custom__c')).toBe(false);
    });
  });

  describe('Field Rules', () => {
    it('should have lifecycle field patterns', () => {
      const statusRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'field_lifecycle_status');
      expect(statusRule).toBeDefined();
      expect(statusRule.appliesTo).toBe('field');
      
      const stageRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'field_lifecycle_stage');
      expect(stageRule).toBeDefined();
    });

    it('should have financial field patterns', () => {
      const amountRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'field_financial_amount');
      expect(amountRule).toBeDefined();
      expect(amountRule.assignCategory).toBe('financial');
      
      const revenueRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'field_financial_revenue');
      expect(revenueRule).toBeDefined();
    });

    it('should have temporal field types', () => {
      const dateRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'field_temporal_date');
      expect(dateRule).toBeDefined();
      expect(dateRule.type).toBe('FIELD_TYPE');
      expect(dateRule.target).toBe('date');
    });
  });

  describe('Namespace Rules', () => {
    it('should have system_namespace rule for Tooling/Metadata', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'system_namespace');
      expect(rule).toBeDefined();
      expect(rule.type).toBe('NAMESPACE');
      expect(rule.assignCategory).toBe('system');
    });

    it('should have managed_package rule', () => {
      const rule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'managed_package');
      expect(rule).toBeDefined();
      expect(rule.type).toBe('NAMESPACE');
      expect(rule.assignCategory).toBe('managed_package');
    });
  });

  describe('Business Extended Rules', () => {
    it('should have lookup-based rules for extending business objects', () => {
      const accountRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'business_extended_account');
      expect(accountRule).toBeDefined();
      expect(accountRule.type).toBe('HAS_LOOKUP_TO');
      expect(accountRule.target).toBe('Account');
      expect(accountRule.assignCategory).toBe('business_extended');

      const contactRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'business_extended_contact');
      expect(contactRule).toBeDefined();

      const opportunityRule = DEFAULT_HEURISTIC_RULES.find((r) => r.id === 'business_extended_opportunity');
      expect(opportunityRule).toBeDefined();
    });
  });
});
