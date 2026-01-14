/**
 * Copy SQL schema files to dist directory
 */
import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const srcStorage = join(__dirname, '..', 'src', 'storage');
const distStorage = join(__dirname, '..', 'dist', 'storage');

// Ensure dist/storage exists
if (!existsSync(distStorage)) {
  mkdirSync(distStorage, { recursive: true });
}

// Copy schema files
const schemas = ['schema.sql', 'chrome-schema.sql'];
for (const schema of schemas) {
  const src = join(srcStorage, schema);
  const dest = join(distStorage, schema);
  if (existsSync(src)) {
    cpSync(src, dest);
    console.log(`Copied ${schema} to dist/storage/`);
  }
}

console.log('Schema files copied successfully!');
