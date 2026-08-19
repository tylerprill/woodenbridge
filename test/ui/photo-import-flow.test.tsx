/**
 * @jest-environment jsdom
 */

import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { PhotoImportChooseStep } from '@/components/atlas/photo-import-choose-step';
import {
  getImportStatusCopy,
  needsFileDateConfirmation,
  sortImportItems,
} from '@/components/atlas/photo-import-helpers';
import type { ImportItem } from '@/components/atlas/photo-import-types';
import { ImportProgress } from '@/components/atlas/photo-import-ui';

function importItem(
  id: string,
  overrides: Partial<ImportItem> = {},
): ImportItem {
  return {
    clientItemId: id,
    file: new File(['photo'], `${id}.jpg`, { type: 'image/jpeg' }),
    previewUrl: '',
    fileName: `${id}.jpg`,
    analysis: null,
    prepared: null,
    width: null,
    height: null,
    contentHash: id,
    latitude: null,
    longitude: null,
    place: null,
    placeLabel: '',
    placeLabelEdited: false,
    visitedOn: '',
    capturedAt: null,
    locationSource: 'missing',
    captureDateSource: 'missing',
    fileDateConfirmed: false,
    title: '',
    description: '',
    state: 'needs-place',
    error: '',
    uploadState: 'waiting',
    ...overrides,
  };
}

describe('photo journey import UI', () => {
  it('discloses source limits, place lookup, and private defaults before selection', () => {
    render(
      <PhotoImportChooseStep
        items={[]}
        activeCount={0}
        totalSize="0 KB"
        busy={false}
        selectionLocked={false}
        inputRef={createRef<HTMLInputElement>()}
        rejections={[]}
        onChoose={jest.fn()}
        onRemove={jest.fn()}
        onContinue={jest.fn()}
      />,
    );

    expect(screen.getByText(/Up to 25 MB each/i)).toBeInTheDocument();
    expect(screen.getByText(/configured geocoder/i)).toBeInTheDocument();
    expect(screen.getByText(/Photos stay on this device/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Find the journey/i }),
    ).toBeDisabled();
  });

  it('passes all selected photographs to the progressive analyzer', () => {
    const onChoose = jest.fn();
    render(
      <PhotoImportChooseStep
        items={[]}
        activeCount={0}
        totalSize="0 KB"
        busy={false}
        selectionLocked={false}
        inputRef={createRef<HTMLInputElement>()}
        rejections={[]}
        onChoose={onChoose}
        onRemove={jest.fn()}
        onContinue={jest.fn()}
      />,
    );

    const files = [
      new File(['one'], 'one.heic', { type: 'image/heic' }),
      new File(['two'], 'two.jpg', { type: 'image/jpeg' }),
    ];
    fireEvent.change(screen.getByLabelText(/Choose photos/i), {
      target: { files },
    });
    expect(onChoose).toHaveBeenCalledWith(files);
  });

  it('uses three progress steps when a single photo skips chapter creation', () => {
    render(<ImportProgress step="stories" includeChapter={false} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText('Shape chapter')).not.toBeInTheDocument();
    expect(screen.getByText('Tell the stories').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('sorts undated photographs last and avoids overstating GPS precision', () => {
    const dated = importItem('dated', { visitedOn: '2024-06-18' });
    const missing = importItem('missing');
    expect([missing, dated].sort(sortImportItems)).toEqual([dated, missing]);

    const mediumGps = importItem('gps', {
      latitude: 39.1,
      longitude: -106.4,
      locationSource: 'photo_gps',
      analysis: {
        file: new File(['gps'], 'gps.jpg', { type: 'image/jpeg' }),
        name: 'gps.jpg',
        byteSize: 3,
        sourceHash: 'gps',
        declaredMimeType: 'image/jpeg',
        format: 'jpeg',
        isHeic: false,
        canPrepare: true,
        orientation: 1,
        location: {
          latitude: 39.1,
          longitude: -106.4,
          accuracyMeters: 120,
          altitudeMeters: null,
          source: 'exif-gps',
          confidence: 'medium',
        },
        capture: null,
        issues: [],
      },
    });
    expect(getImportStatusCopy(mediumGps)).toBe(
      'Photo GPS · medium confidence',
    );
  });

  it('requires confirmation only for an accepted filesystem fallback date', () => {
    const fileDate = importItem('file-date', {
      visitedOn: '2024-06-18',
      captureDateSource: 'file_date',
      fileDateConfirmed: false,
    });
    expect(needsFileDateConfirmation(fileDate)).toBe(true);
    expect(
      needsFileDateConfirmation({ ...fileDate, fileDateConfirmed: true }),
    ).toBe(false);

    for (const captureDateSource of [
      'photo_metadata',
      'manual',
      'missing',
    ] as const) {
      expect(
        needsFileDateConfirmation({ ...fileDate, captureDateSource }),
      ).toBe(false);
    }
  });
});
