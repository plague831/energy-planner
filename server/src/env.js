import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Підхоплює server/.env, якщо він є (змінні, задані в оточенні, мають перевагу).
const envFile = join(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
