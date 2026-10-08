import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import housePrice from './api/house-price.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.GOTOHUI_API_KEY) process.env.GOTOHUI_API_KEY = env.GOTOHUI_API_KEY;
  const middleware = (server: { middlewares: { use: (path: string, handler: typeof housePrice) => void } }) => {
    server.middlewares.use('/api/house-price', housePrice);
  };
  return { plugins: [react(), { name: 'house-price-api', configureServer: middleware, configurePreviewServer: middleware }] };
});
