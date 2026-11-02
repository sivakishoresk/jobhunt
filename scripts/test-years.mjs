// Run: node --experimental-strip-types scripts/test-years.mjs
import { extractYears, yearsLabel } from '../src/lib/experience.ts';
const cases = [
  ['You have 5+ years of experience in ML.', 5, null],
  ['3-5 years of relevant experience required', 3, 5],
  ['Minimum 2 years experience with Python', 2, null],
  ['2 to 4 yrs experience', 2, 4],
  ['At least three years of professional experience', 3, null],
  ['5+ years Python experience; 2+ years of Kubernetes experience', 5, null],
  ['0-1 years of experience', 0, 1],
  ['Freshers welcome. No prior experience required.', 0, null],
  ['We were founded 12 years ago and have grown 3x year over year.', null, null],
  ['Over 10 years, we have built a great team. Salary 20 LPA per year.', null, null],
  ['Experience: 8+ years in distributed systems', 8, null],
  ['Bachelor’s degree and 4 years of industry experience', 4, null],
  ['', null, null],
  ['Build models. Python, PyTorch.', null, null],
];
let bad = 0;
for (const [text, min, max] of cases) {
  const r = extractYears(text);
  const ok = r.min === min && r.max === max;
  if (!ok) bad++;
  console.log(ok ? '  ✓' : '  ✗', JSON.stringify(text).slice(0, 60), '->', JSON.stringify(r), ok ? '' : `wanted ${min}/${max}`);
}
console.log(yearsLabel(3, 5), '|', yearsLabel(5, null), '|', yearsLabel(0, null), '|', yearsLabel(null, null));
process.exit(bad ? 1 : 0);
