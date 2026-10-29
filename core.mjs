export const key = p => `${p.contestId}/${p.index}`;
export function filterProblems(problems, { min = 800, max = 3500, tags = [], mode = 'all', noRepeat = true } = {}, history = []) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) throw new Error('请输入有效分数区间，最低分不能大于最高分。');
  const seen = new Set(noRepeat ? history : []);
  return problems.filter(p => Number.isInteger(p.contestId) && /^[A-Za-z0-9]+$/.test(p.index) && Number.isFinite(p.rating) && p.rating >= min && p.rating <= max && !seen.has(key(p)) && (!tags.length || (mode === 'any' ? tags.some(t => p.tags.includes(t)) : tags.every(t => p.tags.includes(t)))));
}
export function choose(problems, random = Math.random) {
  return problems.length ? problems[Math.floor(random() * problems.length)] : null;
}
export const problemUrl = p => `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
