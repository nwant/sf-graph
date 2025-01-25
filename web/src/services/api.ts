/**
 * API Service for graph visualization endpoints
 */

import type { NeighborhoodResponse, ObjectsResponse } from '../types/graph';

const API_BASE = '';

export async function fetchNeighborhood(
  objectApiName: string,
  depth = 2
): Promise<NeighborhoodResponse> {
  const response = await fetch(
    `${API_BASE}/objects/${objectApiName}/neighborhood?depth=${depth}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch neighborhood: ${response.statusText}`);
  }
  return response.json();
}

export async function searchObjects(
  query: string,
  limit = 10
): Promise<ObjectsResponse> {
  const response = await fetch(
    `${API_BASE}/objects?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  if (!response.ok) {
    throw new Error(`Failed to search objects: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchAllObjects(): Promise<ObjectsResponse> {
  const response = await fetch(`${API_BASE}/objects`);
  if (!response.ok) {
    throw new Error(`Failed to fetch objects: ${response.statusText}`);
  }
  return response.json();
}
