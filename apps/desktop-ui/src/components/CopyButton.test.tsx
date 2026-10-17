import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

function clipboard(writeText = vi.fn(async (value: string) => { void value; })) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}
const props = { label: '复制字符', value: '字', icon: <svg /> };
async function click(name = '复制字符') {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }

describe('复制反馈', () => {
  it('实际写入成功后显示反馈，保持两秒并复原', async () => {
    vi.useFakeTimers(); const write = clipboard();
    render(<CopyButton {...props} />);
    await click();
    expect(write).toHaveBeenCalledExactlyOnceWith('字');
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
    await advance(1999);
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
    await advance(1);
    expect(screen.getByRole('button', { name: '复制字符' })).toBeTruthy();
  });
  it('同一按钮重新计时，不影响其他入口', async () => {
    vi.useFakeTimers(); clipboard();
    render(<><CopyButton {...props} /><CopyButton {...props} label="复制码位" value="U+5B57" /></>);
    await click(); await advance(1000); await click('复制码位');
    await advance(500);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '已复制' })[0]); });
    await advance(1500);
    expect(screen.getByRole('button', { name: '复制码位' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
    await advance(500);
    expect(screen.getByRole('button', { name: '复制字符' })).toBeTruthy();
  });
  it('请求期间防重复写入，失败保留原按钮并播报错误', async () => {
    let reject: (reason: Error) => void = () => {};
    const write = clipboard(vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; })));
    render(<CopyButton {...props} />);
    await click(); await click();
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => { reject(new Error('denied')); });
    expect(screen.queryByRole('button', { name: '已复制' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('复制失败，请检查剪贴板权限');
  });
  it('禁用入口不写入，身份变化及卸载后忽略旧结果并清理计时', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const write = clipboard(vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    const view = render(<CopyButton {...props} isDisabled />);
    await click(); expect(write).not.toHaveBeenCalled();
    view.rerender(<CopyButton {...props} identity="first" />);
    await click();
    view.rerender(<CopyButton {...props} identity="second" />);
    await act(async () => { finish(); });
    expect(screen.queryByRole('button', { name: '已复制' })).toBeNull();
    await click(); await act(async () => { finish(); });
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
    view.rerender(<CopyButton {...props} identity="second" value="新" />);
    expect(screen.queryByRole('button', { name: '已复制' })).toBeNull();
    await click(); view.unmount();
    await act(async () => { finish(); }); await advance(3000);
    expect(document.querySelector('.copy-feedback-hint')).toBeNull();
  });
  it('成功态复用正常态的图标尺寸、顺序和文字样式', async () => {
    clipboard(); const view = render(<CopyButton {...props} icon={<svg className="size-5" />} />);
    const normal = view.container.querySelector('.copy-feedback-normal')!;
    const success = view.container.querySelector('.copy-feedback-success')!;
    expect(normal.children[0].tagName.toLowerCase()).toBe('svg');
    expect(success.children[0].tagName.toLowerCase()).toBe('svg');
    expect(success.children[0].getAttribute('class')).toContain('size-5');
    expect(normal.children[1].tagName).toBe(success.children[1].tagName);
    expect(normal.children[1].getAttribute('class')).toBe(success.children[1].getAttribute('class'));
    await click();
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
  });
  it('图标按钮保持图标结构，文字提示独立覆盖且不进入读屏树', async () => {
    clipboard(); const view = render(<CopyButton {...props} iconOnly />);
    await click();
    const button = screen.getByRole('button', { name: '已复制' });
    expect(button.querySelector('.copy-feedback-success')?.textContent).toBe('');
    const hint = document.querySelector('.copy-feedback-hint');
    expect(hint?.parentElement).toBe(document.body);
    expect(hint?.getAttribute('aria-hidden')).toBe('true');
    expect(hint?.getAttribute('data-copied')).toBe('true');
    view.unmount(); expect(document.querySelector('.copy-feedback-hint')).toBeNull();
  });
});
