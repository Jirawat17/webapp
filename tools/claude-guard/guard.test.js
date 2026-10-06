// Chạy: node tools/claude-guard/guard.test.js
const assert = require('assert');
const { check } = require('./guard');
const ok = (tool, input) => assert.deepStrictEqual(check({ tool_name: tool, tool_input: input }), [], JSON.stringify(input));
const no = (tool, input) => assert.ok(check({ tool_name: tool, tool_input: input }).length > 0, 'phải chặn: ' + JSON.stringify(input));

// Cho phép
ok('Read', { file_path: 'D:\\n8n_data\\webapp\\server.js' });
ok('Read', { file_path: 'd:/n8n_data/webapp/public/js/api.js' });
ok('Edit', { file_path: 'routes/orders.js' });
ok('Grep', { pattern: 'C:\\\\foo', path: 'services' });
ok('Glob', { pattern: 'public/**/*.html' });
ok('PowerShell', { command: 'node scripts/x.js; git status' });
ok('PowerShell', { command: "$env:ORDERS_DB_PATH = 'D:\\n8n_data\\webapp\\.tmp\\a.db'; node server.js" });
ok('Bash', { command: 'ls /d/n8n_data/webapp/public' });
ok('WebFetch', { url: 'https://code.claude.com/docs' });

// Chặn
no('Read', { file_path: 'C:\\Users\\ADMIN\\Desktop\\Book1.xlsx' });
no('Read', { file_path: 'D:\\n8n_data\\03_API Key\\key.txt' });
no('Read', { file_path: 'D:\\n8n_data\\webapp2\\x' });
no('Read', { file_path: '..\\03_API Key\\key.txt' });
no('Write', { file_path: 'Z:\\File EMB_Duc\\a.xlsx' });
no('Glob', { pattern: 'C:/Users/**/*.docx' });
no('Grep', { pattern: 'x', path: 'D:\\01_Projects' });
no('PowerShell', { command: 'Get-ChildItem C:\\Users\\ADMIN\\Desktop' });
no('PowerShell', { command: 'Get-Content "D:\\01_Projects\\VISA ISS\\a.docx"' });
no('PowerShell', { command: 'cd ..; dir' });
no('PowerShell', { command: 'Set-Location E:' });
no('PowerShell', { command: 'dir $env:USERPROFILE' });
no('PowerShell', { command: 'dir \\\\192.168.1.40\\scan' });
no('PowerShell', { command: 'cmd /c mklink /J link C:\\' });
no('Bash', { command: 'cat ~/.ssh/id_rsa' });
no('Bash', { command: 'ls /c/Users/ADMIN' });
no('mcp__Claude_Browser__navigate', { url: 'file:///C:/Users/ADMIN/Desktop/a.html' });
console.log('guard.test.js: tất cả đều đạt');
