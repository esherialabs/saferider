import { describe, expect, it } from 'vitest';

import type { DraftData } from '../draftStorage';
import {
  buildEscalationEvidenceUploadDescriptor,
  buildEscalationHandoffStatus,
  buildEscalationPacket,
} from '../escalationPacket';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-escalation-1',
    createdAt: new Date('2026-06-05T09:00:00.000Z'),
    updatedAt: new Date('2026-06-05T09:15:00.000Z'),
    incidentDescription: 'Mary Jones blocked the aisle and called +254712345678 from vehicle KDD 123A.',
    textEvidence: 'Mary Jones said she would wait near River Road and called +254712345678.',
    impactSummary: 'I was scared to leave the bus.',
    witnesses: true,
    witnessDetails: 'Peter Smith saw the driver at the stage.',
    selectedTags: ['physical_threat'],
    acceptedSuggestions: ['public_transport'],
    customTags: ['driver_followed_me'],
    patterns: ['stalking'],
    location: {
      description: 'CBD Bus Station',
      address: 'River Road',
      type: 'public_transport',
      coordinates: {
        latitude: -1.283,
        longitude: 36.817,
      },
    },
    datetime: {
      date: '2026-06-05',
      time: '09:00',
      accuracy: 'approximate',
    },
    mediaFiles: [
      {
        id: 'media-1',
        type: 'photo',
        uri: 'file:///evidence/Mary-Jones-KDD-123A.jpg',
        fileName: 'Mary Jones KDD 123A.jpg',
        size: 2048,
        timestamp: new Date('2026-06-05T09:05:00.000Z'),
        checksum: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
        description: 'Mary Jones standing near KDD 123A.',
        transcript: 'Call me on +254712345678.',
      },
    ],
    privacySettings: {
      blurFaces: true,
      removeMetadata: true,
      encryptFiles: true,
    },
    escalationData: {
      redactionLevel: 'heavy',
      vehiclePlate: 'KDD 123A',
      saccoOperator: 'Super Metro',
      contactPreference: 'alias',
      alias: 'RiverWitness',
    },
    ...overrides,
  };
}

