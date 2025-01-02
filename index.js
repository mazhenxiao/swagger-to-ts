#!/usr/bin/env node
const { exec } = require('child_process');
exec('node schema.mjs', () => {
  if (error) {
    console.error(`执行错误: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`输出错误提示: ${stderr}`);
    return;
  }
  console.log(`执行成功: ${stdout}`);
});
