#!/usr/bin/env node
// Ringkasan isi library + pemakaian storage.
import statsService from '../src/services/statsService.js';
import { initSchema, getDb, closeDb } from '../src/db/index.js';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

initSchema(getDb());
const stats = await statsService.getStats();

console.log('\n📚 Library');
Object.entries(stats.library).forEach(([key, value]) => console.log(`   ${key.padEnd(20)} ${value}`));

console.log('\n💾 Storage');
console.log(`   data dir             ${stats.storage.dataDir}`);
console.log(`   database             ${mb(stats.storage.databaseBytes)}`);
console.log(`   images               ${mb(stats.storage.imagesBytes)}`);
console.log(`   cache                ${mb(stats.storage.cacheBytes)}`);
console.log(`   total                ${mb(stats.storage.totalBytes)}`);

const { originalBytes, compressedBytes, averageRatio } = stats.compression;
console.log('\n🗜️  Kompresi');
console.log(`   sebelum              ${mb(originalBytes)}`);
console.log(`   sesudah              ${mb(compressedBytes)}`);
console.log(`   rata-rata hemat      ${(averageRatio * 100).toFixed(1)}%`);

closeDb();
