import { classifyObject, classifyField } from '../../../dist/core/object-classifier.js';
import { describe, test, expect } from '@jest/globals';

describe('Object Classifier', () => {
  describe('classifyObject', () => {
    test('should classify standard objects', () => {
      const result = classifyObject('Account');
      expect(result).toEqual({
        category: 'standard',
        subtype: null,
        namespace: undefined,
        parentObjectName: undefined,
      });
    });

    test('should classify custom objects', () => {
      const result = classifyObject('My_Object__c');
      expect(result).toEqual({
        category: 'custom',
        subtype: null,
        namespace: undefined,
        parentObjectName: undefined,
      });
    });

    test('should classify external objects', () => {
      const result = classifyObject('My_External__x');
      expect(result).toEqual({
        category: 'external',
        subtype: null,
        namespace: undefined,
        parentObjectName: undefined,
      });
    });

    test('should classify metadata types', () => {
      const result = classifyObject('My_Setting__mdt');
      expect(result).toEqual({
        category: 'metadata_type',
        subtype: null,
        namespace: undefined,
        parentObjectName: undefined,
      });
    });

    test('should classify platform events', () => {
      const result = classifyObject('My_Event__e');
      expect(result).toEqual({
        category: 'platform_event',
        subtype: null,
        namespace: undefined,
        parentObjectName: undefined,
      });
    });

    test('should classify change events (standard)', () => {
      const result = classifyObject('AccountChangeEvent');
      expect(result).toEqual({
        category: 'system',
        subtype: 'change_event',
        namespace: undefined,
        parentObjectName: 'Account',
      });
    });

    test('should classify change events (custom)', () => {
      const result = classifyObject('My_Object__ChangeEvent');
      expect(result).toEqual({
        category: 'system',
        subtype: 'change_event',
        namespace: undefined,
        parentObjectName: 'My_Object__c',
      });
    });

    test('should classify share objects (standard)', () => {
      const result = classifyObject('AccountShare');
      expect(result).toEqual({
        category: 'system',
        subtype: 'share',
        namespace: undefined,
        parentObjectName: 'Account',
      });
    });

    test('should classify share objects (custom)', () => {
      const result = classifyObject('My_Object__Share');
      expect(result).toEqual({
        category: 'system',
        subtype: 'share',
        namespace: undefined,
        parentObjectName: 'My_Object__c',
      });
    });

    test('should classify feed objects (standard)', () => {
      const result = classifyObject('AccountFeed');
      expect(result).toEqual({
        category: 'system',
        subtype: 'feed',
        namespace: undefined,
        parentObjectName: 'Account',
      });
    });

    test('should classify history objects (standard)', () => {
      const result = classifyObject('AccountHistory');
      expect(result).toEqual({
        category: 'system',
        subtype: 'history',
        namespace: undefined,
        parentObjectName: 'Account',
      });
    });

    test('should classify history objects (custom)', () => {
      const result = classifyObject('My_Object__History');
      expect(result).toEqual({
        category: 'system',
        subtype: 'history',
        namespace: undefined,
        parentObjectName: 'My_Object__c',
      });
    });

    test('should identify managed package custom objects', () => {
      const result = classifyObject('npsp__Trigger_Handler__c');
      expect(result).toEqual({
        category: 'custom',
        subtype: null,
        namespace: 'npsp',
        parentObjectName: undefined,
      });
    });

    test('should identify managed package platform events', () => {
      const result = classifyObject('npsp__Log__e');
      expect(result).toEqual({
        category: 'platform_event',
        subtype: null,
        namespace: 'npsp',
        parentObjectName: undefined,
      });
    });

    test('should handle system derived objects from managed packages', () => {
      const result = classifyObject('npsp__Trigger_Handler__Share');
      expect(result).toEqual({
        category: 'system',
        subtype: 'share',
        namespace: 'npsp',
        parentObjectName: 'npsp__Trigger_Handler__c',
      });
    });
  });

  describe('classifyField', () => {
    test('should classify standard fields', () => {
      const result = classifyField('Name');
      expect(result).toEqual({
        category: 'standard',
        namespace: undefined,
      });
    });

    test('should classify custom fields', () => {
      const result = classifyField('My_Field__c');
      expect(result).toEqual({
        category: 'custom',
        namespace: undefined,
      });
    });

    test('should classify managed package fields', () => {
      const result = classifyField('npsp__Amount__c');
      expect(result).toEqual({
        category: 'custom',
        namespace: 'npsp',
      });
    });
  });
});
