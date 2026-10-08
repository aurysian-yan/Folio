import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AboutView } from './AboutView';
import { getAboutInfo, requestRelease } from './api';
vi.mock('./api', () => ({ getAboutInfo: vi.fn(async () => ({version:'1.0.0',build:'2',platform:'linux',arch:'arm64'})), requestRelease: vi.fn(async () => ({status:404,body:''})), openAboutLink: vi.fn(async () => {}) }));
describe('关于页', () => {
  it('许可搜索、全文阅读和返回保留搜索内容与列表位置', async () => {
    render(<AboutView />); await waitFor(() => expect(getAboutInfo).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button',{name:'全部依赖与许可'}));
    const search = await screen.findByRole('searchbox'); fireEvent.change(search,{target:{value:'Source Serif'}});
    const list = screen.getByRole('button',{name:/Source Serif 4.*OFL/}).parentElement!;
    list.scrollTop = 120;
    fireEvent.click(screen.getByRole('button',{name:/Source Serif 4.*OFL/}));
    expect(screen.getByText(/SIL OPEN FONT LICENSE/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'返回许可列表'}));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Source Serif');
    expect(list.scrollTop).toBe(120);
  });
  it('重复检查只发起一次请求，完成后可以重试', async () => {
    let finish: (value: {status:number;body:string}) => void = () => {};
    vi.mocked(requestRelease).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<AboutView />); const button = await screen.findByRole('button',{name:'检查更新'});
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    const before = vi.mocked(requestRelease).mock.calls.length;
    fireEvent.click(button); fireEvent.click(button);
    expect(vi.mocked(requestRelease).mock.calls.length).toBe(before+1);
    await act(async () => finish({status:404,body:''}));
    expect(screen.getByText('尚无正式发行版')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'检查更新'}));
    await waitFor(() => expect(vi.mocked(requestRelease).mock.calls.length).toBe(before+2));
  });
});
