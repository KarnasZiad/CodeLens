import { fileURLToPath } from 'node:url';

/** drizzle/ sits next to src/ and dist/, in the repository and in the Docker image alike. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));
