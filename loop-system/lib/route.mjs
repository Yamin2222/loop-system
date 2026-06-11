const KNOWN = new Set(['init', 'run', 'watch', 'sync', 'check', 'verify', 'status', '-h', '--help']);

export function routeNaturalInput(words) {
  const target = words.join(' ').trim();
  if (!target) return { ok: false, rc: 2, message: '请在 coco 中描述目标，例如：/loop 修复 login 空指针' };
  if (KNOWN.has(words[0])) return { ok: false, rc: 2, message: `内部错误：已知命令 ${words[0]} 不应进入自然语言路由` };
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(target)) {
    return { ok: false, rc: 2, message: `未知命令: ${target}。日常请在 coco 中使用 /loop status、/loop plan、/loop fix、/loop roadmap 或 /loop watch。若这是目标，请写成一句自然语言。` };
  }

  const matches = collectMatches(target);
  const order = ['status', 'council', 'roadmap', 'plan', 'fix'];
  const selected = order.find((k) => matches[k].length > 0);
  if (!selected) {
    return { ok: false, rc: 2, message: `无法确定要做什么。建议：/loop status；/loop plan ${target}；/loop fix ${target}；/loop roadmap ${target}` };
  }

  const args = selected === 'status'
    ? []
    : selected === 'council'
      ? ['roadmap', '--council', target]
      : [selected, target];
  const mode = selected === 'council' ? 'roadmap' : selected;
  return { ok: true, mode, council: selected === 'council', target, matches, selected, reason: matches[selected].join(', '), args };
}

export function renderRouteDecision(decision) {
  const all = Object.entries(decision.matches || {})
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}: ${v.join('/')}`)
    .join('; ');
  const command = decision.mode === 'status'
    ? '/loop status'
    : `/loop ${decision.council ? `council ${decision.target}` : `${decision.mode} ${decision.target}`}`;
  return `== Loop 判断 ==\n目标: ${decision.target}\n判断: ${decision.council ? 'roadmap --council' : decision.mode}\n命中: ${all}\n因为: 按优先级 status > council > roadmap > plan > fix，选择 ${decision.selected}\n将执行: ${command}`;
}

function collectMatches(text) {
  return {
    status: find(text, [/状态/, /进度/, /到哪/, /status/i]),
    council: has(text, [/council/i, /多模型/, /磋商/, /评审路线图/]) && has(text, [/规划/, /项目/, /从\s*0/, /里程碑/, /构建/]) ? find(text, [/council/i, /多模型/, /磋商/, /评审路线图/]) : [],
    roadmap: find(text, [/从\s*0/, /完整项目/, /构建/, /项目/, /app/i, /Web\s*应用/i, /roadmap/i, /里程碑/, /规划.*项目/]),
    plan: find(text, [/计划/, /方案/, /plan/i, /怎么改/, /先别改/, /只规划/]),
    fix: find(text, [/修复/, /bug/i, /报错/, /失败/, /failing/i, /异常/, /空指针/, /NPE/i, /fix/i]),
  };
}

function find(text, patterns) {
  return patterns.filter((p) => p.test(text)).map((p) => p.source);
}

function has(text, patterns) {
  return patterns.some((p) => p.test(text));
}
