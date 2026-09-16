import type { AtlasEntryPresentation } from '@/app/lib/atlas/definitions';

export type RediscoveredMemory = {
  entry: AtlasEntryPresentation;
  journey: { id: string; title: string } | null;
};

export type RediscoveryData = {
  date: string;
  mode: 'anniversary' | 'recent';
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  memories: RediscoveredMemory[];
};
