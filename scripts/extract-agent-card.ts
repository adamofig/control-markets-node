import * as fs from 'fs';
import * as path from 'path';

interface ExtractedLink {
  status?: string;
  label: string;
  url: string;
  description: string;
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
  sections: ExtractedSection[];
}

function parseLineForLink(line: string): ExtractedLink | null {
  // Option 1: Has a checklist box (Tasks)
  // Matches: - [ ] **[Name](url)** — Description
  // Matches: - [x] [Name](url) - Description
  // Supports optional trailing colons/symbols after the link
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
  // Matches: - [Name](url) — Description
  // Supports optional trailing colons/symbols after the link
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
  // Expected line: # Borges — Agente Experto...
  const titleMatch = fileContent.match(/^#\s+([^\r\n—-]+?)\s*(?:[—-]\s*([^\r\n]+))?$/m);
  const agentName = meta.name || (titleMatch ? titleMatch[1].trim() : '');
  const agentTitle = meta.title || (titleMatch && titleMatch[2] ? titleMatch[2].trim() : '');

  // 3. Parse Sections by Numerical Headers (e.g. ## 1. Title)
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

  // Process sections and extract links for 3, 4, 5, 6
  const sections: ExtractedSection[] = rawSections.map(sec => {
    const content = sec.contentLines.join('\n').trim();
    const resultSec: ExtractedSection = {
      number: sec.number,
      title: sec.title,
      content
    };

    // Extract links for sections 3, 4, 5, and 6
    if ([3, 4, 5, 6].includes(sec.number)) {
      const links: ExtractedLink[] = [];
      sec.contentLines.forEach(line => {
        const parsedLink = parseLineForLink(line);
        if (parsedLink) {
          links.push(parsedLink);
        }
      });
      resultSec.links = links;
    }

    return resultSec;
  });

  return {
    agentCardId: meta.agentCardId || '',
    orgId: meta.orgId || '',
    agenticProfileId: meta.agenticProfileId || '',
    agentName,
    agentTitle,
    sections
  };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx ts-node extract-agent-card.ts <path-to-agent-card.md>');
    process.exit(1);
  }

  try {
    const result = extractAgentCard(filePath);
    console.log(JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('Error extracting agent card:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
