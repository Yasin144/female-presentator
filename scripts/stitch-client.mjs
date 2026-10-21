import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_PROJECT_ID = '13519284942366029207';
const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';

function loadStitchApiKey() {
  if (process.env.STITCH_API_KEY) return process.env.STITCH_API_KEY.trim();

  const envPaths = [
    path.join(os.homedir(), '.env'),
    path.resolve(process.cwd(), '.env')
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^STITCH_API_KEY=(.+)$/m);
      if (match && match[1]) {
        return match[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  const mcpConfigPath = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  if (fs.existsSync(mcpConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      const key = cfg?.mcpServers?.stitch?.headers?.['X-Goog-Api-Key'];
      if (key) return key.trim();
    } catch {
      // ignore
    }
  }

  return null;
}

async function callStitchTool(toolName, args = {}) {
  const apiKey = loadStitchApiKey();
  if (!apiKey) {
    throw new Error('Missing STITCH_API_KEY in ~/.env or ~/.gemini/config/mcp_config.json');
  }

  const response = await fetch(STITCH_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    })
  });

  const data = await response.json();
  if (!response.ok || data?.result?.isError) {
    throw new Error(`Stitch MCP error (${response.status}): ${JSON.stringify(data?.result || data)}`);
  }
  return data.result;
}

async function main() {
  const [action = 'inspect', arg1, ...rest] = process.argv.slice(2);
  const projectId = arg1 || DEFAULT_PROJECT_ID;

  if (action === 'inspect') {
    console.log(`Inspecting Stitch Project: ${projectId}...`);
    const project = await callStitchTool('get_project', { name: `projects/${projectId}` });
    console.log('--- PROJECT ---');
    console.log(JSON.stringify(project, null, 2));

    const screens = await callStitchTool('list_screens', { projectId });
    console.log('--- SCREENS ---');
    console.log(JSON.stringify(screens, null, 2));

    const designSystems = await callStitchTool('list_design_systems', { projectId });
    console.log('--- DESIGN SYSTEMS ---');
    console.log(JSON.stringify(designSystems, null, 2));
    return;
  }

  if (action === 'generate') {
    const prompt = rest.join(' ') || 'Ultra-luxury futuristic fintech mobile dashboard for Salary, Overtime & Smart Bank Expense Tracker with glassmorphic bento cards, neon emerald and electric indigo accents, real bank balance hero card, 4-tile summary grid, and interactive analytics.';
    console.log(`Generating screen in Stitch project ${projectId}...`);
    const result = await callStitchTool('generate_screen_from_text', {
      projectId,
      prompt,
      deviceType: 'MOBILE',
      modelId: 'GEMINI_3_8_FLASH'
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (action === 'download-all') {
    const outDir = path.resolve(process.cwd(), 'stitch-designs');
    fs.mkdirSync(outDir, { recursive: true });
    const screensResp = await callStitchTool('list_screens', { projectId });
    const textBlock = screensResp?.content?.find(c => c.type === 'text')?.text;
    const parsed = textBlock ? JSON.parse(textBlock) : screensResp;
    const screens = parsed?.screens || [];
    console.log(`Found ${screens.length} screens.`);
    for (const s of screens) {
      const screenName = s.name;
      const screenId = screenName.split('/').pop();
      const detailResp = await callStitchTool('get_screen', { name: screenName });
      fs.writeFileSync(path.join(outDir, `${screenId}.json`), JSON.stringify(detailResp, null, 2));
      console.log(`Saved screen metadata: ${screenId}.json`);
    }
    return;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
