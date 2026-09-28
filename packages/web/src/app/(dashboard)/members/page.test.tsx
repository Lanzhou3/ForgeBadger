// @vitest-environment jsdom
import {render,screen,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {LanguageProvider} from '@/hooks/use-language';
import MembersPage from './page';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(),useRouter:()=>({push:vi.fn(),replace:vi.fn()})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{id:'admin',role:'admin'},isLoading:false})}));
vi.mock('@/lib/api',()=>({listAdminUsers:vi.fn().mockRejectedValue(new Error('Unavailable')),updateAdminUser:vi.fn(),fetchJson:vi.fn().mockResolvedValue({invites:[]})}));
afterEach(cleanup);
it('shows account load failure with retry instead of an empty user list',async()=>{render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><LanguageProvider><MembersPage/></LanguageProvider></QueryClientProvider>);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();expect(screen.queryByText('暂无成员')).toBeNull();});
