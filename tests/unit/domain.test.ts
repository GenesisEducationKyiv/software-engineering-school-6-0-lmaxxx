import { describe, it, expect } from 'vitest';
import { parseOrThrow } from '../../src/shared/domain/parse.js';
import { Email } from '../../src/shared/domain/email.js';
import { RepoSlug } from '../../src/shared/domain/repo-slug.js';
import { Token, generateToken } from '../../src/modules/subscription/domain/token.js';
import { ReleaseTag } from '../../src/modules/repository/domain/release-tag.js';
import {
  createSubscription,
  confirm,
  reissueConfirmation,
  subscriptionFromRow,
} from '../../src/modules/subscription/domain/subscription.js';
import {
  trackedRepositoryFromRow,
  applyLatestRelease,
} from '../../src/modules/repository/domain/tracked-repository.js';

const UUID = '00000000-0000-0000-0000-000000000000';

describe('value schemas (parseOrThrow)', () => {
  it('Email accepts valid and rejects invalid with AppError(400)', () => {
    expect(parseOrThrow(Email, 'user@example.com')).toBe('user@example.com');
    expect(() => parseOrThrow(Email, 'nope')).toThrowError(
      expect.objectContaining({ status: 400, message: 'Invalid email format' }),
    );
  });

  it('RepoSlug accepts owner/repo and rejects a bad slug', () => {
    expect(parseOrThrow(RepoSlug, 'golang/go')).toBe('golang/go');
    expect(() => parseOrThrow(RepoSlug, 'invalid')).toThrowError(
      expect.objectContaining({ status: 400, message: expect.stringContaining('Invalid repo format') }),
    );
  });

  it('Token validates a UUID and generateToken produces a string', () => {
    expect(parseOrThrow(Token, UUID)).toBe(UUID);
    expect(() => parseOrThrow(Token, 'not-a-uuid')).toThrowError(
      expect.objectContaining({ status: 400, message: 'Invalid token' }),
    );
    expect(typeof generateToken()).toBe('string');
  });

  it('ReleaseTag rejects an empty tag', () => {
    expect(parseOrThrow(ReleaseTag, 'v1.0.0')).toBe('v1.0.0');
    expect(() => parseOrThrow(ReleaseTag, '')).toThrow();
  });
});

describe('subscription pure functions', () => {
  const make = () =>
    createSubscription(parseOrThrow(Email, 'user@example.com'), parseOrThrow(RepoSlug, 'owner/repo'));

  it('createSubscription yields an unconfirmed subscription with both tokens and no id', () => {
    const sub = make();
    expect(sub.confirmed).toBe(false);
    expect(sub.id).toBeNull();
    expect(sub.confirmToken).toBeTruthy();
    expect(sub.unsubscribeToken).toBeTruthy();
  });

  it('confirm returns a confirmed copy with the token cleared, without mutating the original', () => {
    const sub = make();
    const confirmed = confirm(sub);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.confirmToken).toBeNull();
    expect(sub.confirmed).toBe(false); // original untouched
  });

  it('confirm throws AppError(400) when already confirmed', () => {
    const confirmed = confirm(make());
    expect(() => confirm(confirmed)).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('reissueConfirmation issues a fresh token while unconfirmed', () => {
    const sub = make();
    const reissued = reissueConfirmation(sub);
    expect(reissued.confirmToken).not.toBe(sub.confirmToken);
    expect(reissued.confirmed).toBe(false);
  });

  it('reissueConfirmation throws AppError(409) when already confirmed', () => {
    const confirmed = confirm(make());
    expect(() => reissueConfirmation(confirmed)).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it('subscriptionFromRow reconstitutes a persisted subscription', () => {
    const sub = subscriptionFromRow({
      id: 5,
      email: 'user@example.com',
      repo: 'owner/repo',
      confirmed: true,
      confirm_token: null,
      unsubscribe_token: UUID,
      created_at: new Date(),
    });
    expect(sub.id).toBe(5);
    expect(sub.confirmed).toBe(true);
    expect(sub.confirmToken).toBeNull();
    expect(sub.unsubscribeToken).toBe(UUID);
  });
});

describe('tracked repository pure functions', () => {
  const make = (lastSeen: string | null) =>
    trackedRepositoryFromRow({
      id: 1,
      repo: 'owner/repo',
      last_seen_tag: lastSeen,
      last_checked_at: null,
    });

  it('applyLatestRelease returns an updated repo for a new tag', () => {
    const updated = applyLatestRelease(make('v1.0.0'), parseOrThrow(ReleaseTag, 'v1.1.0'));
    expect(updated).not.toBeNull();
    expect(updated!.lastSeenTag).toBe('v1.1.0');
  });

  it('applyLatestRelease returns null for an unchanged tag', () => {
    expect(applyLatestRelease(make('v1.0.0'), parseOrThrow(ReleaseTag, 'v1.0.0'))).toBeNull();
  });

  it('applyLatestRelease treats the first ever release as new', () => {
    const updated = applyLatestRelease(make(null), parseOrThrow(ReleaseTag, 'v1.0.0'));
    expect(updated).not.toBeNull();
    expect(updated!.lastSeenTag).toBe('v1.0.0');
  });
});
