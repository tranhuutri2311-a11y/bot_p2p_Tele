import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllowedUserIds } from '../src/index';
import { formatStats, parseNotiText, splitText } from '../src/stats';

test('parses comma-separated allowed Telegram user IDs', () => {
  assert.deepEqual([...parseAllowedUserIds('123, 456, invalid')], [123, 456]);
});

test('formats the stats summary', () => {
  const output = formatStats({
    week: '2026-W37',
    totalRequests: 25,
    activePrivateUsers: 3,
    activeGroups: 2,
    users: [
      { username: '@alice', displayName: 'Alice', chatType: 'private' },
      { username: '@bob', displayName: 'Bob', chatType: 'private' },
      { username: '@groupActor', displayName: 'Group Actor', chatType: 'group' },
    ],
    conversations: [
      { chatTitle: 'OTC Group', chatType: 'group', botStatus: 'member' },
      { chatTitle: 'OTC Supergroup', chatType: 'supergroup', botStatus: 'administrator' },
      { chatTitle: 'Kicked Group', chatType: 'group', botStatus: 'kicked' },
      { chatTitle: 'Left Supergroup', chatType: 'supergroup', botStatus: 'left' },
      { chatTitle: 'OTC Channel', chatType: 'channel' },
    ],
  });
  assert.equal(output, [
    'Danh sách user active:',
    '1. @alice — Alice',
    '2. @bob — Bob',
    '',
    'Danh sách group active:',
    '1. OTC Group',
    '2. OTC Supergroup',
  ].join('\n'));
});

test('splits long JSON without exceeding Telegram message limit', () => {
  const chunks = splitText('a'.repeat(10_000), 3900);
  assert.equal(chunks.join(''), 'a'.repeat(10_000));
  assert.ok(chunks.every(chunk => chunk.length <= 3900));
});

test('parses the /noti argument, stripping wrapping quotes', () => {
  assert.equal(parseNotiText(''), '');
  assert.equal(parseNotiText('  giá mới  '), 'giá mới');
  assert.equal(parseNotiText('"giá mới"'), 'giá mới');
  assert.equal(parseNotiText('"giá mới'), '"giá mới');
  assert.equal(parseNotiText('"a" b"'), 'a" b');
});