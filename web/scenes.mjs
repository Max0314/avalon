export function roundScene(previous, next) {
  if (!previous || previous.id !== next?.id || next.closed) return null;
  const game = next.game;
  if (!game) return null;
  const before = previous.game;
  if (!before) return {cue:'deal', tone:'gold', icon:'seal', title:'身份已发放', detail:'请在自己的设备上查看'};
  if (before.id !== game.id || next.version <= previous.version) return null;

  if (game.phase === 'finished' && before.phase !== 'finished') {
    const good = game.winner === 'good';
    return {cue:good ? 'win' : 'lose', tone:good ? 'good' : 'evil', icon:'seal',
      title:good ? '好人阵营获胜' : '邪恶阵营获胜', detail:'本局身份已公开'};
  }
  if (game.results.length === before.results.length + 1) {
    const result = game.results.at(-1);
    return {cue:result.success ? 'success' : 'failure', tone:result.success ? 'good' : 'evil',
      icon:result.success ? 'pass' : 'fail', title:`第 ${result.quest} 次任务${result.success ? '成功' : '失败'}`,
      detail:`成功 ${result.successes} 张 · 失败 ${result.fails} 张`};
  }
  if (game.proposals.length === before.proposals.length + 1) {
    const vote = game.proposals.at(-1);
    return {cue:vote.approved ? 'approve' : 'reject', tone:vote.approved ? 'good' : 'evil',
      icon:vote.approved ? 'pass' : 'fail', title:vote.approved ? '出征队伍通过' : '出征队伍未通过',
      detail:vote.approved ? '任务牌将秘密提交' : `连续 ${game.rejections} 次未通过`};
  }
  if (game.phase === before.phase) return null;
  return {
    nominate:{cue:'click', tone:'gold', icon:'seal', title:'队长组队', detail:`请选择 ${game.needed} 位出征队员`},
    vote:{cue:'click', tone:'gold', icon:'seal', title:'队伍表决', detail:'全员提交后同时揭票'},
    lady:{cue:'reveal', tone:'good', icon:'seal', title:'湖中仙女', detail:'查验结果只向持有者显示'},
    assassin:{cue:'reveal', tone:'evil', icon:'seal', title:'刺客时刻', detail:'等待刺客作出最后指认'},
  }[game.phase] ?? null;
}
