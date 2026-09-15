// 测试入口：node tests/run.mjs
import { run } from './harness.mjs';
await import('./test-expr.mjs');
await import('./test-graph.mjs');
await import('./test-geom.mjs');
console.log('交织者 P1–P6 原型 · 自动化核验\n');
await run();
