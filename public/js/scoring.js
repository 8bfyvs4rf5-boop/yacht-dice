// Shared Yacht/Yahtzee scoring rules. Kept in sync with public/js/scoring.js
// (duplicated on purpose: server runs as a Worker module, client runs as a
// plain browser script with no bundler).

export const CATEGORIES = [
  { key: 'aces', section: 'minor', face: 1 },
  { key: 'twos', section: 'minor', face: 2 },
  { key: 'threes', section: 'minor', face: 3 },
  { key: 'fours', section: 'minor', face: 4 },
  { key: 'fives', section: 'minor', face: 5 },
  { key: 'sixes', section: 'minor', face: 6 },
  { key: 'threeKind', section: 'major', badge: '3x' },
  { key: 'fourKind', section: 'major', badge: '4x' },
  { key: 'fullHouse', section: 'major', badge: 'house' },
  { key: 'smallStraight', section: 'major', badge: 'small' },
  { key: 'largeStraight', section: 'major', badge: 'large' },
  { key: 'yatzy', section: 'major', badge: 'yatzy' },
  { key: 'chance', section: 'major', badge: 'chance' },
];

export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS_SCORE = 35;

function tally(dice) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) counts[d]++;
  return counts;
}

function sum(dice) {
  return dice.reduce((a, b) => a + b, 0);
}

export function calculateScore(category, dice) {
  if (!dice || dice.some((d) => !d)) return 0;
  const counts = tally(dice);
  const total = sum(dice);
  switch (category) {
    case 'aces': return counts[1] * 1;
    case 'twos': return counts[2] * 2;
    case 'threes': return counts[3] * 3;
    case 'fours': return counts[4] * 4;
    case 'fives': return counts[5] * 5;
    case 'sixes': return counts[6] * 6;
    case 'threeKind': return counts.some((c) => c >= 3) ? total : 0;
    case 'fourKind': return counts.some((c) => c >= 4) ? total : 0;
    case 'fullHouse': {
      const hasThree = counts.includes(3);
      const hasTwo = counts.includes(2);
      return hasThree && hasTwo ? 25 : 0;
    }
    case 'smallStraight': {
      const set = new Set(dice);
      const runs = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
      return runs.some((run) => run.every((v) => set.has(v))) ? 30 : 0;
    }
    case 'largeStraight': {
      const sorted = [...new Set(dice)].sort().join('');
      return sorted === '12345' || sorted === '23456' ? 40 : 0;
    }
    case 'yatzy': return counts.some((c) => c === 5) ? 50 : 0;
    case 'chance': return total;
    default: return 0;
  }
}

export function summarizeScorecard(scorecard) {
  let upperSum = 0;
  let lowerSum = 0;
  let filledCount = 0;
  for (const { key, section } of CATEGORIES) {
    const v = scorecard[key];
    if (v === null || v === undefined) continue;
    filledCount++;
    if (section === 'minor') upperSum += v;
    else lowerSum += v;
  }
  const bonus = upperSum >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0;
  const total = upperSum + bonus + lowerSum;
  return {
    upperSum,
    bonus,
    lowerSum,
    total,
    filledCount,
    finished: filledCount >= CATEGORIES.length,
  };
}

export function emptyScorecard() {
  const sc = {};
  for (const { key } of CATEGORIES) sc[key] = null;
  return sc;
}
