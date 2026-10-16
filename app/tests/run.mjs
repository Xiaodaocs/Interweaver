// 测试入口：node tests/run.mjs
import { run } from './harness.mjs';
await import('./test-expr.mjs');
await import('./test-graph.mjs');
await import('./test-geom.mjs');
await import('./test-fx-issue7.mjs');   // issue#7「函数生成器语法修正和支持」的可执行验收清单
console.log('交织者 P1–P6 原型 · 自动化核验\n');
await run();