describe('escalation packet generation', () => {
  it('derives missing-data previews from the saved draft without static demo details', () => {
    const packet = buildEscalationPacket(
      buildDraft({
        incidentDescription: undefined,
        textEvidence: undefined,
        location: undefined,
        datetime: undefined,
        mediaFiles: [],
        selectedTags: [],
        acceptedSuggestions: [],
        customTags: [],
        escalationData: {
          redactionLevel: 'light',
          contactPreference: 'none',
        },
      }),
      { generatedAt: '2026-06-05T10:00:00.000Z' },
    );

    const serialized = JSON.stringify(packet);

    expect(packet.content.statement).toBe('No statement text recorded in this draft.');
    expect(packet.content.location).toBe('Not provided');
    expect(packet.evidenceManifest).toEqual([]);
    expect(serialized).not.toContain('Alex_K');
    expect(serialized).not.toContain('Yesterday 14:30');
    expect(serialized).not.toContain('CBD Bus Station');
    expect(serialized).not.toContain('Witness A');
    expect(serialized).not.toContain('a1b2c3d4');
  });

  it('applies redaction choices to packet text and evidence metadata', () => {
    const nonePacket = buildEscalationPacket(
      buildDraft({
        escalationData: {
          redactionLevel: 'none',
          vehiclePlate: 'KDD 123A',
          saccoOperator: 'Super Metro',
          contactPreference: 'none',
        },
      }),
    );
    const heavyPacket = buildEscalationPacket(buildDraft());

    expect(nonePacket.content.statement).toContain('Mary Jones');
    expect(nonePacket.content.statement).toContain('+254712345678');
    expect(nonePacket.content.location).toContain('CBD Bus Station');
    expect(nonePacket.evidenceManifest[0].label).toContain('Mary Jones KDD 123A');
    expect(nonePacket.evidenceManifest[0].checksum).toBe('A1B2C3D4E5F60718293A4B5C6D7E8F90');

    const serializedHeavy = JSON.stringify(heavyPacket);
    expect(heavyPacket.content.statement).toContain('[redacted name]');
    expect(heavyPacket.content.statement).toContain('[redacted contact]');
    expect(heavyPacket.content.location).toBe('Public Transport location, exact details redacted');
    expect(heavyPacket.content.transportIdentifiers).toContain('Vehicle plate: [redacted vehicle plate]');
    expect(heavyPacket.evidenceManifest[0]).toMatchObject({
      label: 'Photo evidence 1',
      checksum: undefined,
      metadataStatus: 'File name and checksum withheld from packet metadata',
    });
    expect(serializedHeavy).not.toContain('Mary Jones');
    expect(serializedHeavy).not.toContain('+254712345678');
    expect(serializedHeavy).not.toContain('CBD Bus Station');
    expect(serializedHeavy).not.toContain('A1B2C3D4E5F60718293A4B5C6D7E8F90');
  });

  it('minimizes escalation upload metadata for packet submissions', () => {
    const draft = buildDraft();
    const descriptor = buildEscalationEvidenceUploadDescriptor({
      media: draft.mediaFiles![0],
      evidenceIndex: 0,
      redactionLevel: 'heavy',
      privacySettings: draft.privacySettings,
    });

    expect(descriptor.fileName).toBe('photo-1.jpg');
    expect(descriptor.metadata).toMatchObject({
      mediaType: 'photo',
      packetRedactionLevel: 'heavy',
      displayName: 'photo-1.jpg',
      packetMetadataStatus: 'File name and checksum withheld from packet metadata',
    });
    expect(descriptor.metadata).not.toHaveProperty('originalFileName');
    expect(descriptor.metadata).not.toHaveProperty('redactedFileName');

    const unredactedPacketDescriptor = buildEscalationEvidenceUploadDescriptor({
      media: draft.mediaFiles![0],
      evidenceIndex: 0,
      redactionLevel: 'none',
      privacySettings: draft.privacySettings,
    });
    const serializedUploadMetadata = JSON.stringify(unredactedPacketDescriptor);

    expect(unredactedPacketDescriptor.fileName).toBe('photo-1.jpg');
    expect(unredactedPacketDescriptor.metadata).not.toHaveProperty('originalFileName');
    expect(serializedUploadMetadata).not.toContain('Mary Jones');
    expect(serializedUploadMetadata).not.toContain('KDD 123A');
    expect(serializedUploadMetadata).not.toContain('+254712345678');
  });

  it('does not carry hostile original filename extensions into upload names', () => {
    const baseMedia = buildDraft().mediaFiles![0];
    const mimeTypedDescriptor = buildEscalationEvidenceUploadDescriptor({
      media: {
        ...baseMedia,
        fileName: 'clip.MaryJones',
        mimeType: 'image/jpeg',
      },
      evidenceIndex: 0,
      redactionLevel: 'heavy',
      privacySettings: buildDraft().privacySettings,
    });
    const unknownMimeDescriptor = buildEscalationEvidenceUploadDescriptor({
      media: {
        ...baseMedia,
        fileName: 'photo.RiverRoad',
        mimeType: undefined,
      },
      evidenceIndex: 0,
      redactionLevel: 'heavy',
      privacySettings: buildDraft().privacySettings,
    });

    expect(mimeTypedDescriptor.fileName).toBe('photo-1.jpg');
    expect(mimeTypedDescriptor.metadata.displayName).toBe('photo-1.jpg');
    expect(unknownMimeDescriptor.fileName).toBe('photo-1');
    expect(unknownMimeDescriptor.metadata.displayName).toBe('photo-1');
    expect(JSON.stringify([mimeTypedDescriptor, unknownMimeDescriptor])).not.toContain('MaryJones');
    expect(JSON.stringify([mimeTypedDescriptor, unknownMimeDescriptor])).not.toContain('RiverRoad');
  });

  it('reports truthful handoff states for online, offline, and unavailable paths', () => {
    expect(buildEscalationHandoffStatus({ isOnline: true }).send).toMatchObject({
      state: 'available',
      label: 'Available after consent',
    });
    expect(buildEscalationHandoffStatus({ isOnline: false }).send).toMatchObject({
      state: 'queued',
      label: 'Queues after consent',
    });
    expect(buildEscalationHandoffStatus({ isOnline: true, hasCaseServiceEndpoint: false }).send).toMatchObject({
      state: 'unavailable',
      label: 'Sending unavailable',
    });
    expect(buildEscalationHandoffStatus({ isOnline: true }).share).toMatchObject({
      state: 'unavailable',
      label: 'Separate share unavailable',
    });
  });
});
