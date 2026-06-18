import * as fs from 'fs';
import * as path from 'path';

interface ExtractedLink {
  status?: string;
  label: string;
  url: string;
  description: string;
  taskId?: string;
  content?: string;
}

interface ExtractedSection {
  number: number;
  title: string;
  content: string;
  links?: ExtractedLink[];
}

interface ExtractedAgent {
  agentCardId: string;
  orgId: string;
  agenticProfileId?: string;
  agentName: string;
  agentTitle: string;
  agentDescription?: string;
  agentDomain?: string;
  sections: ExtractedSection[];
}

function parseLineForLink(line: string): ExtractedLink | null {
  // Option 1: Has a checklist box (Tasks)
  const checkboxMatch = line.match(/^\s*-\s*\[\s*([xX\/]?)\s*\]\s*(?:\*\*)?\[([^\]]+)\]\(([^)]+)\)(?:\*\*)?[\s:]*(?:[-—]\s*(.*))?$/);
  if (checkboxMatch) {
    const rawStatus = checkboxMatch[1].toLowerCase().trim();
    let status = 'pending';
    if (rawStatus === 'x') {
      status = 'done';
    } else if (rawStatus === '/') {
      status = 'in_progress';
    }
    return {
      status,
      label: checkboxMatch[2].trim(),
      url: checkboxMatch[3].trim(),
      description: checkboxMatch[4]?.trim() || ''
    };
  }

  // Option 2: Simple markdown link without checkbox (Knowledge or Skills)
  const simpleMatch = line.match(/^\s*-\s*(?:\*\*)?\[([^\]]+)\]\(([^)]+)\)(?:\*\*)?[\s:]*(?:[-—]\s*(.*))?$/);
  if (simpleMatch) {
    return {
      label: simpleMatch[1].trim(),
      url: simpleMatch[2].trim(),
      description: simpleMatch[3]?.trim() || ''
    };
  }

  return null;
}

function urlToPath(urlStr: string): string {
  if (urlStr.startsWith('file://')) {
    let filePath = urlStr.replace('file://', '');
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }
    return decodeURIComponent(filePath);
  }
  return '';
}

function getTaskIdFromTaskFile(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const content = fs.readFileSync(filePath, 'utf-8');
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const fmMatch = content.match(frontmatterRegex);
  if (fmMatch) {
    const fmText = fmMatch[1];
    let taskId: string | undefined;
    fmText.split(/\r?\n/).forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim();
        const val = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key === 'taskId') {
          taskId = val;
        }
      }
    });
    return taskId;
  }
  return undefined;
}

function updateFileFrontmatter(filePath: string, taskId: string, orgId: string) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf-8');
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = content.match(frontmatterRegex);

  const newFm = `---\ntaskId: "${taskId}"\norgId: "${orgId}"\n---`;

  if (match) {
    content = content.replace(frontmatterRegex, newFm);
  } else {
    content = `${newFm}\n\n${content}`;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Updated frontmatter for local task: ${path.basename(filePath)}`);
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function updateAgentFrontmatter(filePath: string, updates: Record<string, any>) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf-8');
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = content.match(frontmatterRegex);

  const meta: Record<string, string> = {};
  if (match) {
    const fmText = match[1];
    fmText.split(/\r?\n/).forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim();
        const val = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        meta[key] = val;
      }
    });
  }

  // Merge updates
  const merged = { ...meta, ...updates };
  const fmLines = Object.entries(merged).map(([k, v]) => `${k}: "${v}"`);
  const newFm = `---\n${fmLines.join('\n')}\n---`;

  if (match) {
    content = content.replace(frontmatterRegex, newFm);
  } else {
    content = `${newFm}\n\n${content}`;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Updated frontmatter for Agent profile: ${path.basename(filePath)}`);
}

