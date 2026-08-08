import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { EventParticipant } from '../types/domain.ts';

const { api } = await import('../services/api.ts');
const { resolveAppleModal } = await import('../utils/apple-modal.ts');
let definition: any;
(globalThis as any).Page = (value: any) => { definition = value; };
await import('../pages/event-detail/index.ts');

function createPage() {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, update); callback?.(); },
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
  api.getEventParticipantContact = async (_eventId, contactId) => {
    requestedContact = contactId;
    return { nickname: '骑行小明', avatarUrl: null, phone: '13800138000', emergencyContact: '林先生 13600001048', bikeType: '公路车' };
  };
  (globalThis as any).wx = { showToast: () => undefined };

  try {
    const page = createPage();
    page.data.id = '11111111-1111-4111-8111-111111111111';
    page.data.event = { ownedByMe: true };
    page.data.participants = [{ key: 0, nickname: '骑行小明', avatarUrl: null, isOrganizer: false, contactId: 'contact-1', displayName: '骑行小明', avatarText: '骑' }];
    const contactRequest = page.openParticipant({ currentTarget: { dataset: { participantIndex: 0 } } });
    await Promise.resolve();
    resolveAppleModal(page, true);
    await contactRequest;
    assert.equal(requestedContact, 'contact-1');
    assert.match(page.data.appleModal.content, /13800138000/);

    requestedContact = '';
    page.data.event = { ownedByMe: false };
    await page.openParticipant({ currentTarget: { dataset: { participantIndex: 0 } } });
    assert.equal(requestedContact, '');
  } finally {
    api.getEventParticipantContact = original;
  }
});

test('organizer can cancel an active event and jump to the participant list', async () => {
  const original = api.cancelEvent;
  let cancelledEvent = '';
  let reloaded = 0;
  let scrollSelector = '';
  api.cancelEvent = async (eventId) => { cancelledEvent = eventId; };
  (globalThis as any).wx = {
    showToast: () => undefined,
    pageScrollTo: ({ selector }: { selector: string }) => { scrollSelector = selector; },
  };

  try {
    const page = createPage();
    page.data.id = '11111111-1111-4111-8111-111111111111';
    page.data.event = { ownedByMe: true, status: 'published' };
    page.loadDetail = async () => { reloaded += 1; };
    const cancelRequest = page.cancelEvent();
    await Promise.resolve();
    resolveAppleModal(page, true);
    await cancelRequest;
    assert.equal(cancelledEvent, page.data.id);
    assert.equal(reloaded, 1);
    assert.equal(page.data.eventCancelling, false);

    page.viewParticipants();
    assert.equal(scrollSelector, '#participant-list');

    cancelledEvent = '';
    page.data.event = { ownedByMe: false, status: 'published' };
    await page.cancelEvent();
    assert.equal(cancelledEvent, '');
  } finally {
    api.cancelEvent = original;
  }
});
