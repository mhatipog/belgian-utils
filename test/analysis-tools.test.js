import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDecisionMatrix } from '../src/analysis/decision.js';
import { simpleRandomSample, systematicSample, stratifiedSample, sampleSizeForProportion } from '../src/analysis/sampling.js';
import { parseBallots, consensusRank } from '../src/analysis/consensus.js';
import { commonAvailability, bestMeetingWindows, parseAvailabilityText } from '../src/analysis/availability.js';

test('decision matrix normalizes cost/benefit, finds dominance and sensitivity', () => {
  const alternatives = [
    { name: 'A', values: [10, 140] },
    { name: 'B', values: [8, 120] },
    { name: 'C', values: [6, 100] },
  ];
  const criteria = [
    { name: 'Quality', weight: 70, direction: 'max' },
    { name: 'Cost', weight: 30, direction: 'min' },
  ];
  const r = analyzeDecisionMatrix(alternatives, criteria, { steps: 100 });
  assert.equal(r.ranking[0].name, 'A');
  assert.equal(r.ranking[0].score, .7);
  assert.equal(r.ranking[2].score, .3);
  assert.equal(r.dominated.length, 0);
  assert.equal(r.sensitivity.length, 2);
  const dominated = analyzeDecisionMatrix([
    { name: 'X', values: [5, 5] }, { name: 'Y', values: [6, 4] }, { name: 'Z', values: [4, 7] },
  ], [{ name: 'Benefit', weight: 1, direction: 'max' }, { name: 'Cost', weight: 1, direction: 'min' }]);
  assert.deepEqual(dominated.dominated.find((x) => x.name === 'X')?.dominatedBy, ['Y']);
});

test('sampling is deterministic with seed and respects strata', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, group: i < 80 ? 'A' : 'B' }));
  const a = simpleRandomSample(rows, 10, { seed: 'audit-42' });
  const b = simpleRandomSample(rows, 10, { seed: 'audit-42' });
  assert.deepEqual(a.indexes, b.indexes);
  assert.equal(new Set(a.indexes).size, 10);
  const sys = systematicSample(rows, 10, { seed: 'x' });
  assert.equal(sys.indexes.length, 10);
  assert.ok(sys.interval > 9.9 && sys.interval < 10.1);
  const st = stratifiedSample(rows, 10, 'group', { seed: 'x', allocation: 'proportional' });
  assert.deepEqual(st.strata.map((s) => s.sample), [8, 2]);
  assert.equal(sampleSizeForProportion({ population: 1000, confidence: .95, margin: .05, proportion: .5 }), 278);
});

test('consensus supports ties, Condorcet and Schulze', () => {
  const ballots = parseBallots('A > B > C\nA > C > B\nB > C > A\n');
  const r = consensusRank(ballots, { method: 'schulze' });
  assert.equal(r.condorcetWinner, 'A');
  assert.equal(r.ranking[0].name, 'A');
  assert.equal(r.matrix[0][1], 2);
  const tied = parseBallots('A = B > C\nC > A = B');
  assert.equal(consensusRank(tied, { method: 'borda' }).candidates.length, 3);
});

test('availability merges intervals and finds maximum-attendance windows', () => {
  const t = (h, m=0) => Date.UTC(2026, 8, 30, h, m);
  const people = [
    { name: 'A', slots: [{ start: t(9), end: t(12) }] },
    { name: 'B', slots: [{ start: t(10), end: t(11,30) }] },
    { name: 'C', slots: [{ start: t(10,30), end: t(12) }] },
  ];
  const common = commonAvailability(people, { minParticipants: 3 });
  assert.deepEqual(common, [{ start: t(10,30), end: t(11,30), count: 3, names: ['A','B','C'] }]);
  const best = bestMeetingWindows(people, { durationMinutes: 60, minParticipants: 2 });
  assert.equal(best[0].count, 3);
  assert.equal(best[0].start, t(10,30));
  const parsed = parseAvailabilityText('Ana | 2026-09-30 09:00 - 2026-09-30 10:00', { zoneOffsetMinutes: 0 });
  assert.equal(parsed[0].slots[0].start, t(9));
});