function extractAgentCard(filePath: string): ExtractedAgent {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf-8');

  // 1. Parse YAML Frontmatter
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const fmMatch = fileContent.match(frontmatterRegex);
  const meta: Record<string, string> = {};
  if (fmMatch) {
    const fmText = fmMatch[1];
    fmText.split(/\r?\n/).forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim();
        const val = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        meta[key] = val;
      }
    });
  }

  // 2. Parse Agent Name and Title
  const titleMatch = fileContent.match(/^#\s+([^\r\n—-]+?)\s*(?:[—-]\s*([^\r\n]+))?$/m);
  const agentName = meta.name || (titleMatch ? titleMatch[1].trim() : '');
  const agentTitle = meta.title || (titleMatch && titleMatch[2] ? titleMatch[2].trim() : '');

  // 3. Parse Sections by Numerical Headers (## [Number])
  const lines = fileContent.split(/\r?\n/);
  let currentSection: { number: number; title: string; contentLines: string[] } | null = null;
  const rawSections: Array<{ number: number; title: string; contentLines: string[] }> = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(\d+)\.?(?:\s+(.*))?$/);
    if (headerMatch) {
      if (currentSection) {
        rawSections.push(currentSection);
      }
      currentSection = {
        number: parseInt(headerMatch[1], 10),
        title: headerMatch[2]?.trim() || '',
        contentLines: []
      };
    } else {
      if (currentSection) {
        currentSection.contentLines.push(line);
      }
    }
  }
  if (currentSection) {
    rawSections.push(currentSection);
  }

  const sections: ExtractedSection[] = rawSections.map(sec => {
    const content = sec.contentLines.join('\n').trim();
    const resultSec: ExtractedSection = {
      number: sec.number,
      title: sec.title,
      content
    };

    if ([3, 4, 5, 6].includes(sec.number)) {
      const links: ExtractedLink[] = [];
      sec.contentLines.forEach(line => {
        const parsedLink = parseLineForLink(line);
        if (parsedLink) {
          const localPath = urlToPath(parsedLink.url);
          if (localPath && fs.existsSync(localPath)) {
            try {
              parsedLink.content = fs.readFileSync(localPath, 'utf-8');
            } catch (err: any) {
              console.error(`Warning: Failed to read local file ${localPath}:`, err.message);
            }
          }
          links.push(parsedLink);
        }
      });
      resultSec.links = links;
    }

    return resultSec;
  });

  // Find Section 2 content (Domain Context)
  const sec2 = sections.find(s => s.number === 2);
  const agentDomain = sec2 ? sec2.content : '';

  return {
    agentCardId: meta.agentCardId || '',
    orgId: meta.orgId || '',
    agenticProfileId: meta.agenticProfileId || '',
    agentName,
    agentTitle,
    agentDescription: meta.description || '',
    agentDomain,
    sections
  };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx ts-node sync-agent-card.ts <path-to-agent-card.md>');
    process.exit(1);
  }

  try {
    console.log(`Parsing Agent spec: ${filePath}`);
    const agentData = extractAgentCard(filePath);

    if (!agentData.agentCardId || !agentData.orgId) {
      console.error('Error: agentCardId and orgId are required in the agent profile YAML frontmatter.');
      process.exit(1);
    }

    // Resolve task IDs from local files for Section 5 (Tasks)
    const taskSection = agentData.sections.find(s => s.number === 5);
    if (taskSection && taskSection.links) {
      for (const link of taskSection.links) {
        const localPath = urlToPath(link.url);
        if (localPath) {
          const taskId = getTaskIdFromTaskFile(localPath);
          if (taskId) {
            link.taskId = taskId;
          }
        }
      }
    }

    console.log(`Sending sync request to Control Markets server...`);
    const baseUrl = process.env.CONTROL_MARKETS_BACKEND_URL || 'https://local-back.control.markets';
    console.log(`Endpoint: ${baseUrl}/api/agentic-profile/sync-markdown`);

    const response = await fetch(`${baseUrl}/api/agentic-profile/sync-markdown`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(agentData)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, response: ${errText}`);
    }

    const result = await response.json();
    if (result.success) {
      console.log(`Successfully synchronized Agent "${agentData.agentName}" with MongoDB.`);
      console.log(`Profile ID: ${result.profileId}`);
      console.log(`Agent Card ID: ${result.agentCardId}`);

      // Perform local agent profile write-back to ensure agenticProfileId is recorded
      if (result.profileId && agentData.agenticProfileId !== result.profileId) {
        updateAgentFrontmatter(filePath, {
          agentCardId: agentData.agentCardId,
          orgId: agentData.orgId,
          name: agentData.agentName,
          title: agentData.agentTitle,
          description: agentData.agentDescription || '',
          agenticProfileId: result.profileId
        });
      }

      // Perform local file write-backs for newly created/updated tasks
      if (result.tasks && Array.isArray(result.tasks)) {
        for (const task of result.tasks) {
          const localPath = urlToPath(task.url);
          if (localPath && fs.existsSync(localPath)) {
            const currentTaskId = getTaskIdFromTaskFile(localPath);
            if (currentTaskId !== task.taskId) {
              updateFileFrontmatter(localPath, task.taskId, task.orgId);
            }
          }
        }
      }

      console.log('Sync process completed successfully.');
    } else {
      console.error('Sync failed:', result);
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Error during synchronization:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
