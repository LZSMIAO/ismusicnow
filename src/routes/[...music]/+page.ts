import { error } from '@sveltejs/kit';
import { isWorkspacePath, readWorkspaceLocation } from '#lib/workspace-location.js';
import type { PageLoad } from './$types';
export const load: PageLoad = ({url}) => { if (!isWorkspacePath(url.pathname) || readWorkspaceLocation(url).view === 'home') error(404,'找不到此頁面'); };