test('decision matrix handles constant criteria, zero weights and invalid input safely', () => {
  const r = analyzeDecisionMatrix([
    { name: 'A', values: [5, 10] },
    { name: 'B', values: [5, 20] },
  ], [
    { name: 'Constant', weight: 0, direction: 'max' },
    { name: 'Benefit', weight: 1, direction: 'max' },
  ], { steps: 20 });
  assert.equal(r.ranking[0].name, 'B');
  assert.deepEqual(r.normalized[0], [1, 1]);
  assert.throws(() => analyzeDecisionMatrix([
    { name: 'A', values: [1] }, { name: 'A', values: [2] },
  ], [{ name: 'x', weight: 1 }]), /unique/);
  assert.throws(() => analyzeDecisionMatrix([
    { name: 'A', values: [1] }, { name: 'B', values: [2] },
  ], [{ name: 'x', weight: -1 }]), /negative/);
  assert.throws(() => analyzeDecisionMatrix([
    { name: 'A', values: [''] }, { name: 'B', values: [2] },
  ], [{ name: 'x', weight: 1 }]), /required/);
});

test('sampling validates sizes, balances equal strata and reproduces all seeded designs', () => {
  const rows = [
    ...Array.from({ length: 2 }, (_, i) => ({ id: `tiny-${i}`, group: 'tiny' })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `large-${i}`, group: 'large' })),
  ];
  const e = stratifiedSample(rows, 6, 'group', { seed: 'fixed', allocation: 'equal' });
  assert.deepEqual(e.strata.map((s) => s.sample), [2, 4]);
  assert.deepEqual(
    systematicSample(rows, 4, { seed: 'fixed' }).indexes,
    systematicSample(rows, 4, { seed: 'fixed' }).indexes,
  );
  assert.deepEqual(
    stratifiedSample(rows, 5, 'group', { seed: 'fixed' }).indexes,
    stratifiedSample(rows, 5, 'group', { seed: 'fixed' }).indexes,
  );
  assert.throws(() => simpleRandomSample(rows, 11), /exceeds population/);
  assert.equal(sampleSizeForProportion({ confidence: .95, margin: .05, proportion: .5 }), 385);
  assert.throws(() => sampleSizeForProportion({ population: 0 }), /population/);
});

test('consensus exposes cycles and treats omitted candidates below ranked ones', () => {
  const cycle = parseBallots('A > B > C\nB > C > A\nC > A > B');
  const r = consensusRank(cycle, { method: 'schulze' });
  assert.equal(r.condorcetWinner, null);
  assert.equal(r.candidates.length, 3);
  assert.ok(r.agreement >= 0 && r.agreement <= 1);
  const partial = consensusRank(parseBallots('A > B\nC > A\nC'), { method: 'copeland' });
  assert.equal(partial.matrix[0][2], 1, 'A beats omitted C on the first ballot');
  assert.equal(partial.matrix[2][0], 2, 'C beats A on the ballots where C is explicitly ranked');
  assert.throws(() => parseBallots('A > B > A'), /Duplicate option/);
});

test('availability merges touching slots, enforces full duration and validates dates', () => {
  const t = (h, m=0) => Date.UTC(2026, 8, 30, h, m);
  const parsed = parseAvailabilityText('A | 2026-09-30 09:00 - 2026-09-30 10:00; 2026-09-30 10:00 - 2026-09-30 11:00', { zoneOffsetMinutes: 0 });
  assert.deepEqual(parsed[0].slots, [{ start: t(9), end: t(11) }]);
  const people = [
    { name: 'A', slots: [{ start: t(9), end: t(10) }] },
    { name: 'B', slots: [{ start: t(9,30), end: t(11) }] },
  ];
  assert.equal(bestMeetingWindows(people, { durationMinutes: 60, minParticipants: 2 }).length, 0);
  assert.equal(bestMeetingWindows(people, { durationMinutes: 30, minParticipants: 2 })[0].count, 2);
  assert.throws(() => parseAvailabilityText('A | 2026-02-30 09:00 - 2026-02-30 10:00', { zoneOffsetMinutes: 0 }), /Invalid date/);
  assert.throws(() => parseAvailabilityText(' | 2026-09-30 09:00 - 2026-09-30 10:00', { zoneOffsetMinutes: 0 }), /name is required/);
});
