import { spawnSync } from 'node:child_process';

function git(root, args, allowed = [0]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.error || result.signal || !allowed.includes(result.status)) {
    throw new Error(`Git ${args[0]} 失败：${result.error?.message || result.stderr?.trim() || result.signal || result.status}`);
  }
  return { ...result, output: result.stdout.trim() };
}

// 发布前检查分支与工作区，避免把未提交或已暂存的其他改动混入版本提交。
export function prepareVersionGit(root, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('发布标签必须使用 vX.Y.Z 格式。');
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1]).output;
  if (!branch) throw new Error('当前未检出分支，请切换到待发布分支后再提高版本号。');
  if (git(root, ['status', '--porcelain', '--untracked-files=all']).output) throw new Error('工作区存在未提交的更改，请先提交或暂存到 stash 后再提高版本号。');
  if (git(root, ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], [0, 1]).status === 0) {
    throw new Error(`本地标签 ${tag} 已存在，请使用新的版本号。`);
  }
  if (git(root, ['ls-remote', '--exit-code', '--refs', 'origin', `refs/tags/${tag}`], [0, 2]).status === 0) {
    throw new Error(`远端标签 ${tag} 已存在，请使用新的版本号。`);
  }
  return { branch, tag };
}

function shellArgument(value) {
  return /^[\w/.:=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

// 分支与标签必须一起成功；推送失败时保留可重试的本地发布提交与标签。
export function commitVersionGit(root, release, files) {
  const { branch, tag } = release;
  if (git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1]).output !== branch) {
    throw new Error('当前分支已改变，已停止创建发布提交与标签。');
  }
  const paths = [...new Set(files)];
  const staged = git(root, ['diff', '--cached', '--name-only', '-z']).stdout.split('\0').filter(Boolean);
  if (staged.some((path) => !paths.includes(path))) throw new Error('暂存区包含其他更改，已停止创建发布提交与标签。');
  git(root, ['add', '--', ...paths]);
  git(root, ['commit', '-m', `chore: 发布 ${tag}`]);
  const commit = git(root, ['rev-parse', 'HEAD']).output;
  git(root, ['tag', tag, commit]);
  const push = ['push', '--atomic', '--no-follow-tags', 'origin', `${commit}:refs/heads/${branch}`, `refs/tags/${tag}:refs/tags/${tag}`];
  try { git(root, push); }
  catch (error) {
    throw new Error(`${error.message}\n本地提交与标签 ${tag} 已保留，请重试：git ${push.map(shellArgument).join(' ')}`);
  }
  return commit;
}
