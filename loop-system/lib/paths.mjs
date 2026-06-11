import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 目标项目根：用户在项目根执行 CLI，以 cwd 为准。
export const projectRoot = () => process.cwd();

// 包根：用 import.meta.url 解析（lib/ 的上一级）。
const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(here, '..');
export const templatesDir = resolve(packageRoot, 'templates');
