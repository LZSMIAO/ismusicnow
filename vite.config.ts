import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
  server: { host: 'localhost', port: 5173, strictPort: true },
  ssr: { external: ['@neteasecloudmusicapienhanced/api'] },
});
