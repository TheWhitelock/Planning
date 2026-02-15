import { createApp } from './planning-app.js';

try {
  await import('dotenv/config');
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
    throw error;
  }
}

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3001;

const { app } = await createApp();

app.listen(port, host, () => {
  console.log(`Server running on http://${host}:${port}`);
});
