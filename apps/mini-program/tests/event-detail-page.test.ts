import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { EventParticipant } from '../types/domain.ts';

const { api } = await import('../services/api.ts');
let definition: any;
(globalThis as any).Page = (value: any) => { definition = value; };
await import('../pages/event-detail/index.ts');

function createPage() {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>) { Object.assign(this.data, update); },
  };
}

test('a stale participant response cannot restore a rider after a newer refresh', async () => {
  const original = api.getEventParticipants;
  let resolveStale!: (items: EventParticipant[]) => void;
  const staleResponse = new Promise<EventParticipant[]>((resolve) => { resolveStale = resolve; });
  let requestCount = 0;
  api.getEventParticipants = async () => requestCount++ === 0 ? staleResponse : [];

  try {
    const page = createPage();
    page.data.id = '11111111-1111-4111-8111-111111111111';
    const staleLoad = page.loadParticipants();
    await page.loadParticipants();
    assert.deepEqual(page.data.participants, []);

    resolveStale([{ nickname: '已取消骑友', avatarUrl: 'https://example.com/stale.jpg', isOrganizer: false }]);
    await staleLoad;
    assert.deepEqual(page.data.participants, []);
  } finally {
    api.getEventParticipants = original;
  }
});

test('only the organizer can open a rider contact from the participant grid', async () => {
  const original = api.getEventParticipantContact;
  let requestedContact = '';
  let modalContent = '';
  api.getEventParticipantContact = async (_eventId, contactId) => {
    requestedContact = contactId;
    return { nickname: '骑行小明', avatarUrl: null, phone: '13800138000', emergencyContact: '林先生 13600001048', bikeType: '公路车' };
  };
  (globalThis as any).wx = {
    showModal: async (options: { content: string }) => { modalContent = options.content; return { confirm: true, cancel: false }; },
    showToast: () => undefined,
  };

  try {
    const page = createPage();
    page.data.id = '11111111-1111-4111-8111-111111111111';
    page.data.event = { ownedByMe: true };
    page.data.participants = [{ key: 0, nickname: '骑行小明', avatarUrl: null, isOrganizer: false, contactId: 'contact-1', displayName: '骑行小明', avatarText: '骑' }];
    await page.openParticipant({ currentTarget: { dataset: { participantIndex: 0 } } });
    assert.equal(requestedContact, 'contact-1');
    assert.match(modalContent, /13800138000/);

    requestedContact = '';
    page.data.event = { ownedByMe: false };
    await page.openParticipant({ currentTarget: { dataset: { participantIndex: 0 } } });
    assert.equal(requestedContact, '');
  } finally {
    api.getEventParticipantContact = original;
  }
});
