import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function printRunSummary(root, options) {
  console.log(renderRunSummary(root, options));
}

export function renderRunSummary(root, { mode, target, rc, council = false, artifactPaths = [] }) {
  const verdict = readVerdict(join(root, '.loop', 'verifier-report.md'));
  const artifacts = artifactPaths.filter((p) => existsSync(join(root, p)));
  const result = rc === 0 ? '通过' : rc === 2 ? '需人工/环境阻塞' : '失败/需修';
  const next = rc === 0
    ? nextForSuccess(mode, target, council)
    : '查看上述产物；修正后可重跑对应 loop-system 命令。';

  return `== Loop 结果 ==\n目标: ${target || '—'}\n模式: ${council ? `${mode} --council` : mode}\n结果: ${result}${verdict ? `\nVerdict: ${verdict}` : ''}\n产物: ${artifacts.length ? artifacts.join(' / ') : '—'}\n下一步: ${next}`;
}

function readVerdict(path) {
  try {
    const text = readFileSync(path, 'utf8');
    const m = text.match(/^## Verdict:\s*(.*)$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

function nextForSuccess(mode, target, council) {
  if (mode === 'roadmap') return '人审 .loop/roadmap.md 后，选择 milestone 运行 loop-system run plan/fix。';
  if (mode === 'plan') return `确认 .loop/plan.md 后可运行 loop-system run fix "${target}"。`;
  if (mode === 'execute') return `可运行 loop-system run verify-fix "${target}" 做独立校验。`;
  if (mode === 'verify-fix' || mode === 'fix') return '若 verifier APPROVE，可提议 PR（仍不自动合并）。';
  return council ? '查看 .loop/council.md 与 .loop/roadmap.md。' : '查看上述产物。';
}
